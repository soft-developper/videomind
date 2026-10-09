// src/routes/live.ts
// vm_live: live events (see lib/live.ts). Mounted at /api/live.
//
//   GET  /config                 is live switched on here
//   GET  /mine                   the signed in wallet's events
//   POST /                       create one { title }
//   GET  /:id                    public: title, who, status, recording
//   POST /:id/host-token         owner: join the room to publish
//   POST /:id/start              owner: the stream is on { restream?: [rtmp urls] }
//   POST /:id/end                owner: end it for everyone
//   GET  /:id/stats              owner: viewers now and at most
//   POST /:id/recording          owner: the uploaded recording { videoId }
//   POST /:id/viewer-token       anyone, while live: watch
import { Router } from "express";
import { requireAuth, optionalAuth, authOf } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { store } from "../lib/store.js";
import { ownsVideo } from "../lib/videoInfo.js";
import { namesOf } from "../lib/profiles.js";
import {
  liveConfig, createEvent, getEvent, eventsOf, isOwner, hostToken, viewerToken, parseRestream, goLive, endEvent,
  viewersNow, settle, linkRecording, LiveError, maxViewers, type LiveEvent,
} from "../lib/live.js";

const router = Router();

const limitLive = rateLimit({
  name: "live",
  label: "live requests",
  perClient: { max: Number(process.env.LIMIT_LIVE_PER_CLIENT_10MIN) || 120, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_LIVE_GLOBAL_10MIN) || 3000, windowMs: 10 * 60_000 },
});
const limitWatch = rateLimit({
  name: "live_watch",
  label: "requests to watch",
  perClient: { max: Number(process.env.LIMIT_WATCH_PER_CLIENT_10MIN) || 60, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_WATCH_GLOBAL_10MIN) || 5000, windowMs: 10 * 60_000 },
});

async function view(e: LiveEvent, owner: boolean) {
  const name = (await namesOf([e.wallet]).catch(() => new Map<string, string>())).get(e.wallet) ?? null;
  return {
    id: e.id, title: e.title, status: e.status, wallet: e.wallet, hostName: name,
    startedAt: e.startedAt, endedAt: e.endedAt, videoId: e.videoId, createdAt: e.createdAt,
    ...(owner ? { restreaming: e.restream, peakViewers: e.peakViewers } : {}),
  };
}
function fail(res: any, err: any) {
  if (err instanceof LiveError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`[live] ${err?.message ?? err}`);
  return res.status(502).json({ error: "The live server did not answer. Try again in a moment.", code: "live_unreachable" });
}
async function ownEvent(req: any, res: any): Promise<LiveEvent | null> {
  const e = await getEvent(req.params.id);
  if (!e) { res.status(404).json({ error: "Live event not found" }); return null; }
  if (!isOwner(e, authOf(req)!.wallet)) { res.status(403).json({ error: "This live event belongs to a different wallet.", code: "not_owner" }); return null; }
  return e;
}

router.get("/config", (_req, res) => res.json({ enabled: !!liveConfig(), maxViewers: maxViewers() }));

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const list = await eventsOf(authOf(req)!.wallet);
    return res.json({ events: await Promise.all(list.map((e) => view(e, true))), enabled: !!liveConfig() });
  } catch (err) { return fail(res, err); }
});

router.post("/", limitLive, requireAuth, async (req, res) => {
  try {
    if (!liveConfig()) return res.status(503).json({ error: "Live is not set up on this server yet.", code: "live_off" });
    const e = await createEvent(authOf(req)!.wallet, (req.body ?? {}).title);
    return res.status(201).json({ event: await view(e, true) });
  } catch (err) { return fail(res, err); }
});

router.get("/:id", optionalAuth, async (req, res) => {
  try {
    let e = await getEvent(req.params.id);
    if (!e) return res.status(404).json({ error: "Live event not found" });
    e = await settle(e).catch(() => e!);
    return res.json({ event: await view(e, isOwner(e, authOf(req)?.wallet)) });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/host-token", limitLive, requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    const name = (await namesOf([e.wallet]).catch(() => new Map<string, string>())).get(e.wallet) ?? "Host";
    return res.json(await hostToken(e, name));
  } catch (err) { return fail(res, err); }
});

router.post("/:id/start", limitLive, requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    const urls = parseRestream((req.body ?? {}).restream);
    const r = await goLive(e, urls);
    return res.json({ event: await view(r.event, true), restreamError: r.restreamError });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/end", limitLive, requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    return res.json({ event: await view(await endEvent(e), true) });
  } catch (err) { return fail(res, err); }
});

router.get("/:id/stats", requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    const viewers = await viewersNow(e);
    const fresh = (await getEvent(e.id))!;
    return res.json({ viewers, peakViewers: fresh.peakViewers, status: fresh.status });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/recording", limitLive, requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    const videoId = String((req.body ?? {}).videoId ?? "");
    const video = await store.get(videoId);
    if (!video || !ownsVideo(video, authOf(req)!.wallet)) return res.status(400).json({ error: "That video is not in your library.", code: "bad_video" });
    return res.json({ event: await view(await linkRecording(e, video.id), true) });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/viewer-token", limitWatch, async (req, res) => {
  try {
    let e = await getEvent(req.params.id);
    if (!e) return res.status(404).json({ error: "Live event not found" });
    e = await settle(e).catch(() => e!);
    return res.json(await viewerToken(e));
  } catch (err) { return fail(res, err); }
});

export default router;
