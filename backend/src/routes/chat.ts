import { Router } from "express";
import { store } from "../lib/store.js";
import { chatWithVideo } from "../services/aiPipeline.js";
import { findPassages, groupHits, notIndexed } from "../services/search.js";
import { claudeFailure } from "../services/claude.js";
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
    const f = claudeFailure(err);
    if (f) return res.status(f.status).json({ error: f.error, code: f.code });
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/search/all
// vm_search: searches every passage of the signed in wallet's ready videos
// and returns the moments that match, best first, grouped by video.
// Claude is not called; the question is embedded and compared.
router.post("/search/all", limitAi, requireAuth, async (req, res) => {
  try {
    const query = String((req.body as { query?: unknown })?.query ?? "").trim();
    if (!query) return res.status(400).json({ error: "query is required" });
    if (query.length > 500) return res.status(400).json({ error: "Keep the search under 500 characters.", code: "too_long" });
    const wallet = authOf(req)!.wallet;

    const hits = await withUsage({ feature: "search", ownerWallet: wallet, actorWallet: wallet }, () => findPassages(wallet, query));
    return res.json({ results: groupHits(hits), notIndexed: await notIndexed(wallet) });
  } catch (err: any) {
    const status = Number(err?.status);
    if (status === 429 || status >= 500 || err?.name === "APIConnectionError" || err?.name === "APIConnectionTimeoutError") {
      return res.status(503).json({ error: "Search is busy. Please try again in a minute.", code: "busy" });
    }
    console.error(`[search] failed: ${err?.message ?? err}`);
    return res.status(500).json({ error: "Search hit a problem. Please try again." });
  }
});

export default router;
