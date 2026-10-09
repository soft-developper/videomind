// src/services/youtube.ts
// vm_youtube: the job that sends one video or clip to YouTube (see lib/youtube.ts).
import fs from "fs/promises";
import { enqueueJob, type Job } from "../lib/jobs.js";
import { nudgeRunner, PermanentJobError } from "../lib/runner.js";
import { store } from "../lib/store.js";
import { getStorage } from "../lib/storage.js";
import { getOriginal, getAssetById, type MediaAsset } from "../lib/assets.js";
import { getClip } from "../lib/clips.js";
import { getDb } from "../lib/db.js";
import {
  getPublication, updatePublication, accessToken, startSession, sendFile, YouTubeError, type ReadRange,
} from "../lib/youtube.js";

export const YOUTUBE_JOB = "youtube_upload";

export async function queuePublication(videoId: string, pubId: string): Promise<void> {
  await enqueueJob({ videoId, kind: YOUTUBE_JOB, key: `${videoId}:${YOUTUBE_JOB}:${pubId}`, payload: { pubId }, maxAttempts: 3 });
  nudgeRunner();
}

/** Reads any byte range of a stored file: from the bucket with a Range request, or from local disk. */
function reader(asset: MediaAsset): ReadRange {
  const storage = getStorage();
  return async (start, end) => {
    const url = await storage.signedUrl(asset.key, 30 * 60);
    if (url) {
      const res = await fetch(url, { headers: { range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(5 * 60_000) });
      if (res.status !== 206 && res.status !== 200) throw new YouTubeError(502, "storage", `Storage answered ${res.status}.`, true);
      const buf = Buffer.from(await res.arrayBuffer());
      return res.status === 200 ? buf.subarray(start, end + 1) : buf;
    }
    return storage.withLocalFile(asset.key, async (p) => {
      const fh = await fs.open(p, "r");
      try { const b = Buffer.alloc(end - start + 1); await fh.read(b, 0, b.length, start); return b; }
      finally { await fh.close(); }
    });
  };
}

export async function youtubeHandler(job: Job): Promise<void> {
  const id = String(job.payload.pubId ?? "");
  const pub = await getPublication(id);
  if (!pub || pub.status === "done" || !pub.details) return;
  const video = await store.get(job.videoId);
  if (!video) throw new PermanentJobError("video_gone", "The video was deleted.");

  let asset: MediaAsset | null = null;
  if (pub.clipId) {
    const clip = await getClip(pub.clipId);
    if (!clip || clip.status !== "ready" || !clip.assetId) throw new PermanentJobError("clip_gone", "The clip is no longer ready.");
    asset = await getAssetById(clip.assetId);
  } else {
    asset = await getOriginal(video.id);
  }
  if (!asset) throw new PermanentJobError("source_missing", "The file is no longer in storage.");

  try {
    await updatePublication(id, { status: "uploading", error: null, total_bytes: asset.bytes });
    const token = () => accessToken(pub.wallet);
    let session = pub.sessionUrl, from = pub.sentBytes;
    if (!session) {
      session = await startSession(await token(), pub.details, asset.bytes, asset.contentType ?? "video/*");
      from = 0;
      await updatePublication(id, { session_url: session, sent_bytes: 0 });
    }
    let result: any;
    try {
      result = await sendFile({ session, token, size: asset.bytes, type: asset.contentType ?? "video/*", read: reader(asset), from,
        onProgress: (sent) => updatePublication(id, { sent_bytes: sent }) });
    } catch (err) {
      // An expired session starts again from the beginning on the next attempt.
      if (err instanceof YouTubeError && err.code === "session_expired") await updatePublication(id, { session_url: null, sent_bytes: 0 });
      throw err;
    }
    const remoteId = typeof result?.id === "string" ? result.id : null;
    if (!remoteId) throw new YouTubeError(502, "no_id", "YouTube finished the upload but did not say which video it made.");
    await updatePublication(id, { status: "done", remote_id: remoteId, sent_bytes: asset.bytes, session_url: null, error: null });
  } catch (err: any) {
    if (err instanceof YouTubeError && !err.retryable) throw new PermanentJobError(err.code, err.message);
    if (job.attempts < job.maxAttempts) await updatePublication(id, { status: "queued", error: null }).catch(() => {});
    throw err;
  }
}

export async function youtubeGaveUp(job: Job, f: { error: string }): Promise<void> {
  await getDb().execute({
    sql: "UPDATE publications SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
    args: [f.error.replace(/https?:\/\/\S+/g, "[address]").slice(0, 300), Date.now(), String(job.payload.pubId ?? "")],
  });
}
