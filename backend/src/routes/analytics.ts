// src/routes/analytics.ts
// vm_analytics:
//   POST /api/videos/:id/views   { tab, watched, reached }   a player reports its plays (anyone)
//   GET  /api/me/analytics?days=28&video=<id>                 the owner's numbers
import express, { Router } from "express";
import { store } from "../lib/store.js";
import { optionalAuth, requireAuth, authOf } from "../lib/auth.js";
import { rateLimit, clientKey } from "../lib/guard.js";
import { canView, ownsVideo } from "../lib/videoInfo.js";
import { parseReport, recordView, ViewError } from "../lib/views.js";
import { ownerAnalytics, RANGES } from "../lib/analytics.js";

export const viewsRouter = Router();
export const analyticsRouter = Router();

// A player reports when a view starts, every 30 seconds of playing, on pause and on leaving.
const limitViews = rateLimit({
  name: "views",
  label: "play reports",
  perClient: { max: Number(process.env.LIMIT_VIEWS_PER_CLIENT_10MIN) || 300, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_VIEWS_GLOBAL_10MIN) || 30000, windowMs: 10 * 60_000 },
});

viewsRouter.post("/:id/views", limitViews, express.text({ type: "text/plain", limit: "2kb" }), optionalAuth, async (req, res) => {
  try {
    // A report sent while the page closes arrives as text/plain (no preflight), so read either.
    let body: unknown = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const r = parseReport(body);
    const video = await store.get(req.params.id);
    if (!video || video.status !== "ready") return res.status(404).json({ error: "Video not found" });
    const wallet = authOf(req)?.wallet;
    if (!canView(video, wallet)) return res.status(404).json({ error: "Video not found" });
    if (ownsVideo(video, wallet)) return res.json({ counted: false, reason: "owner" });
    const duration = video.meta?.durationSeconds ?? video.media?.durationSeconds ?? null;
    const out = await recordView(video.id, r, clientKey(req), duration);
    return res.json({ counted: out.counted, view: out.view, ...(out.reason ? { reason: out.reason } : {}) });
  } catch (err: any) {
    if (err instanceof ViewError) return res.status(400).json({ error: err.message, code: err.code });
    console.error(`[views] ${err?.message ?? err}`);
    return res.status(500).json({ error: "The play could not be counted." });
  }
});

analyticsRouter.get("/me/analytics", requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const asked = Number(req.query.days);
    const days = (RANGES as readonly number[]).includes(asked) ? asked : 28;
    let videoId: string | null = null;
    if (typeof req.query.video === "string" && req.query.video) {
      const v = await store.get(req.query.video);
      if (!v || !ownsVideo(v, wallet)) return res.status(404).json({ error: "Video not found", code: "not_found" });
      videoId = v.id;
    }
    return res.json(await ownerAnalytics(wallet, days, videoId));
  } catch (err: any) {
    console.error(`[analytics] ${err?.message ?? err}`);
    return res.status(500).json({ error: "Analytics could not be loaded." });
  }
});
