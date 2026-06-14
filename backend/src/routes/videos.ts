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

// ── POST /api/videos/prepare ────────────────────────────────────────────────
router.post("/prepare", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No video file provided" });

    const id = uuidv4();
    const ext = path.extname(req.file.originalname) || ".mp4";
    const title =
      (req.body.title as string) ||
      path.basename(req.file.originalname, ext).replace(/[-_]/g, " ");
    const description = (req.body.description as string) || "";
    const videoBlobName = `videomind/videos/${id}/raw${ext}`;

    // Rename temp file to include extension (Whisper needs it)
    const namedFilePath = `${req.file.path}${ext}`;
    await fs.rename(req.file.path, namedFilePath);

    const fileBuffer = await fs.readFile(namedFilePath);
    const base64Data = fileBuffer.toString("base64");

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
    pendingFiles.set(id, { filePath: namedFilePath, ext });

    return res.status(200).json({ id, videoBlobName, base64Data, mimeType: req.file.mimetype });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/videos/confirm ────────────────────────────────────────────────
router.post("/confirm", async (req, res) => {
  try {
    const { id, accountAddress, txHash, videoBlobName } = req.body as {
      id: string; accountAddress: string; txHash: string; videoBlobName: string;
    };

    if (!id || !accountAddress || !txHash) {
      return res.status(400).json({ error: "id, accountAddress, and txHash are required" });
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
// If no wallet param, returns all (admin use only).
router.get("/", async (req, res) => {
  try {
    const wallet = req.query.wallet as string | undefined;
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

// ── DELETE /api/videos/all?wallet=0x... ─────────────────────────────────────
// Deletes all videos for a wallet (or all videos if no wallet param).
// Used for cleanup of test uploads.
router.delete("/all", async (req, res) => {
  try {
    const wallet = req.query.wallet as string | undefined;
    const count = await store.deleteAll(wallet);
    return res.json({
      success: true,
      deleted: count,
      message: `Deleted ${count} video(s)${wallet ? ` for wallet ${wallet.slice(0, 8)}...` : ""}`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/videos/:id ───────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
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
