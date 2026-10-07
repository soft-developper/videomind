// src/routes/learn.ts
import { Router } from "express";
import { store } from "../lib/store.js";
import { getDb } from "../lib/db.js";
import { generateLearningPaths, askLibrary } from "../services/learningService.js";
// vm_apiguard: wallet checks and rate limits, see src/lib/guard.ts
import { limitAi, takeBudget, AI_LIMIT } from "../lib/guard.js";
// vm_signin: the caller is the signed in wallet, never a value they send
import { requireAuth, authOf } from "../lib/auth.js";
// vm_storage: AI usage is written to the ledger
import { withUsage } from "../lib/usage.js";

const router = Router();

const MIN_VIDEOS_FOR_PATHS = 3;

// ── GET /api/learn/paths?wallet=0x... ────────────────────────────────────────
// Returns cached paths if the video count hasn't changed since generation.
router.get("/paths", requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;

    const videos = (await store.getReady(wallet)).filter((v) => v.ai?.summary);

    if (videos.length < MIN_VIDEOS_FOR_PATHS) {
      return res.json({
        paths: [],
        videoCount: videos.length,
        minRequired: MIN_VIDEOS_FOR_PATHS,
        cached: false,
      });
    }

    const db = getDb();
    const cachedRes = await db.execute({
      sql: "SELECT paths_json, video_count, generated_at FROM learning_paths WHERE wallet_address = ?",
      args: [wallet],
    });

    const cached = cachedRes.rows[0] as Record<string, unknown> | undefined;

    // Cache hit, same number of videos as when generated
    if (cached && Number(cached.video_count) === videos.length) {
      return res.json({
        paths: JSON.parse(cached.paths_json as string),
        videoCount: videos.length,
        generatedAt: Number(cached.generated_at),
        cached: true,
      });
    }

    // Cache miss, generate fresh. Only this branch calls Claude, so only
    // this branch takes AI budget. Cached page loads are free.
    if (!takeBudget(AI_LIMIT, req, res)) return;
    const paths = await withUsage(
      { feature: "learn_paths", ownerWallet: wallet, actorWallet: wallet },
      () => generateLearningPaths(videos));
    const now = Date.now();

    await db.execute({
      sql: `INSERT INTO learning_paths (wallet_address, paths_json, video_count, generated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(wallet_address) DO UPDATE SET
              paths_json   = excluded.paths_json,
              video_count  = excluded.video_count,
              generated_at = excluded.generated_at`,
      args: [wallet, JSON.stringify(paths), videos.length, now],
    });

    return res.json({ paths, videoCount: videos.length, generatedAt: now, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/learn/paths/regenerate ─────────────────────────────────────────
// Force a fresh generation, bypassing the cache.
router.post("/paths/regenerate", limitAi, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;

    const videos = (await store.getReady(wallet)).filter((v) => v.ai?.summary);
    if (videos.length < MIN_VIDEOS_FOR_PATHS) {
      return res.status(400).json({
        error: `Need at least ${MIN_VIDEOS_FOR_PATHS} processed videos to build learning paths.`,
      });
    }

    const paths = await withUsage(
      { feature: "learn_paths", ownerWallet: wallet, actorWallet: wallet },
      () => generateLearningPaths(videos));
    const now = Date.now();
    const db = getDb();

    await db.execute({
      sql: `INSERT INTO learning_paths (wallet_address, paths_json, video_count, generated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(wallet_address) DO UPDATE SET
              paths_json   = excluded.paths_json,
              video_count  = excluded.video_count,
              generated_at = excluded.generated_at`,
      args: [wallet, JSON.stringify(paths), videos.length, now],
    });

    return res.json({ paths, videoCount: videos.length, generatedAt: now, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/learn/ask ──────────────────────────────────────────────────────
// Cross-video library assistant.
router.post("/ask", limitAi, requireAuth, async (req, res) => {
  try {
    const { question } = req.body as { question: string };
    if (!question?.trim()) return res.status(400).json({ error: "question is required" });
    const wallet = authOf(req)!.wallet;

    const videos = (await store.getReady(wallet)).filter((v) => v.ai?.transcript?.length);

    if (videos.length === 0) {
      return res.json({
        answer: "You don't have any processed videos yet. Upload a video first.",
        citations: [],
        videosUsed: [],
      });
    }

    const result = await withUsage(
      { feature: "learn_ask", ownerWallet: wallet, actorWallet: wallet },
      () => askLibrary(question, videos));
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
