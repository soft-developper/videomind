// src/routes/progress.ts
// vm_progress: picking up where the viewer stopped.
//   GET    /api/videos/:id/progress   where this wallet stopped, and where to resume
//   PUT    /api/videos/:id/progress   { positionSeconds, durationSeconds? }
//   DELETE /api/videos/:id/progress   start over
//   GET    /api/progress              this wallet's videos in progress, for Home and the library
// Private to the wallet. The video must be one the wallet can open.
import { Router } from "express";
import { store } from "../lib/store.js";
import { getDb } from "../lib/db.js";
import { requireAuth, authOf } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { canView, PRIVATE_VIDEO } from "../lib/videoInfo.js";
import { saveProgress, getProgress, listProgress, clearProgress, finished, ProgressError, RESUME_AFTER } from "../lib/progress.js";
import { thumbUrls } from "./videos.js";
import type { VideoRecord } from "../types/video.js";

const router = Router();

// A player reports every few seconds while playing, so this is generous.
const limitProgress = rateLimit({
  name: "progress",
  label: "progress saves",
  perClient: { max: Number(process.env.LIMIT_PROGRESS_PER_CLIENT_10MIN) || 600, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_PROGRESS_GLOBAL_10MIN) || 20000, windowMs: 10 * 60_000 },
});

async function videoFor(req: any, res: any): Promise<VideoRecord | null> {
  const video = await store.get(req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return null; }
  if (!canView(video, authOf(req)!.wallet)) { res.status(403).json(PRIVATE_VIDEO); return null; }
  return video;
}
const lengthOf = (v: VideoRecord) => v.meta?.durationSeconds ?? v.media?.durationSeconds ?? null;
const resumeAt = (p: { positionSeconds: number; durationSeconds: number | null } | null) =>
  p && p.positionSeconds >= RESUME_AFTER && !finished(p.positionSeconds, p.durationSeconds) ? p.positionSeconds : null;

router.get("/videos/:id/progress", requireAuth, async (req, res) => {
  try {
    const video = await videoFor(req, res); if (!video) return;
    const p = await getProgress(authOf(req)!.wallet, video.id);
    return res.json({ progress: p, resumeAt: resumeAt(p) });
  } catch (err: any) { return res.status(500).json({ error: "Progress could not be read." }); }
});

router.put("/videos/:id/progress", limitProgress, requireAuth, async (req, res) => {
  try {
    const video = await videoFor(req, res); if (!video) return;
    const p = await saveProgress(authOf(req)!.wallet, video.id, req.body, lengthOf(video));
    return res.json({ progress: p, resumeAt: resumeAt(p) });
  } catch (err: any) {
    if (err instanceof ProgressError) return res.status(400).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: "Progress could not be saved." });
  }
});

router.delete("/videos/:id/progress", limitProgress, requireAuth, async (req, res) => {
  try {
    const video = await videoFor(req, res); if (!video) return;
    await clearProgress(authOf(req)!.wallet, video.id);
    return res.status(204).end();
  } catch { return res.status(500).json({ error: "Progress could not be cleared." }); }
});

router.get("/progress", requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const mine = await listProgress(wallet);
    if (!mine.length) return res.json({ continue: [], watched: {} });
    // Only videos that still exist, are ready, and this wallet may still open.
    const ids = mine.map((p) => p.videoId);
    const rows = (await getDb().execute({
      sql: `SELECT v.id AS id, v.title AS title, v.duration_sec AS duration_sec
              FROM videos v LEFT JOIN video_shelby s ON s.video_id = v.id
             WHERE v.id IN (${ids.map(() => "?").join(",")}) AND v.status = 'ready'
               AND (COALESCE(v.visibility, 'unlisted') != 'private' OR v.owner_wallet = ? OR s.account_address = ?)`,
      args: [...ids, wallet, wallet],
    })).rows as Array<Record<string, unknown>>;
    const open = new Map(rows.map((r) => [String(r.id), r]));
    const watched: Record<string, { positionSeconds: number; durationSeconds: number | null; finished: boolean }> = {};
    const going: Array<{ videoId: string; title: string; positionSeconds: number; durationSeconds: number | null; updatedAt: number }> = [];
    for (const p of mine) {
      const v = open.get(p.videoId); if (!v) continue;
      const dur = v.duration_sec == null ? p.durationSeconds : Number(v.duration_sec);
      const done = finished(p.positionSeconds, dur);
      watched[p.videoId] = { positionSeconds: p.positionSeconds, durationSeconds: dur, finished: done };
      if (!done && p.positionSeconds >= RESUME_AFTER && going.length < 12) {
        going.push({ videoId: p.videoId, title: String(v.title ?? "Untitled"), positionSeconds: p.positionSeconds, durationSeconds: dur, updatedAt: p.updatedAt });
      }
    }
    const thumbs = await thumbUrls(going.map((g) => g.videoId));
    return res.json({ continue: going.map((g) => ({ ...g, thumbUrl: thumbs.get(g.videoId) ?? null })), watched });
  } catch (err: any) {
    console.error(`[progress] ${err?.message ?? err}`);
    return res.status(500).json({ error: "Progress could not be read." });
  }
});

export default router;
