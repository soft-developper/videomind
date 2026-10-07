import { Router } from "express";
import { store } from "../lib/store.js";
import { chatWithVideo, semanticSearch } from "../services/aiPipeline.js";
// vm_apiguard: wallet checks and rate limits, see src/lib/guard.ts
import { isWalletAddress, limitAi } from "../lib/guard.js";

const router = Router();

// POST /api/chat/:videoId
router.post("/:videoId", limitAi, async (req, res) => {
  try {
    const video = await store.get(req.params.videoId);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (video.status !== "ready") return res.status(400).json({ error: "Video is still processing" });
    if (!video.ai?.transcript) return res.status(400).json({ error: "Transcript not available" });

    const { question } = req.body as { question: string };
    if (!question?.trim()) return res.status(400).json({ error: "question is required" });

    const result = await chatWithVideo(video.ai.transcript, question, video.title);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/search/all
// Searches ONE wallet's videos. Without a wallet it returns nothing. This
// route used to search every wallet's transcripts when no wallet was sent.
router.post("/search/all", limitAi, async (req, res) => {
  try {
    const { query, wallet } = req.body as { query: string; wallet?: string };
    if (!query?.trim()) return res.status(400).json({ error: "query is required" });
    if (!isWalletAddress(wallet)) {
      return res.json({ results: [], message: "Connect a wallet to search your videos" });
    }

    const readyVideos = (await store.getReady(wallet)).filter((v) => v.ai?.transcript);

    if (readyVideos.length === 0) {
      return res.json({ results: [], message: "No videos available for search" });
    }

    const results = await semanticSearch(
      query,
      readyVideos.map((v) => ({ id: v.id, title: v.title, transcript: v.ai!.transcript! }))
    );

    return res.json({ results });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
