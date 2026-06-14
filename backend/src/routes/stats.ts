import { Router } from "express";
import { store } from "../lib/store.js";

const router = Router();

// GET /api/shelby/stats?wallet=0x...
router.get("/stats", async (req, res) => {
  try {
    const wallet = req.query.wallet as string | undefined;
    const videos = await store.getAll(wallet);
    const ready = videos.filter((v) => v.status === "ready");

    return res.json({
      totalVideos: videos.length,
      readyVideos: ready.length,
      blobCount:   videos.filter((v) => v.shelby.videoBlobName).length,
      processing:  videos.filter((v) =>
        ["uploading", "transcribing", "analyzing"].includes(v.status)
      ).length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
