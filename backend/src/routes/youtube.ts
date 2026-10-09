// src/routes/youtube.ts
// vm_youtube: connecting a YouTube channel and publishing to it (see lib/youtube.ts).
//
// Mounted at /api/youtube:
//   GET  /status                   is it set up here, is this wallet connected, which account
//   POST /connect                  the Google address to send the browser to { returnTo }
//   GET  /callback                 Google sends the browser back here, then on to the site
//   POST /disconnect               forget the channel and revoke VideoMind's access
//
// Mounted at /api/videos (owner only):
//   GET  /:id/youtube                       publications of this video and a suggested description
//   POST /:id/youtube                       publish { clipId?, title, description, tags, privacy, madeForKids }
//   POST /:id/youtube/:pubId/retry          try a failed one again
import { Router } from "express";
import { store } from "../lib/store.js";
import { requireAuth, authOf, allowedOrigins } from "../lib/auth.js";
import { ownsVideo } from "../lib/videoInfo.js";
import { rateLimit } from "../lib/guard.js";
import { getDb } from "../lib/db.js";
import { getClip } from "../lib/clips.js";
import { getOriginal } from "../lib/assets.js";
import { nudgeRunner } from "../lib/runner.js";
import {
  youtubeConfig, authUrl, readState, connect, account, disconnect, parseDetails, suggestDescription,
  addPublication, getPublication, publicationsOf, uploadsToday, updatePublication, YouTubeError, type Publication,
} from "../lib/youtube.js";
import { queuePublication, YOUTUBE_JOB } from "../services/youtube.js";

export const youtubeRouter = Router();
export const youtubeVideoRouter = Router();

const limitYoutube = rateLimit({
  name: "youtube",
  label: "YouTube requests",
  perClient: { max: Number(process.env.LIMIT_YOUTUBE_PER_CLIENT_10MIN) || 60, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_YOUTUBE_GLOBAL_10MIN) || 600, windowMs: 10 * 60_000 },
});

/** Uploads one wallet may start in 24 hours. */
const perWallet = () => Number(process.env.YOUTUBE_UPLOADS_PER_DAY) || 10;
/** Google allows 100 uploads a day for the whole Cloud project; a few are kept spare. */
const perProject = () => Number(process.env.YOUTUBE_UPLOADS_PROJECT_DAY) || 90;

const NOT_SET_UP = { error: "YouTube publishing is not set up on this server.", code: "youtube_off" };
const NOT_OWNER = { error: "This video belongs to a different wallet.", code: "not_owner" };
const site = () => allowedOrigins()[0] ?? "http://localhost:3000";
/** Only a path on our own site, never another site. */
const safePath = (p: unknown) => (typeof p === "string" && /^\/(?![/\\])[^\s]*$/.test(p) ? p.slice(0, 300) : "/");

function fail(res: any, err: any) {
  if (err instanceof YouTubeError) return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message, code: err.code });
  console.error(`[youtube] ${err?.message ?? err}`);
  return res.status(500).json({ error: "Something went wrong with YouTube. Try again." });
}

youtubeRouter.get("/status", requireAuth, async (req, res) => {
  try {
    if (!youtubeConfig()) return res.json({ enabled: false, connected: false, email: null });
    const a = await account(authOf(req)!.wallet);
    return res.json({ enabled: true, connected: !!a, email: a?.email ?? null, connectedAt: a?.connectedAt ?? null });
  } catch (err) { return fail(res, err); }
});

youtubeRouter.post("/connect", limitYoutube, requireAuth, async (req, res) => {
  try {
    if (!youtubeConfig()) return res.status(503).json(NOT_SET_UP);
    return res.json({ url: authUrl(authOf(req)!.wallet, safePath(req.body?.returnTo)) });
  } catch (err) { return fail(res, err); }
});

// No sign in here: the browser arrives from Google. The signed state says which wallet asked.
youtubeRouter.get("/callback", limitYoutube, async (req, res) => {
  const state = readState(String(req.query.state ?? ""));
  const back = (result: string) => {
    const path = state?.returnTo ?? "/";
    return res.redirect(302, `${site()}${path}${path.includes("?") ? "&" : "?"}youtube=${result}`);
  };
  if (!state) return back("expired");
  if (req.query.error) return back(req.query.error === "access_denied" ? "denied" : "error");
  try {
    await connect(state.wallet, String(req.query.code ?? ""));
    return back("connected");
  } catch (err: any) {
    console.error(`[youtube] connecting failed: ${err?.code ?? ""} ${err?.message ?? err}`);
    return back(err instanceof YouTubeError && err.code === "scope_missing" ? "scope" : "error");
  }
});

youtubeRouter.post("/disconnect", limitYoutube, requireAuth, async (req, res) => {
  try {
    await disconnect(authOf(req)!.wallet);
    return res.json({ ok: true });
  } catch (err) { return fail(res, err); }
});

// ── publications ──────────────────────────────────────────────────────────────

