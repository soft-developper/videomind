// src/services/inspect.ts
// vm_media: the "inspect" job. It looks at an uploaded file once:
//
//   1. reads its facts (length, picture size, codecs, and whether
//      browsers can play it as it is)
//   2. takes one frame as the video's thumbnail and poster
//
// It runs next to transcription, not before it, and nothing waits for
// it. If it fails the video still plays, is still transcribed, and its
// card shows the chapter tile it showed before thumbnails existed.
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getDb } from "../lib/db.js";
import { store } from "../lib/store.js";
import { enqueueJob, type Job } from "../lib/jobs.js";
import { PermanentJobError } from "../lib/runner.js";
import { getStorage, ObjectMissingError } from "../lib/storage.js";
import { getOriginal, listAssets, saveDerived } from "../lib/assets.js";
import { probeFile, makePictures, pictureTime, MediaError } from "../lib/media.js";
import { ownerOf } from "../lib/usage.js";

export const INSPECT = "inspect";

/** How long the address FFmpeg reads the original through stays valid. */
const READ_SECONDS = 15 * 60;

export interface InspectDeps {
  probe: typeof probeFile;
  pictures: typeof makePictures;
}

/** Queue the job. Asking twice for the same video creates one job. */
export async function queueInspect(videoId: string): Promise<boolean> {
  const { created } = await enqueueJob({ videoId, kind: INSPECT });
  return created;
}

function rethrow(err: unknown): never {
  if (err instanceof ObjectMissingError) throw new PermanentJobError("source_missing", "The uploaded file is no longer in storage.");
  if (err instanceof MediaError && !err.retryable) throw new PermanentJobError(err.code, err.message);
  throw err;      // worth another attempt: the queue tries again after a wait
}

export function makeInspectHandler(deps: InspectDeps = { probe: probeFile, pictures: makePictures }) {
  return async function inspect(job: Job) {
    const video = await store.get(job.videoId);
    if (!video) throw new PermanentJobError("video_gone", "The video was deleted.");
    const original = await getOriginal(job.videoId);
    if (!original) throw new PermanentJobError("source_missing", "The uploaded file is no longer in storage.");
    const storage = getStorage();

    // FFmpeg reads the file where it lies: through a signed address when
    // it is in the bucket, from disk when storage is local.
    const withInput = async <T>(fn: (input: string) => Promise<T>): Promise<T> => {
      const url = await storage.signedUrl(original.key, READ_SECONDS);
      return url ? fn(url) : storage.withLocalFile(original.key, fn);
    };

    // 1. Facts. Skipped when an earlier attempt already saved them.
    let facts = video.media;
    if (!facts) {
      try { facts = await withInput((input) => deps.probe(input)); } catch (err) { rethrow(err); }
      await store.setMedia(job.videoId, facts!);
    }
    if (!facts!.hasVideo) return;                       // sound only: there is nothing to take a picture of

    // 2. Pictures. Skipped when both are already stored.
    const have = new Set((await listAssets(job.videoId)).map((a) => a.kind));
    if (have.has("poster") && have.has("thumb")) return;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vm-inspect-"));
    try {
      let made;
      try { made = await withInput((input) => deps.pictures(input, pictureTime(facts!.durationSeconds), dir)); } catch (err) { rethrow(err); }
      // The video may have been deleted while FFmpeg worked. Do not leave pictures of it behind.
      if (!(await store.get(job.videoId))) throw new PermanentJobError("video_gone", "The video was deleted.");
      const owner = ownerOf(video);
      await saveDerived({ videoId: job.videoId, kind: "poster", filePath: made!.poster, contentType: "image/jpeg", ownerWallet: owner });
      await saveDerived({ videoId: job.videoId, kind: "thumb", filePath: made!.thumb, contentType: "image/jpeg", ownerWallet: owner });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/**
 * Videos that were uploaded before this job existed. Queues up to
 * `limit` of them per call, oldest first, and returns how many.
 */
export async function backfillInspect(limit = 25): Promise<number> {
  const res = await getDb().execute({
    sql: `SELECT m.video_id AS video_id
            FROM media_assets m JOIN videos v ON v.id = m.video_id
           WHERE m.kind = 'original' AND v.status != 'uploading'
             AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.video_id = m.video_id AND j.kind = ?)
           ORDER BY m.created_at ASC LIMIT ?`,
    args: [INSPECT, limit],
  });
  let queued = 0;
  for (const r of res.rows as Array<Record<string, unknown>>) {
    if (await queueInspect(String(r.video_id))) queued++;
  }
  if (queued) console.log(`[media] queued ${queued} earlier video(s) for a thumbnail`);
  return queued;
}
