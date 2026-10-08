// src/services/clip.ts
// vm_clips: the job that makes one clip (see lib/clips.ts).
import fs from "fs/promises";
import os from "os";
import path from "path";
import { enqueueJob, type Job } from "../lib/jobs.js";
import { nudgeRunner, PermanentJobError } from "../lib/runner.js";
import { store } from "../lib/store.js";
import { getStorage, ObjectMissingError } from "../lib/storage.js";
import { getOriginal, saveClipAsset, deleteAssetById } from "../lib/assets.js";
import { cutClip, makeSocialClip, mediaHealth, MediaError, probeFile } from "../lib/media.js";
import { CLIP_JOB, getClip, updateClip, srtForClip, copyFormat, fileNameFor } from "../lib/clips.js";
import { getDb } from "../lib/db.js";

export { CLIP_JOB };

/** A quick cut that would start this many seconds early is encoded instead, when it is this short. */
const REENCODE_EXTRA = 3;
const REENCODE_MAX = 90;
/** The original is read for as long as encoding can take. */
const READ_SECONDS = 3 * 3600;

export async function queueClip(videoId: string, clipId: string): Promise<void> {
  await enqueueJob({ videoId, kind: CLIP_JOB, key: `${videoId}:${CLIP_JOB}:${clipId}`, payload: { clipId }, maxAttempts: 2 });
  nudgeRunner();
}

function rethrow(err: any): never {
  if (err instanceof ObjectMissingError) throw new PermanentJobError("source_missing", "The original file is no longer in storage.");
  if (err instanceof MediaError && !err.retryable) throw new PermanentJobError(err.code, err.message);
  throw err;
}

export async function clipHandler(job: Job): Promise<void> {
  const id = String(job.payload.clipId ?? "");
  const clip = await getClip(id);
  if (!clip) return;                                          // deleted before it was made
  const video = await store.get(job.videoId);
  if (!video) return;
  if (!mediaHealth().ffmpeg) throw new PermanentJobError("no_ffmpeg", "FFmpeg is not installed on this server, so clips cannot be made.");
  const original = await getOriginal(video.id);
  if (!original) throw new PermanentJobError("source_missing", "The original file is no longer in storage.");
  const storage = getStorage();
  const withInput = async <T>(fn: (input: string) => Promise<T>): Promise<T> => {
    const url = await storage.signedUrl(original.key, READ_SECONDS);
    return url ? fn(url) : storage.withLocalFile(original.key, fn);
  };

  await updateClip(id, { status: "making", error: null });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vm-clip-"));
  try {
    const seconds = clip.endSeconds - clip.startSeconds;
    const hasAudio = video.media?.hasAudio !== false;
    let ext = ".mp4", type = "video/mp4", note: string | null = null;
    const out = path.join(dir, `clip-${id}`);

    if (clip.kind === "cut") {
      const f = copyFormat(video.media);
      try {
        await withInput((input) => cutClip(input, clip.startSeconds, seconds, out + f.ext, f.format));
        ext = f.ext; type = f.type;
        // A copy starts at the keyframe at or before the start, so it can run longer than asked.
        const got = (await probeFile(out + f.ext).catch(() => null))?.durationSeconds;
        const extra = got ? got - seconds : 0;
        if (extra >= REENCODE_EXTRA && seconds <= REENCODE_MAX) {
          // Keyframes this far apart would put a lot of unwanted video in front. A short clip is encoded instead.
          await fs.rm(out + f.ext, { force: true });
          try { await withInput((input) => makeSocialClip(input, clip.startSeconds, seconds, "original", null, hasAudio, out + ".mp4")); }
          catch (e) { rethrow(e); }
          ext = ".mp4"; type = "video/mp4";
          note = "This video has few keyframes, so a copy would have started well before the chosen start. The clip was encoded instead (at most 720p) and starts exactly there.";
        } else if (extra >= 0.5) {
          const sec = Math.round(extra);
          note = `It starts about ${sec < 1 ? "a second" : `${sec} second${sec === 1 ? "" : "s"}`} before the chosen start, at the nearest keyframe, because a quick cut copies the video without encoding it.`;
        }
      } catch (err: any) {
        // Some files cannot be copied into a container as they are. Encode instead.
        if (!(err instanceof MediaError) || !["unreadable", "media_empty"].includes(err.code)) rethrow(err);
        try { await withInput((input) => makeSocialClip(input, clip.startSeconds, seconds, "original", null, hasAudio, out + ".mp4")); }
        catch (e) { rethrow(e); }
        note = "This file could not be copied as it is, so the clip was encoded again (at most 720p).";
      }
    } else {
      let srt: string | null = null;
      if (clip.captions) {
        const text = srtForClip(video.ai?.transcript, clip);
        if (!mediaHealth().captions) note = "Captions could not be drawn on this server, so the clip has none. Its captions can be downloaded as a file.";
        else if (!text.trim()) note = "Nobody speaks in this part of the video, so there are no captions.";
        else { srt = path.join(dir, `captions-${id}.srt`); await fs.writeFile(srt, text); }
      }
      try { await withInput((input) => makeSocialClip(input, clip.startSeconds, seconds, clip.frame, srt, hasAudio, out + ".mp4")); }
      catch (e) { rethrow(e); }
    }

    const fileName = fileNameFor(clip.title, clip.kind, clip.frame, ext);
    const asset = await saveClipAsset({ videoId: video.id, clipId: id, filePath: out + ext, ext, contentType: type, fileName, ownerWallet: clip.wallet });
    // Deleted while it was being made: do not keep the file.
    if (!(await getClip(id))) { await deleteAssetById(asset.id).catch(() => {}); return; }
    await updateClip(id, { status: "ready", note, error: null, asset_id: asset.id, size_bytes: asset.bytes, file_name: fileName });
  } catch (err) {
    // Another attempt follows unless this one was the last or cannot help.
    if (!(err instanceof PermanentJobError) && job.attempts < job.maxAttempts) await updateClip(id, { status: "queued" }).catch(() => {});
    throw err;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The job gave up: the clip says why. */
export async function clipGaveUp(job: Job, f: { error: string }): Promise<void> {
  await getDb().execute({
    sql: "UPDATE clips SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
    args: [f.error.replace(/https?:\/\/\S+/g, "[address]").slice(0, 300), Date.now(), String(job.payload.clipId ?? "")],
  });
}
