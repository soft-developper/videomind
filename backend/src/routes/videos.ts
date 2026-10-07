// src/routes/videos.ts
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { store } from "../lib/store.js";
// vm_jobs: processing runs as durable jobs, not inside the request
import { enqueueJob, listJobs, retryJob, deleteJobsForVideo } from "../lib/jobs.js";
import { nudgeRunner } from "../lib/runner.js";
import { NOT_RETRYABLE, statusForStage } from "../services/pipeline.js";
import { shelbyBlobUrl } from "../lib/shelbyClient.js";
import type { VideoRecord } from "../types/video.js";
// vm_apiguard: wallet checks and rate limits, see src/lib/guard.ts
import { limitUpload, limitPipeline, limitDelete } from "../lib/guard.js";
// vm_signin: the caller is the signed in wallet, never a value they send
import { requireAuth, optionalAuth, authOf, sameWallet } from "../lib/auth.js";
// vm_storage: uploads go into storage, not onto this machine's disk
import { storageHealth, checkStorage } from "../lib/storage.js";
import { saveOriginal, getOriginal, deleteAssetsForVideo, isVideoId } from "../lib/assets.js";
import type { Request, Response, NextFunction } from "express";

const router = Router();

const upload = multer({
  dest: path.resolve("uploads"),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "video/mp4", "video/webm", "video/mov",
      "video/avi", "video/mkv", "video/quicktime",
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

/** Remove a video's stored files and its jobs. Call before deleting the video. */
async function dropVideoWork(id: string): Promise<void> {
  const src = await store.getSourcePath(id);
  if (src) await fs.unlink(src).catch(() => {});
  await deleteJobsForVideo(id);
  // If storage cannot be reached the asset rows stay, and the hourly
  // sweep removes the files later. Deleting the video still succeeds.
  await deleteAssetsForVideo(id).catch((err) =>
    console.error(`[storage] could not delete the files of ${id} now, the sweep will retry: ${err?.message ?? err}`));
}

/**
 * Refuse an upload BEFORE the file is received when storage is not
 * working, so nobody waits through a long upload that cannot be kept.
 * A failed check is tried again at most every 30 seconds.
 */
let lastRecheck = 0;
async function requireStorage(_req: Request, res: Response, next: NextFunction) {
  if (!storageHealth().ok && Date.now() - lastRecheck > 30_000) {
    lastRecheck = Date.now();
    await checkStorage().catch(() => false);
  }
  if (storageHealth().ok) return next();
  return res.status(503).json({
    error: "Video storage is not available right now. Please try again in a few minutes.",
    code: "storage_unavailable",
  });
}

const STAGE_LABEL: Record<string, string> = { transcribe: "Transcription", analyze: "Analysis" };

/** True if this wallet reserved the video or its Shelby blob belongs to it. */
function ownsVideo(video: VideoRecord, wallet: string): boolean {
  return sameWallet(video.ownerWallet, wallet) || sameWallet(video.shelby.accountAddress, wallet);
}
const NOT_OWNER = { error: "This video belongs to a different wallet.", code: "not_owner" };

// ── POST /api/videos/reserve ────────────────────────────────────────────────
// Instant, no file. Reserves an id + blob name so the browser can start the
// Shelby wallet upload in parallel with the (separate) file upload to /prepare.
router.post("/reserve", limitUpload, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const id = uuidv4();
    const originalName = (req.body.filename as string) || "video.mp4";
    const ext = path.extname(originalName) || ".mp4";
    const title =
      (req.body.title as string) ||
      path.basename(originalName, ext).replace(/[-_]/g, " ");
    const description = (req.body.description as string) || "";
    const mimeType = (req.body.mimeType as string) || "video/mp4";
    const videoBlobName = `videomind/videos/${id}/raw${ext}`;

    const record: VideoRecord = {
      id,
      title,
      description,
      createdAt: Date.now(),
      status: "uploading",
      ownerWallet: wallet,
      shelby: { videoBlobName, accountAddress: "", videoTxHash: "" },
      meta: { sizeBytes: 0, mimeType },
    };
    await store.set(id, record);

    return res.status(200).json({ id, videoBlobName, mimeType });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/videos/prepare ────────────────────────────────────────────────
// The limiter and the sign in check run BEFORE multer, so a rejected
// request never writes the file.
router.post("/prepare", limitUpload, requireAuth, requireStorage, upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No video file provided" });
    const wallet = authOf(req)!.wallet;

    const ext = path.extname(req.file.originalname) || ".mp4";
    const namedFilePath = req.file.path;

    // The id becomes part of a storage key, so it must be a real id.
    if (req.body.id && !isVideoId(req.body.id)) {
      await fs.unlink(namedFilePath).catch(() => {});
      return res.status(400).json({ error: "id is not a valid video id" });
    }

    // If the browser reserved an id first (parallel-upload flow), reuse it.
    // Otherwise fall back to the original create-here behaviour (backward
    // compatible: a direct /prepare call with no reservedId still works).
    const reservedId = (req.body.id as string) || undefined;
    let id: string;
    let videoBlobName: string;

    const existing = reservedId ? await store.get(reservedId) : undefined;
    if (existing && !ownsVideo(existing, wallet)) {
      await fs.unlink(namedFilePath).catch(() => {});
      return res.status(403).json(NOT_OWNER);
    }
    // Once a video is confirmed its original is fixed. The transcript,
    // the recorded sha256 and the Shelby copy all describe that file.
    if (existing && existing.status !== "uploading") {
      await fs.unlink(namedFilePath).catch(() => {});
      return res.status(409).json({ error: "This video was already uploaded. Start a new upload instead.", code: "already_uploaded" });
    }
    if (existing) {
      id = existing.id;
      videoBlobName = existing.shelby.videoBlobName;
      await store.update(id, {
        meta: { sizeBytes: req.file.size, mimeType: req.file.mimetype },
      });
    } else {
      id = reservedId || uuidv4();
      const title =
        (req.body.title as string) ||
        path.basename(req.file.originalname, ext).replace(/[-_]/g, " ");
      const description = (req.body.description as string) || "";
      videoBlobName = `videomind/videos/${id}/raw${ext}`;
      const record: VideoRecord = {
        id,
        title,
        description,
        createdAt: Date.now(),
        status: "uploading",
        ownerWallet: wallet,
        shelby: { videoBlobName, accountAddress: "", videoTxHash: "" },
        meta: { sizeBytes: req.file.size, mimeType: req.file.mimetype },
      };
      await store.set(id, record);
    }
    // Move the file into storage as this video's original. A second
    // upload for the same reservation replaces the first.
    try {
      await saveOriginal({ videoId: id, filePath: namedFilePath, ext, contentType: req.file.mimetype, ownerWallet: wallet });
    } catch (err: any) {
      console.error(`[storage] could not store the original of ${id}: ${err?.name ?? "Error"}: ${err?.message ?? err}`);
      await fs.unlink(namedFilePath).catch(() => {});
      return res.status(502).json({ error: "The video file could not be stored. Please try again.", code: "storage_failed" });
    }

    // No base64Data here anymore. The browser already has the raw File
    // object it just uploaded from -- it reads bytes for the Shelby
    // wallet upload directly via file.arrayBuffer(), instantly, with
    // no round trip.
    return res.status(200).json({ id, videoBlobName, mimeType: req.file.mimetype });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/videos/confirm ────────────────────────────────────────────────
router.post("/confirm", limitPipeline, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const { id, accountAddress, txHash, videoBlobName } = req.body as {
      id: string; accountAddress: string; txHash: string; videoBlobName: string;
    };

    if (!id || !accountAddress || !txHash) {
      return res.status(400).json({ error: "id, accountAddress, and txHash are required" });
    }
    // The Shelby blob must belong to the signed in wallet.
    if (!sameWallet(accountAddress, wallet)) {
      return res.status(403).json({ error: "accountAddress must be the signed in wallet.", code: "not_owner" });
    }

    const video = await store.get(id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, wallet)) return res.status(403).json(NOT_OWNER);

    if (!(await getOriginal(id)) && !(await store.getSourcePath(id))) {
      return res.status(400).json({ error: "No pending file found. Did you call /prepare first?" });
    }

    await store.update(id, {
      shelby: { videoBlobName, accountAddress: wallet, videoTxHash: txHash },
    });

    // One transcribe job per video. Confirming twice adds nothing.
    const { created } = await enqueueJob({ videoId: id, kind: "transcribe" });
    if (created) await store.update(id, { status: "transcribing" });
    nudgeRunner();

    return res.status(202).json({ id, status: "transcribing" });
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

    const streamUrl = video.shelby.videoBlobName && video.shelby.accountAddress
      ? shelbyBlobUrl(video.shelby.videoBlobName, video.shelby.accountAddress)
      : null;

    return res.json({ ...video, streamUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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