const view = (p: Publication) => ({
  id: p.id, clipId: p.clipId, title: p.title, privacy: p.privacy, status: p.status,
  sentBytes: p.sentBytes, totalBytes: p.totalBytes, error: p.error,
  url: p.remoteId ? `https://www.youtube.com/watch?v=${encodeURIComponent(p.remoteId)}` : null,
  studioUrl: p.remoteId ? `https://studio.youtube.com/video/${encodeURIComponent(p.remoteId)}/edit` : null,
  createdAt: p.createdAt, updatedAt: p.updatedAt,
});

async function ownVideo(req: any, res: any) {
  const video = await store.get(req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return null; }
  if (!ownsVideo(video, authOf(req)!.wallet)) { res.status(403).json(NOT_OWNER); return null; }
  return video;
}

youtubeVideoRouter.get("/:id/youtube", requireAuth, async (req, res) => {
  try {
    const video = await ownVideo(req, res); if (!video) return;
    const link = video.visibility !== "private" ? `${site()}/v/${video.id}` : null;
    return res.json({
      enabled: !!youtubeConfig(),
      publications: (await publicationsOf(video.id)).map(view),
      suggested: {
        title: (video.title ?? "").replace(/[<>]/g, "").slice(0, 100),
        description: suggestDescription({ summary: video.ai?.summary, chapters: video.ai?.chapters, durationSeconds: video.meta.durationSeconds, link }),
        tags: (video.tags?.length ? video.tags : (video.ai?.tags ?? [])).slice(0, 15),
      },
      limits: { perDay: perWallet(), usedToday: await uploadsToday(authOf(req)!.wallet) },
    });
  } catch (err) { return fail(res, err); }
});

youtubeVideoRouter.post("/:id/youtube", limitYoutube, requireAuth, async (req, res) => {
  try {
    if (!youtubeConfig()) return res.status(503).json(NOT_SET_UP);
    const video = await ownVideo(req, res); if (!video) return;
    const wallet = authOf(req)!.wallet;
    if (video.status !== "ready") return res.status(409).json({ error: "A video can be published once it is ready.", code: "not_ready" });
    if (!(await account(wallet))) return res.status(409).json({ error: "Connect your YouTube channel first.", code: "not_connected" });
    const details = parseDetails(req.body);

    let clipId: string | null = null;
    if (req.body?.clipId) {
      const clip = await getClip(String(req.body.clipId));
      if (!clip || clip.videoId !== video.id) return res.status(404).json({ error: "Clip not found" });
      if (clip.status !== "ready" || !clip.assetId) return res.status(409).json({ error: "The clip is not ready yet.", code: "clip_not_ready" });
      clipId = clip.id;
    } else if (!(await getOriginal(video.id))) {
      return res.status(409).json({ error: "The original file is not in VideoMind's storage, so it cannot be sent to YouTube.", code: "no_original" });
    }

    if ((await uploadsToday(wallet)) >= perWallet()) {
      return res.status(429).json({ error: `You can publish ${perWallet()} videos to YouTube a day. Try again tomorrow.`, code: "daily_limit" });
    }
    const all = await getDb().execute({ sql: "SELECT COUNT(*) AS n FROM publications WHERE created_at >= ?", args: [Date.now() - 86_400_000] });
    if (Number((all.rows[0] as any).n) >= perProject()) {
      return res.status(429).json({ error: "VideoMind has used today's YouTube upload allowance. Try again tomorrow.", code: "project_limit" });
    }

    const pub = await addPublication({ videoId: video.id, clipId, wallet, details });
    await queuePublication(video.id, pub.id);
    return res.status(201).json({ publication: view(pub) });
  } catch (err) { return fail(res, err); }
});

youtubeVideoRouter.post("/:id/youtube/:pubId/retry", limitYoutube, requireAuth, async (req, res) => {
  try {
    const video = await ownVideo(req, res); if (!video) return;
    const pub = await getPublication(req.params.pubId);
    if (!pub || pub.videoId !== video.id) return res.status(404).json({ error: "Not found" });
    if (pub.status !== "failed") return res.status(409).json({ error: "Only a failed upload can be tried again.", code: "not_failed" });
    if (!(await account(authOf(req)!.wallet))) return res.status(409).json({ error: "Connect your YouTube channel first.", code: "not_connected" });
    const now = Date.now();
    const r = await getDb().execute({
      sql: `UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, error = NULL, error_code = NULL, finished_at = NULL, updated_at = ?
             WHERE idempotency_key = ? AND status = 'failed'`,
      args: [now, now, `${video.id}:${YOUTUBE_JOB}:${pub.id}`],
    });
    await updatePublication(pub.id, { status: "queued", error: null });
    if (!r.rowsAffected) await queuePublication(video.id, pub.id); else nudgeRunner();
    return res.json({ publication: view((await getPublication(pub.id))!) });
  } catch (err) { return fail(res, err); }
});
