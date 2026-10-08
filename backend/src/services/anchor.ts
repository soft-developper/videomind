// src/services/anchor.ts
// vm_anchors: the job that confirms a store on Shelby (see lib/anchors.ts).
// A fresh store can take a little while to appear in the Shelby object
// index, so the job looks again with the usual backoff before it gives up.
import { enqueueJob, type Job } from "../lib/jobs.js";
import { nudgeRunner } from "../lib/runner.js";
import { store } from "../lib/store.js";
import { ANCHOR_CHECK, checkAnchor, getAnchor, pendingWithoutCheck } from "../lib/anchors.js";
import { getDb } from "../lib/db.js";

export { ANCHOR_CHECK };

const attempts = () => Math.max(1, Number(process.env.ANCHOR_CHECK_ATTEMPTS) || 6);

export async function queueAnchorCheck(videoId: string, anchorId: string): Promise<void> {
  await enqueueJob({ videoId, kind: ANCHOR_CHECK, key: `${videoId}:${ANCHOR_CHECK}:${anchorId}`, payload: { anchorId }, maxAttempts: attempts() });
  nudgeRunner();
}

export async function anchorCheckHandler(job: Job): Promise<void> {
  const id = String(job.payload.anchorId ?? "");
  if (!(await getAnchor(id))) return;   // the video was deleted
  const video = await store.get(job.videoId);
  if (!video) return;
  const r = await checkAnchor(id, { lastTry: job.attempts >= job.maxAttempts, expectedSize: video.meta?.sizeBytes ?? null });
  if (r.notYet) {
    const e: any = new Error("Not in the Shelby index yet. Looking again shortly.");
    e.code = "not_indexed";
    throw e;
  }
}

/** When every look failed because Shelby could not be reached, say so on the store. */
export async function anchorCheckGaveUp(job: Job, f: { error: string }): Promise<void> {
  await getDb().execute({
    sql: `UPDATE anchors SET state = 'unverified', error = ?, checked_at = ?, updated_at = ? WHERE id = ? AND state = 'checking'`,
    args: [`Shelby could not be reached to confirm the store (${f.error.slice(0, 200)}). Use Check again.`, Date.now(), Date.now(), String(job.payload.anchorId ?? "")],
  });
}

/** Stores reported before this part existed get a check of their own. */
export async function backfillAnchorChecks(): Promise<number> {
  const list = await pendingWithoutCheck();
  for (const a of list) await queueAnchorCheck(a.videoId, a.id);
  return list.length;
}
