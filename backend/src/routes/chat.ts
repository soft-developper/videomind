import { Router } from "express";
import { store } from "../lib/store.js";
import { chatWithVideo, semanticSearch } from "../services/aiPipeline.js";
// vm_apiguard: wallet checks and rate limits, see src/lib/guard.ts
import { limitAi } from "../lib/guard.js";
// vm_signin: the caller is the signed in wallet, never a value they send
import { requireAuth, optionalAuth, authOf } from "../lib/auth.js";
// vm_storage: AI usage is written to the ledger against the video's owner
import { withUsage, ownerOf } from "../lib/usage.js";
// vm_info: a private video answers questions only for its owner
import { canView, PRIVATE_VIDEO } from "../lib/videoInfo.js";

const router = Router();

// POST /api/chat/:videoId
router.post("/:videoId", limitAi, optionalAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.videoId);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!canView(video, authOf(req)?.wallet)) return res.status(403).json(PRIVATE_VIDEO);
    if (video.status !== "ready") return res.status(400).json({ error: "Video is still processing" });
    if (!video.ai?.transcript) return res.status(400).json({ error: "Transcript not available" });

    const { question } = req.body as { question: string };
    if (!question?.trim()) return res.status(400).json({ error: "question is required" });

    // A question on a video counts against the video's owner. The asker
    // is recorded too, or left empty for a visitor.
    const result = await withUsage(
      { feature: "ask", ownerWallet: ownerOf(video), actorWallet: authOf(req)?.wallet ?? null, videoId: video.id },
      () => chatWithVideo(video.ai!.transcript!, question, video.title));
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/search/all
// Searches the signed in wallet's videos only.
router.post("/search/all", limitAi, requireAuth, async (req, res) => {
  try {
    const { query } = req.body as { query: string };
    if (!query?.trim()) return res.status(400).json({ error: "query is required" });
    const wallet = authOf(req)!.wallet;

    const readyVideos = (await store.getReady(wallet)).filter((v) => v.ai?.transcript);

    if (readyVideos.length === 0) {
      return res.json({ results: [], message: "No videos available for search" });
    }

    const results = await withUsage(
      { feature: "search", ownerWallet: wallet, actorWallet: wallet },
      () => semanticSearch(
        query,
        readyVideos.map((v) => ({ id: v.id, title: v.title, transcript: v.ai!.transcript! }))
      ));

    return res.json({ results });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
