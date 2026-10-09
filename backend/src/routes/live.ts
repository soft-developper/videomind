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
//
// vm_livechat:
//   PATCH  /:id/settings              owner: { chatMode?: anyone | wallets | off, captions?: boolean }
//   POST   /:id/chat/join             a chat pass { name? } (signed in wallets may skip the name)
//   GET    /:id/chat                  public: the latest messages
//   POST   /:id/chat                  { token, text } while live
//   DELETE /:id/chat/:msgId           owner: delete a message
//   POST   /:id/chat/:msgId/block     owner: block its writer and remove what they wrote
//   GET    /:id/captions              public: the finished caption lines
//   POST   /:id/captions/ticket       owner: a one use ticket for the captions WebSocket
import { Router } from "express";
import { requireAuth, optionalAuth, authOf } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { store } from "../lib/store.js";
import { ownsVideo } from "../lib/videoInfo.js";
import { namesOf } from "../lib/profiles.js";
import {
  liveConfig, createEvent, getEvent, eventsOf, isOwner, hostToken, viewerToken, parseRestream, goLive, endEvent,
  viewersNow, settle, linkRecording, LiveError, maxViewers, save, broadcast, CHAT_MODES, type LiveEvent, type ChatMode,
} from "../lib/live.js";
import { joinChat, readPass, postMessage, listMessages, deleteMessage, blockWriter, listCaptions } from "../lib/livechat.js";
import { captionsAvailable, makeTicket, stopCaptions, maxMinutes } from "../lib/livecaptions.js";

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
    chatMode: e.chatMode, captions: e.captions && captionsAvailable(),
    ...(owner ? { restreaming: e.restream, peakViewers: e.peakViewers, captionsAvailable: captionsAvailable(), captionSeconds: e.captionSeconds, captionLimitMinutes: maxMinutes() } : {}),
  };
}
function fail(res: any, err: any) {
  if (err instanceof LiveError) {
    if ((err as any).retryAfter) res.set("Retry-After", String((err as any).retryAfter));
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
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
    const ended = await endEvent(e);
    stopCaptions(e.id, "ended");
    return res.json({ event: await view(ended, true) });
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

// ── vm_livechat ───────────────────────────────────────────────────────────────

const limitChat = rateLimit({
  name: "live_chat",
  label: "chat messages",
  perClient: { max: Number(process.env.LIMIT_CHAT_PER_CLIENT_10MIN) || 300, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_CHAT_GLOBAL_10MIN) || 20000, windowMs: 10 * 60_000 },
});
async function anyEvent(req: any, res: any): Promise<LiveEvent | null> {
  const e = await getEvent(req.params.id);
  if (!e) { res.status(404).json({ error: "Live event not found" }); return null; }
  return e;
}

router.patch("/:id/settings", limitLive, requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    const b = req.body ?? {}, patch: Record<string, unknown> = {};
    if (b.chatMode !== undefined) {
      if (!CHAT_MODES.includes(b.chatMode)) return res.status(400).json({ error: "Chat can be open to anyone, to signed in wallets, or off.", code: "bad_chat_mode" });
      patch.chat_mode = b.chatMode as ChatMode;
    }
    if (b.captions !== undefined) {
      if (typeof b.captions !== "boolean") return res.status(400).json({ error: "Captions are on or off.", code: "bad_captions" });
      patch.captions = b.captions ? 1 : 0;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change.", code: "nothing" });
    await save(e.id, patch);
    const fresh = (await getEvent(e.id))!;
    if (!fresh.captions) stopCaptions(e.id, "off", "Captions are turned off for this event.");
    await broadcast(fresh, "settings", { type: "settings", chatMode: fresh.chatMode, captions: fresh.captions && captionsAvailable() });
    return res.json({ event: await view(fresh, true) });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/chat/join", limitChat, optionalAuth, async (req, res) => {
  try {
    const e = await anyEvent(req, res); if (!e) return;
    if (e.status === "ended") return res.status(409).json({ error: "This live event has ended.", code: "ended" });
    const wallet = authOf(req)?.wallet ?? null;
    const profileName = wallet ? (await namesOf([e.wallet, wallet]).catch(() => new Map<string, string>())).get(wallet) ?? null : null;
    return res.json(await joinChat(e, { wallet, owner: isOwner(e, wallet), profileName, name: (req.body ?? {}).name }));
  } catch (err) { return fail(res, err); }
});

router.get("/:id/chat", limitWatch, async (req, res) => {
  try {
    const e = await anyEvent(req, res); if (!e) return;
    return res.json({ messages: await listMessages(e, Number(req.query.limit) || 100), chatMode: e.chatMode, status: e.status });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/chat", limitChat, async (req, res) => {
  try {
    const e = await anyEvent(req, res); if (!e) return;
    const pass = readPass((req.body ?? {}).token, e.id);
    if (!pass) return res.status(401).json({ error: "Join the chat first.", code: "join_needed" });
    return res.status(201).json({ message: await postMessage(e, pass, (req.body ?? {}).text) });
  } catch (err) { return fail(res, err); }
});

router.delete("/:id/chat/:msgId", limitLive, requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    await deleteMessage(e, req.params.msgId);
    return res.json({ deleted: [req.params.msgId] });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/chat/:msgId/block", limitLive, requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    return res.json({ removed: await blockWriter(e, req.params.msgId) });
  } catch (err) { return fail(res, err); }
});

router.get("/:id/captions", limitWatch, async (req, res) => {
  try {
    const e = await anyEvent(req, res); if (!e) return;
    return res.json({ lines: await listCaptions(e.id, Number(req.query.limit) || 2000) });
  } catch (err) { return fail(res, err); }
});

router.post("/:id/captions/ticket", limitLive, requireAuth, async (req, res) => {
  try {
    const e = await ownEvent(req, res); if (!e) return;
    if (!captionsAvailable()) return res.status(503).json({ error: "Live captions are not set up on this server.", code: "captions_off" });
    if (!e.captions) return res.status(409).json({ error: "Captions are turned off for this event.", code: "captions_disabled" });
    if (e.status !== "live") return res.status(409).json({ error: "Captions start once the event is live.", code: "not_live" });
    if (e.captionSeconds >= maxMinutes() * 60) return res.status(409).json({ error: `This event has used its ${maxMinutes()} minutes of captions.`, code: "captions_used" });
    return res.json({ ticket: makeTicket(e.id), path: `/api/live/${e.id}/captions` });
  } catch (err) { return fail(res, err); }
});

export default router;
