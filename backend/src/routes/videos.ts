// src/routes/videos.ts
import { Router } from "express";
import fs from "fs/promises";
import { store } from "../lib/store.js";
// vm_jobs: processing runs as durable jobs, not inside the request
import { listJobs, retryJob, deleteJobsForVideo } from "../lib/jobs.js";
import { nudgeRunner } from "../lib/runner.js";
import { NOT_RETRYABLE, statusForStage } from "../services/pipeline.js";
import { shelbyBlobUrl } from "../lib/shelbyClient.js";
import type { VideoRecord } from "../types/video.js";
// vm_apiguard: wallet checks and rate limits, see src/lib/guard.ts
import { limitUpload, limitPipeline, limitDelete } from "../lib/guard.js";
// vm_signin: the caller is the signed in wallet, never a value they send
import { requireAuth, optionalAuth, authOf, sameWallet } from "../lib/auth.js";
// vm_storage: every file of a video lives in storage
import { getStorage, ObjectMissingError } from "../lib/storage.js";
import { getOriginal, deleteAssetsForVideo } from "../lib/assets.js";
// vm_upload: files arrive through /api/uploads (see src/routes/uploads.ts).
// The old reserve, prepare and confirm routes are gone.
import { abortUpload } from "../lib/uploads.js";

const router = Router();

/** Remove a video's stored files, its jobs and any unfinished upload. Call before deleting the video. */
async function dropVideoWork(id: string): Promise<void> {
  const src = await store.getSourcePath(id);
  if (src) await fs.unlink(src).catch(() => {});
  await deleteJobsForVideo(id);
  await abortUpload(id, { keepVideo: true }).catch((err) =>
    console.error(`[uploads] could not discard the unfinished upload of ${id}: ${err?.message ?? err}`));
  // If storage cannot be reached the asset rows stay, and the hourly
  // sweep removes the files later. Deleting the video still succeeds.
  await deleteAssetsForVideo(id).catch((err) =>
    console.error(`[storage] could not delete the files of ${id} now, the sweep will retry: ${err?.message ?? err}`));
}

/** How long a playback address stays valid. */
const PLAY_URL_SECONDS = 12 * 60 * 60;

/** True once the owner has stored the file on Shelby. */
const onShelby = (v: VideoRecord) => !!v.shelby.accountAddress && !!v.shelby.videoTxHash;

const STAGE_LABEL: Record<string, string> = { transcribe: "Transcription", analyze: "Analysis" };

/** True if this wallet reserved the video or its Shelby blob belongs to it. */
function ownsVideo(video: VideoRecord, wallet: string): boolean {
  return sameWallet(video.ownerWallet, wallet) || sameWallet(video.shelby.accountAddress, wallet);
}
const NOT_OWNER = { error: "This video belongs to a different wallet.", code: "not_owner" };

