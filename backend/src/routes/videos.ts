// src/routes/videos.ts
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { store } from "../lib/store.js";
import { processVideoAI } from "../services/videoProcessor.js";
import { shelbyBlobUrl } from "../lib/shelbyClient.js";
import type { VideoRecord } from "../types/video.js";
// vm_apiguard: wallet checks and rate limits, see src/lib/guard.ts
import { isWalletAddress, limitUpload, limitPipeline, limitDelete } from "../lib/guard.js";

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

export const pendingFiles = new Map<string, { filePath: string; ext: string }>();

// ── POST /api/videos/reserve ────────────────────────────────────────────────
// Instant, no file. Reserves an id + blob name so the browser can start the
// Shelby wallet upload in parallel with the (separate) file upload to /prepare.
router.post("/reserve", limitUpload, async (req, res) => {
  try {
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
// The limiter runs BEFORE multer, so a rejected request never writes the file.
router.post("/prepare", limitUpload, upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No video file provided" });

    const ext = path.extname(req.file.originalname) || ".mp4";

    // Rename temp file to include extension (Whisper needs it)
    const namedFilePath = `${req.file.path}${ext}`;
    await fs.rename(req.file.path, namedFilePath);

    // If the browser reserved an id first (parallel-upload flow), reuse it.
    // Otherwise fall back to the original create-here behaviour (backward
    // compatible: a direct /prepare call with no reservedId still works).
    const reservedId = (req.body.id as string) || undefined;
    let id: string;
    let videoBlobName: string;

    const existing = reservedId ? await store.get(reservedId) : undefined;
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
        shelby: { videoBlobName, accountAddress: "", videoTxHash: "" },
        meta: { sizeBytes: req.file.size, mimeType: req.file.mimetype },
      };
      await store.set(id, record);
    }
    pendingFiles.set(id, { filePath: namedFilePath, ext });

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
router.post("/confirm", limitPipeline, async (req, res) => {
  try {
    const { id, accountAddress, txHash, videoBlobName } = req.body as {
      id: string; accountAddress: string; txHash: string; videoBlobName: string;
    };

    if (!id || !accountAddress || !txHash) {
      return res.status(400).json({ error: "id, accountAddress, and txHash are required" });
    }
    if (!isWalletAddress(accountAddress)) {
      return res.status(400).json({ error: "accountAddress is not a valid wallet address" });
    }

    const video = await store.get(id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    const pending = pendingFiles.get(id);
    if (!pending) {
      return res.status(400).json({ error: "No pending file found. Did you call /prepare first?" });
    }

    await store.update(id, {
      status: "transcribing",
      shelby: { videoBlobName, accountAddress, videoTxHash: txHash },
    });

    processVideoAI(id, pending.filePath, accountAddress).catch(console.error);

    return res.status(202).json({ id, status: "transcribing" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos?wallet=0x... ─────────────────────────────────────────────
// Returns only videos uploaded by the given wallet address.
// A wallet is REQUIRED. This route used to return every video on the
// platform when no wallet was sent.
router.get("/", async (req, res) => {
  try {
    const wallet = req.query.wallet;
    if (!isWalletAddress(wallet)) {
      return res.status(400).json({ error: "A valid wallet address is required" });
    }
    const videos = await store.getAll(wallet);
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

// ── PATCH /api/videos/:id/duration ───────────────────────────────────────────
// Called once by the frontend player when video metadata loads.
router.patch("/:id/duration", async (req, res) => {
  try {
    const { durationSeconds } = req.body as { durationSeconds: number };
    if (typeof durationSeconds !== "number" || !isFinite(durationSeconds) || durationSeconds <= 0) {
      return res.status(400).json({ error: "durationSeconds must be a positive number" });
    }

    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });

    await store.update(req.params.id, {
      meta: { ...video.meta, durationSeconds },
    });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/videos/all?wallet=0x... ─────────────────────────────────────
// Deletes all videos for ONE wallet. A wallet is REQUIRED. This route
// used to delete every video on the platform when no wallet was sent.
router.delete("/all", limitDelete, async (req, res) => {
  try {
    const wallet = req.query.wallet;
    if (!isWalletAddress(wallet)) {
      return res.status(400).json({ error: "A valid wallet address is required" });
    }
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
router.delete("/:id", limitDelete, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    await store.delete(req.params.id);
    const pending = pendingFiles.get(req.params.id);
    if (pending) {
      await fs.unlink(pending.filePath).catch(() => {});
      pendingFiles.delete(req.params.id);
    }
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
