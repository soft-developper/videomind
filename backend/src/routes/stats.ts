import { Router } from "express";
import { store } from "../lib/store.js";
// vm_signin: counts are for the signed in wallet
import { optionalAuth, authOf } from "../lib/auth.js";

const router = Router();

// GET /api/shelby/stats?wallet=0x...
router.get("/stats", optionalAuth, async (req, res) => {
  try {
    // Counts for the signed in wallet. Nobody signed in means zero.
    const wallet = authOf(req)?.wallet;
    const videos = wallet ? await store.getAll(wallet) : [];
    const ready = videos.filter((v) => v.status === "ready");

    return res.json({
      totalVideos: videos.length,
      readyVideos: ready.length,
      // vm_upload: only videos the owner has stored on Shelby
      blobCount:   videos.filter((v) => v.shelby.accountAddress && v.shelby.videoTxHash).length,
      processing:  videos.filter((v) =>
        ["uploading", "transcribing", "analyzing"].includes(v.status)
      ).length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