// ── POST /api/videos/:id/anchor ──────────────────────────────────────────────
// vm_upload: the owner's wallet has stored the file on Shelby. Record
// where, so the ownership proof can be shown. Storing on Shelby is its
// own step after the upload, and can be done or repeated at any time.
router.post("/:id/anchor", limitUpload, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const { accountAddress, txHash } = (req.body ?? {}) as { accountAddress?: string; txHash?: string };
    if (!accountAddress || !txHash) return res.status(400).json({ error: "accountAddress and txHash are required" });
    // The Shelby blob must belong to the signed in wallet.
    if (!sameWallet(accountAddress, wallet)) {
      return res.status(403).json({ error: "accountAddress must be the signed in wallet.", code: "not_owner" });
    }
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, wallet)) return res.status(403).json(NOT_OWNER);
    if (video.status === "uploading") return res.status(409).json({ error: "Finish the upload first.", code: "not_uploaded" });

    await store.update(video.id, {
      shelby: { videoBlobName: video.shelby.videoBlobName, accountAddress: wallet, videoTxHash: String(txHash).slice(0, 200) },
    });
    return res.json({ id: video.id, onShelby: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos?wallet=0x... ─────────────────────────────────────────────
// Returns the signed in wallet's videos. Any wallet value sent by the
// caller is ignored.
router.get("/", requireAuth, async (req, res) => {
  try {
    const videos = await store.getAll(authOf(req)!.wallet);
    return res.json({ videos });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id ─────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    // vm_upload: play from our own storage when the original is there,
    // otherwise from Shelby. Storage is the copy made for delivery.
    const original = video.status === "uploading" ? null : await getOriginal(video.id);
    let streamUrl: string | null = null;
    let source: "storage" | "shelby" | null = null;
    if (original) {
      streamUrl = (await getStorage().signedUrl(original.key, PLAY_URL_SECONDS).catch(() => null))
        ?? `/api/videos/${video.id}/file`;       // local disk storage has no signed addresses
      source = "storage";
    } else if (onShelby(video) && video.shelby.videoBlobName) {
      streamUrl = shelbyBlobUrl(video.shelby.videoBlobName, video.shelby.accountAddress);
      source = "shelby";
    }

    return res.json({ ...video, streamUrl, source, onShelby: onShelby(video) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id/file ────────────────────────────────────────────────
// vm_upload: local disk storage only (development). Streams the original
// with range support so the player can seek. With S3 storage the player
// gets a signed address to the bucket instead and this answers 404.
router.get("/:id/file", async (req, res) => {
  try {
    const storage = getStorage();
    const original = storage.driver === "local" ? await getOriginal(req.params.id) : null;
    if (!original) return res.status(404).json({ error: "Not found" });
    await storage.withLocalFile(original.key, (filePath) => new Promise<void>((resolve, reject) => {
      res.type(original.contentType ?? "video/mp4");
      res.sendFile(filePath, { acceptRanges: true }, (err) => (err && !res.headersSent ? reject(err) : resolve()));
    }));
  } catch (err: any) {
    if (err instanceof ObjectMissingError) return res.status(404).json({ error: "Not found" });
    if (!res.headersSent) return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id/status ──────────────────────────────────────────────
router.get("/:id/status", async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    return res.json({ id: video.id, status: video.status });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id/jobs ──────────────────────────────────────────────────
// vm_jobs: the processing stages of one video and where each stands.
// Anyone with the link sees the stages. Only the owner sees the failure
// text and is offered a retry.
router.get("/:id/jobs", optionalAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    const wallet = authOf(req)?.wallet;
    const owner = !!wallet && ownsVideo(video, wallet);
    const jobs = (await listJobs(req.params.id)).map((j) => ({
      kind: j.kind,
      label: STAGE_LABEL[j.kind] ?? j.kind,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      nextAttemptAt: j.status === "queued" && j.attempts > 0 ? j.runAfter : null,
      error: owner ? j.error : null,
      // vm_upload: lets the page give the right advice for this kind of failure
      errorCode: owner ? j.errorCode ?? null : null,
      canRetry: owner && j.status === "failed" && !NOT_RETRYABLE.has(j.errorCode ?? ""),
    }));
    return res.json({ id: video.id, status: video.status, jobs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/videos/:id/jobs/:kind/retry ──────────────────────────────────────
// vm_jobs: run one failed stage again. Stages that already finished are
// not repeated.
router.post("/:id/jobs/:kind/retry", limitPipeline, requireAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, authOf(req)!.wallet)) return res.status(403).json(NOT_OWNER);

    const failed = (await listJobs(video.id)).find((j) => j.kind === req.params.kind && j.status === "failed");
    if (!failed) return res.status(409).json({ error: "That step is not in a failed state." });
    if (NOT_RETRYABLE.has(failed.errorCode ?? "")) {
      return res.status(409).json({ error: failed.error ?? "That step cannot be retried." });
    }

    const job = await retryJob(video.id, req.params.kind);
    if (!job) return res.status(409).json({ error: "That step is not in a failed state." });
    await store.update(video.id, { status: statusForStage(job.kind) });
    nudgeRunner();
    return res.status(202).json({ id: video.id, status: statusForStage(job.kind) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/videos/:id/duration ───────────────────────────────────────────
// Called once by the frontend player when video metadata loads.
router.patch("/:id/duration", requireAuth, async (req, res) => {
  try {
    const { durationSeconds } = req.body as { durationSeconds: number };
    if (typeof durationSeconds !== "number" || !isFinite(durationSeconds) || durationSeconds <= 0) {
      return res.status(400).json({ error: "durationSeconds must be a positive number" });
    }

    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, authOf(req)!.wallet)) return res.status(403).json(NOT_OWNER);

    await store.update(req.params.id, {
      meta: { ...video.meta, durationSeconds },
    });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/videos/all?wallet=0x... ─────────────────────────────────────
// Deletes all of the signed in wallet's videos. Any wallet value sent by
// the caller is ignored.
router.delete("/all", limitDelete, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    for (const v of await store.getAll(wallet)) await dropVideoWork(v.id);
    const count = await store.deleteAll(wallet);
    return res.json({
      success: true,
      deleted: count,
      message: `Deleted ${count} video(s) for wallet ${wallet.slice(0, 8)}...`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/videos/:id ───────────────────────────────────────────────────
router.delete("/:id", limitDelete, requireAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, authOf(req)!.wallet)) return res.status(403).json(NOT_OWNER);
    await dropVideoWork(req.params.id);
    await store.delete(req.params.id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
