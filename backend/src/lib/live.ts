// src/lib/live.ts
// vm_live: live events through LiveKit.
//
//   * the host's browser publishes the camera or the screen, and the
//     microphone, to a LiveKit room (WebRTC)
//   * viewers watch on the event's page with a token that can only
//     subscribe; no wallet is needed to watch
//   * the recording is made in the host's browser at the same time (as on
//     the Record page) and uploaded afterwards, so it costs no LiveKit
//     recording minutes. It becomes a normal video in the library
//   * restreaming to YouTube Live, Twitch or any RTMP address is a LiveKit
//     egress of the host's two tracks. It is optional, and it uses LiveKit
//     transcoding minutes (60 a month on the free plan, checked 9 Oct 2026)
//
// Settings: LIVEKIT_URL (the wss address of the LiveKit project),
// LIVEKIT_API_KEY, LIVEKIT_API_SECRET. Without them live is switched off.
//
// vm_livesession (Part 19): a live event runs for a length the host picks
// before going live (SESSION_MINUTES). The host may add time once
// (EXTEND_MINUTES), never past MAX_SESSION_MINUTES in all. The server ends
// the event at its end time whatever the host's browser does (endDueEvents,
// and settle() when the event is read). The price `live` is per minute of
// the length: held when the event goes live, the extension held when it is
// added, and only the minutes the event really ran are charged when it ends.
//
// vm_liveviewers (Part 20c): the host also picks a viewer limit (VIEWER_LIMITS).
// The price `live` is per viewer minute. The hold covers length × limit, the
// room lets in at most that many viewers, the server counts the viewers every
// 30 seconds (sampleViewers) and only the viewer minutes watched are charged.
// Events from before 20c (no viewer limit) are charged by the minutes run.
import crypto from "crypto";
import {
  AccessToken, RoomServiceClient, EgressClient, StreamOutput, StreamProtocol, TrackSource, TrackType, DataPacket_Kind,
  type ParticipantInfo,
} from "livekit-server-sdk";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import { reserve, settle as settleHold, release, holdById } from "./credits.js";

export type LiveStatus = "scheduled" | "live" | "ended";
/** vm_livechat: who may write in the chat. */
export type ChatMode = "anyone" | "wallets" | "off";
export const CHAT_MODES: ChatMode[] = ["anyone", "wallets", "off"];

export interface LiveEvent {
  id: string; wallet: string; title: string; room: string; status: LiveStatus;
  startedAt: number | null; endedAt: number | null; egressId: string | null; restream: boolean;
  peakViewers: number; videoId: string | null; createdAt: number; updatedAt: number;
  chatMode: ChatMode; captions: boolean; captionSeconds: number;
  /** vm_livesession: the length chosen, the one extension, the end time (null for events from before Part 19). */
  lengthMin: number | null; extendMin: number | null; endsAt: number | null;
  holdId: string | null; extendHoldId: string | null;
  /** vm_liveviewers: the most viewers allowed, the viewer seconds counted, the last count. */
  viewerLimit: number | null; viewerSeconds: number; sampledAt: number | null;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
function rowToEvent(r: Record<string, unknown>): LiveEvent {
  return {
    id: String(r.id), wallet: String(r.wallet), title: String(r.title), room: String(r.room), status: String(r.status) as LiveStatus,
    startedAt: n(r.started_at), endedAt: n(r.ended_at), egressId: r.egress_id ? String(r.egress_id) : null,
    restream: Number(r.restream) === 1, peakViewers: Number(r.peak_viewers ?? 0), videoId: r.video_id ? String(r.video_id) : null,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    chatMode: (CHAT_MODES.includes(r.chat_mode as ChatMode) ? r.chat_mode : "anyone") as ChatMode,
    captions: r.captions === undefined || r.captions === null ? true : Number(r.captions) === 1,
    captionSeconds: Number(r.caption_seconds ?? 0),
    lengthMin: n(r.length_min), extendMin: n(r.extend_min), endsAt: n(r.ends_at),
    holdId: r.hold_id ? String(r.hold_id) : null, extendHoldId: r.extend_hold_id ? String(r.extend_hold_id) : null,
    viewerLimit: n(r.viewer_limit), viewerSeconds: Number(r.viewer_seconds ?? 0) || 0, sampledAt: n(r.sampled_at),
  };
}

export class LiveError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// ── configuration ─────────────────────────────────────────────────────────────

export function liveConfig(): { url: string; host: string; key: string; secret: string } | null {
  const url = process.env.LIVEKIT_URL?.trim(), key = process.env.LIVEKIT_API_KEY?.trim(), secret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !key || !secret) return null;
  return { url, host: url.replace(/^ws(s?):\/\//i, "http$1://"), key, secret };
}
export const maxViewers = () => Math.max(1, Number(process.env.LIVE_MAX_VIEWERS) || 100);
/** Events one wallet may create per day. */
export const eventsPerDay = () => Math.max(1, Number(process.env.LIVE_EVENTS_PER_DAY) || 10);

// ── vm_livesession: lengths ───────────────────────────────────────────────────
/** The lengths a host can pick, in minutes. */
export const SESSION_MINUTES = [15, 30, 45, 60, 90, 120, 180] as const;
/** What the one extension can add, in minutes. */
export const EXTEND_MINUTES = [10, 20, 30] as const;
/** The longest a session can run with its extension. */
export const MAX_SESSION_MINUTES = 210;
// ── vm_liveviewers: viewer limits ─────────────────────────────────────────────
/** The viewer limits a host can pick, at most LIVE_MAX_VIEWERS. */
export const VIEWER_LIMITS = [10, 25, 50, 100] as const;
export const viewerChoices = () => {
  const list = VIEWER_LIMITS.filter((v) => v <= maxViewers());
  return list.length ? list : [maxViewers()];
};
export function parseViewers(v: unknown): number {
  const x = Number(v);
  if (!viewerChoices().includes(x as any)) throw new LiveError(400, "bad_viewers", `Choose the most viewers: ${viewerChoices().join(", ")}.`);
  return x;
}
/** Viewer minutes counted so far, rounded up to a whole minute. */
export const viewerMinutes = (e: LiveEvent) => Math.ceil(Math.max(0, e.viewerSeconds) / 60 - 1e-9);

/** A hold stays open this long past the end time, so a late end still settles it. */
const HOLD_SLACK_MS = 2 * 3600_000;

export function parseLength(v: unknown): number {
  const m = Number(v);
  if (!(SESSION_MINUTES as readonly number[]).includes(m)) {
    throw new LiveError(400, "bad_length", `Choose how long the live event runs: ${SESSION_MINUTES.join(", ")} minutes.`);
  }
  return m;
}
/** Minutes the event has run, rounded up to a whole minute, never past its length. */
export function minutesRun(e: LiveEvent, at = Date.now()): number {
  if (!e.startedAt) return 0;
  const total = (e.lengthMin ?? 0) + (e.extendMin ?? 0);
  const ran = Math.ceil(Math.max(0, Math.min(at, e.endsAt ?? at) - e.startedAt) / 60_000);
  return total ? Math.min(total, ran) : ran;
}
/** The extensions this event could still take, given the 210 minute ceiling. */
export function extendChoices(e: LiveEvent): number[] {
  if (e.status !== "live" || !e.lengthMin || e.extendMin) return [];
  return EXTEND_MINUTES.filter((x) => e.lengthMin! + x <= MAX_SESSION_MINUTES);
}

let rooms: RoomServiceClient | null = null, egress: EgressClient | null = null, roomsFor = "";
function clients() {
  const c = liveConfig();
  if (!c) throw new LiveError(503, "live_off", "Live is not set up on this server yet.");
  if (!rooms || roomsFor !== `${c.host}|${c.key}`) {
    rooms = new RoomServiceClient(c.host, c.key, c.secret);
    egress = new EgressClient(c.host, c.key, c.secret);
    roomsFor = `${c.host}|${c.key}`;
  }
  return { cfg: c, rooms: rooms!, egress: egress! };
}

// ── events ────────────────────────────────────────────────────────────────────

export async function createEvent(wallet: string, title: unknown): Promise<LiveEvent> {
  const t = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  if (!t) throw new LiveError(400, "bad_title", "Give the live event a title.");
  if (t.length > 120) throw new LiveError(400, "title_too_long", "Keep the title to 120 characters.");
  const w = normalizeWallet(wallet) ?? wallet;
  const today = await getDb().execute({ sql: "SELECT COUNT(*) AS n FROM live_events WHERE wallet = ? AND created_at >= ?", args: [w, Date.now() - 86_400_000] });
  if (Number((today.rows[0] as any).n) >= eventsPerDay()) throw new LiveError(429, "too_many", `You can create ${eventsPerDay()} live events a day.`);
  const id = crypto.randomUUID(), now = Date.now();
  await getDb().execute({
    sql: `INSERT INTO live_events (id, wallet, title, room, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'scheduled', ?, ?)`,
    args: [id, w, t, `vm-${id}`, now, now],
  });
  return (await getEvent(id))!;
}
export async function getEvent(id: string): Promise<LiveEvent | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM live_events WHERE id = ?", args: [id] });
  return r.rows[0] ? rowToEvent(r.rows[0] as Record<string, unknown>) : null;
}
export async function eventsOf(wallet: string): Promise<LiveEvent[]> {
  const r = await getDb().execute({ sql: "SELECT * FROM live_events WHERE wallet = ? ORDER BY created_at DESC LIMIT 100", args: [normalizeWallet(wallet) ?? wallet] });
  return r.rows.map((x) => rowToEvent(x as Record<string, unknown>));
}
export async function save(id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  await getDb().execute({ sql: `UPDATE live_events SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, args: [...keys.map((k) => patch[k] as any), Date.now(), id] });
}
export const isOwner = (e: LiveEvent, wallet: string | null | undefined) => !!wallet && normalizeWallet(wallet) === e.wallet;

// ── tokens ────────────────────────────────────────────────────────────────────

const HOST = "host";

/** The host may publish a camera or a screen and a microphone. The room is made here, with a viewer limit. */
export async function hostToken(e: LiveEvent, name: string, viewers?: unknown): Promise<{ url: string; token: string }> {
  if (e.status === "ended") throw new LiveError(409, "ended", "This live event has ended.");
  const { cfg, rooms } = clients();
  // vm_liveviewers: before going live the host's viewer limit sets the room's size. A room
  // made earlier with another size is made again (nobody watches before the event is live).
  let limit = e.viewerLimit ?? maxViewers();
  if (e.status === "scheduled" && viewers !== undefined) {
    limit = parseViewers(viewers);
    if (limit !== e.viewerLimit) {
      await rooms.deleteRoom(e.room).catch(() => {});
      await save(e.id, { viewer_limit: limit });
    }
  }
  await rooms.createRoom({ name: e.room, emptyTimeout: 10 * 60, departureTimeout: 120, maxParticipants: limit + 1, metadata: JSON.stringify({ title: e.title }) });
  const at = new AccessToken(cfg.key, cfg.secret, { identity: HOST, name, ttl: "6h" });
  at.addGrant({
    roomJoin: true, room: e.room, canPublish: true, canSubscribe: false, canPublishData: false,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
  });
  return { url: cfg.url, token: await at.toJwt() };
}

/** A viewer may only watch and listen. */
export async function viewerToken(e: LiveEvent): Promise<{ url: string; token: string }> {
  if (e.status !== "live") throw new LiveError(409, e.status === "ended" ? "ended" : "not_live", e.status === "ended" ? "This live event has ended." : "This live event has not started yet.");
  const { cfg, rooms } = clients();
  // vm_liveviewers: no more viewers than the host paid for (the room's own limit is the hard stop)
  if (e.viewerLimit) {
    const list = await rooms.listParticipants(e.room).catch(() => null);
    if (list && list.filter((p) => p.identity !== HOST).length >= e.viewerLimit) {
      throw new LiveError(409, "full", "This live event is full. Try again in a moment.");
    }
  }
  const at = new AccessToken(cfg.key, cfg.secret, { identity: `viewer-${crypto.randomUUID().slice(0, 12)}`, name: "Viewer", ttl: "6h" });
  at.addGrant({ roomJoin: true, room: e.room, canPublish: false, canSubscribe: true, canPublishData: false });
  return { url: cfg.url, token: await at.toJwt() };
}

// ── going live and ending ─────────────────────────────────────────────────────

async function hostOf(room: string): Promise<ParticipantInfo | null> {
  const { rooms } = clients();
  const list = await rooms.listParticipants(room).catch(() => [] as ParticipantInfo[]);
  return list.find((p) => p.identity === HOST) ?? null;
}

/** RTMP addresses the host gave, checked. Stream keys are part of the address and are never stored. */
export function parseRestream(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new LiveError(400, "bad_restream", "Restream addresses must be a list.");
  const urls = v.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (urls.length > 3) throw new LiveError(400, "bad_restream", "Restream to at most 3 places.");
  for (const u of urls) {
    if (!/^rtmps?:\/\/[^\s/]+\/\S+$/i.test(u) || u.length > 500) {
      throw new LiveError(400, "bad_restream", "A restream address starts with rtmp:// or rtmps:// and ends with the stream key.");
    }
  }
  return urls;
}

/**
 * The host is publishing: mark the event live and start any restream.
 * vm_livesession: minutes is the length the host chose. Its price is held
 * first (402 not_enough_credits before anything starts), and the end time
 * is set from the moment it goes live. Calling it again while live (a
 * retry) keeps the first length, hold and end time.
 */
export async function goLive(e: LiveEvent, restream: string[], minutes?: unknown): Promise<{ event: LiveEvent; restreamError: string | null }> {
  if (e.status === "ended") throw new LiveError(409, "ended", "This live event has ended.");
  const already = e.status === "live";
  const length = already && e.lengthMin ? e.lengthMin : parseLength(minutes);
  const host = await hostOf(e.room);
  const video = host?.tracks.find((t) => t.type === TrackType.VIDEO);
  const audio = host?.tracks.find((t) => t.type === TrackType.AUDIO);
  if (!host || !video) throw new LiveError(409, "not_publishing", "The camera or screen is not reaching the live server yet. Wait a moment and try again.");
  // The same key gives back the same hold, so a retried start never holds twice.
  let holdId = e.holdId;
  if (!already) {
    // vm_liveviewers: a full room for the whole length, in viewer minutes
    const limit = e.viewerLimit ?? maxViewers();
    const r = await reserve({ wallet: e.wallet, action: "live", quantity: length * limit, key: `live:${e.id}:main`, ttlMs: length * 60_000 + HOLD_SLACK_MS });
    holdId = r.free ? null : r.hold.id;
  }
  if (already && e.egressId) restream = [];   // the restream is already running
  let egressId: string | null = already ? e.egressId : null, restreamError: string | null = null;
  if (restream.length) {
    try {
      const { egress } = clients();
      const out = new StreamOutput({ protocol: StreamProtocol.RTMP, urls: restream });
      const info = await egress.startTrackCompositeEgress(e.room, { stream: out }, { videoTrackId: video.sid, ...(audio ? { audioTrackId: audio.sid } : {}) });
      egressId = info.egressId;
    } catch (err: any) {
      // The live event goes ahead without the restream; the host is told.
      restreamError = `Restreaming could not start: ${String(err?.message ?? err).replace(/rtmps?:\/\/\S+/gi, "[address]").slice(0, 200)}`;
    }
  }
  if (already) {
    await save(e.id, { egress_id: egressId, restream: egressId ? 1 : 0 });
  } else {
    const startedAt = Date.now();
    await save(e.id, {
      status: "live", started_at: startedAt, egress_id: egressId, restream: egressId ? 1 : 0,
      length_min: length, ends_at: startedAt + length * 60_000, hold_id: holdId,
      viewer_limit: e.viewerLimit ?? maxViewers(), sampled_at: startedAt,
    });
  }
  return { event: (await getEvent(e.id))!, restreamError };
}

/**
 * vm_livesession: add time once, while live. Held before anything changes
 * (402 not_enough_credits). The total never passes MAX_SESSION_MINUTES.
 */
export async function extendEvent(e: LiveEvent, minutes: unknown): Promise<LiveEvent> {
  if (e.status !== "live") throw new LiveError(409, "not_live", "Time can only be added while the event is live.");
  if (!e.lengthMin || !e.endsAt) throw new LiveError(409, "no_length", "This live event has no set length, so there is nothing to extend.");
  if (e.extendMin) throw new LiveError(409, "already_extended", "Time was already added once to this live event.");
  const m = Number(minutes);
  if (!(EXTEND_MINUTES as readonly number[]).includes(m)) throw new LiveError(400, "bad_extend", `Add ${EXTEND_MINUTES.join(", ")} minutes.`);
  if (e.lengthMin + m > MAX_SESSION_MINUTES) throw new LiveError(409, "too_long", `A live event can run at most ${MAX_SESSION_MINUTES} minutes.`);
  if (Date.now() >= e.endsAt) throw new LiveError(409, "time_up", "The live event has reached its end time.");
  // vm_liveviewers: the extension for a full room
  const r = await reserve({ wallet: e.wallet, action: "live", quantity: m * (e.viewerLimit ?? 1), key: `live:${e.id}:extend`, ttlMs: Math.max(0, e.endsAt - Date.now()) + m * 60_000 + HOLD_SLACK_MS });
  // Only one extension: the row changes only while extend_min is still empty.
  const res = await getDb().execute({
    sql: "UPDATE live_events SET extend_min = ?, ends_at = ends_at + ?, extend_hold_id = ?, updated_at = ? WHERE id = ? AND status = 'live' AND extend_min IS NULL",
    args: [m, m * 60_000, r.free ? null : r.hold.id, Date.now(), e.id],
  });
  if (res.rowsAffected === 0) {
    if (!r.free) {
      const now = (await getEvent(e.id))!;
      if (now.extendHoldId !== r.hold.id) await release(r.hold.id).catch(() => {});
    }
    throw new LiveError(409, "already_extended", "Time was already added once to this live event.");
  }
  return (await getEvent(e.id))!;
}

/** vm_livesession: charge the minutes the event ran, the length first, then the extension. */
async function settleSession(e: LiveEvent, endedAt: number) {
  // vm_liveviewers: viewer minutes when the event had a viewer limit, minutes run before 20c
  const counted = e.viewerLimit != null;
  const ran = counted ? viewerMinutes(e) : minutesRun(e, endedAt);
  const length = counted ? (e.lengthMin ?? 0) * e.viewerLimit! : (e.lengthMin ?? 0);
  const log = (what: string) => (err: any) => console.error(`[live] ${e.id}: settling the ${what}: ${err?.message ?? err}`);
  if (e.holdId) {
    if (!e.startedAt || ran <= 0) await release(e.holdId).catch(log("length"));
    else await settleHold(e.holdId, { quantity: Math.min(length, ran) }).catch(log("length"));
  }
  if (e.extendHoldId) {
    const extra = Math.max(0, ran - length);
    if (extra > 0) await settleHold(e.extendHoldId, { quantity: extra }).catch(log("extension"));
    else await release(e.extendHoldId).catch(log("extension"));
  }
}

/** End the event: stop any restream and close the room, which disconnects every viewer. */
export async function endEvent(e: LiveEvent): Promise<LiveEvent> {
  e = (await getEvent(e.id)) ?? e;   // vm_livesession: the end time may have moved since e was read
  if (e.status !== "ended") {
    // vm_livesession: an event past its end time ended at its end time, however late this runs.
    const endedAt = e.endsAt ? Math.min(Date.now(), e.endsAt) : Date.now();
    // vm_liveviewers: count the viewers once more up to the end, before the room closes
    if (e.status === "live" && e.viewerLimit) e = await sampleViewers(e, endedAt).catch(() => e);
    const c = liveConfig();
    if (c) {
      const { rooms, egress } = clients();
      if (e.egressId) await egress.stopEgress(e.egressId).catch(() => {});
      await rooms.deleteRoom(e.room).catch(() => {});
    }
    // Only the first ending writes and charges, if two arrive at once.
    const res = await getDb().execute({
      sql: "UPDATE live_events SET status = 'ended', ended_at = ?, updated_at = ? WHERE id = ? AND status != 'ended'",
      args: [endedAt, Date.now(), e.id],
    });
    if (res.rowsAffected > 0) {
      const fresh = (await getEvent(e.id)) ?? e;
      await settleSession(fresh, endedAt);
      // The captions of the event stop now, not at their next check. Loaded here: livecaptions imports this file.
      import("./livecaptions.js").then((m) => m.stopCaptions(e.id, "ended")).catch(() => {});
    }
  }
  return (await getEvent(e.id))!;
}

/**
 * vm_liveviewers: add the viewers watching now for the time since the last
 * count. A gap longer than SAMPLE_GAP_MS counts only SAMPLE_GAP_MS, so a
 * missed count never charges for viewers nobody saw. If the live server
 * does not answer, nothing is added. Two counts at once add once.
 */
const SAMPLE_GAP_MS = 60_000;
export async function sampleViewers(e: LiveEvent, at = Date.now()): Promise<LiveEvent> {
  if (e.status !== "live" || !e.viewerLimit || !e.startedAt || !liveConfig()) return e;
  const from = e.sampledAt ?? e.startedAt;
  const to = Math.min(at, e.endsAt ?? at);
  if (to <= from) return e;
  const { rooms } = clients();
  const list = await rooms.listParticipants(e.room).catch(() => null);
  if (!list) return e;
  const count = Math.min(e.viewerLimit, list.filter((p) => p.identity !== HOST).length);
  const seconds = (count * Math.min(SAMPLE_GAP_MS, to - from)) / 1000;
  const res = await getDb().execute({
    sql: `UPDATE live_events SET viewer_seconds = COALESCE(viewer_seconds, 0) + ?, sampled_at = ?,
            peak_viewers = MAX(COALESCE(peak_viewers, 0), ?), updated_at = ?
          WHERE id = ? AND status = 'live' AND ${e.sampledAt == null ? "sampled_at IS NULL" : "sampled_at = ?"}`,
    args: [seconds, to, count, Date.now(), e.id, ...(e.sampledAt == null ? [] : [e.sampledAt])],
  });
  return res.rowsAffected ? (await getEvent(e.id)) ?? e : e;
}

/** vm_liveviewers: count the viewers of every live event with a viewer limit. Run every 30 seconds. */
export async function sampleAllViewers(now = Date.now()): Promise<number> {
  const r = await getDb().execute("SELECT * FROM live_events WHERE status = 'live' AND viewer_limit IS NOT NULL");
  let n = 0;
  for (const row of r.rows) {
    const e = rowToEvent(row as Record<string, unknown>);
    try { await sampleViewers(e, now); n++; } catch (err: any) { console.error(`[live] counting viewers of ${e.id} failed: ${err?.message ?? err}`); }
  }
  return n;
}

/**
 * vm_livesession: end every live event past its end time. Run every 15
 * seconds by the server, so an event ends on time even when nobody reads it.
 */
export async function endDueEvents(now = Date.now()): Promise<number> {
  const r = await getDb().execute({ sql: "SELECT * FROM live_events WHERE status = 'live' AND ends_at IS NOT NULL AND ends_at <= ?", args: [now] });
  let ended = 0;
  for (const row of r.rows) {
    const e = rowToEvent(row as Record<string, unknown>);
    try { await endEvent(e); ended++; console.log(`[live] ${e.id} reached its end time and was ended`); }
    catch (err: any) { console.error(`[live] ending ${e.id} at its end time failed: ${err?.message ?? err}`); }
  }
  return ended;
}

/** vm_livesession: what the host has been charged or has on hold for this event, in micro dollars. */
export async function sessionCost(e: LiveEvent): Promise<{ heldMicros: number; chargedMicros: number }> {
  let heldMicros = 0, chargedMicros = 0;
  for (const id of [e.holdId, e.extendHoldId]) {
    if (!id) continue;
    const h = await holdById(id).catch(() => null);
    if (!h) continue;
    if (h.status === "held") heldMicros += h.amountMicros;
    else if (h.status === "settled") chargedMicros += h.chargedMicros ?? 0;
  }
  return { heldMicros, chargedMicros };
}

/** Viewers watching now (the host is not counted). Remembers the most there were. */
export async function viewersNow(e: LiveEvent): Promise<number> {
  if (e.status !== "live") return 0;
  const { rooms } = clients();
  const list = await rooms.listParticipants(e.room).catch(() => null);
  if (!list) return 0;
  const count = list.filter((p) => p.identity !== HOST).length;
  if (count > e.peakViewers) await save(e.id, { peak_viewers: count });
  return count;
}

/**
 * A live event whose host has gone (the browser closed or lost its
 * connection) for more than HOST_GRACE_MS, or whose room is gone, is
 * ended. Checked when the event is read, at most every 20 seconds.
 */
const HOST_GRACE_MS = 2 * 60_000;
const lastCheck = new Map<string, number>();
const hostMissingSince = new Map<string, number>();
export async function settle(e: LiveEvent): Promise<LiveEvent> {
  if (e.status !== "live") return e;
  // vm_livesession: past its end time it ends now, before anything else.
  if (e.endsAt && Date.now() >= e.endsAt) return endEvent(e);
  if (!liveConfig()) return e;
  if (Date.now() - (lastCheck.get(e.id) ?? 0) < 20_000) return e;
  lastCheck.set(e.id, Date.now());
  const { rooms } = clients();
  const found = await rooms.listRooms([e.room]).catch(() => null);
  if (found === null) return e;                                // the live server did not answer: leave it
  if (found.length === 0) return endEvent(e);
  const host = await hostOf(e.room);
  if (host) { hostMissingSince.delete(e.id); return e; }
  const since = hostMissingSince.get(e.id) ?? Date.now();
  hostMissingSince.set(e.id, since);
  return Date.now() - since > HOST_GRACE_MS ? endEvent(e) : e;
}

/**
 * vm_livechat: send a small message to everyone in the event's room
 * (captions, chat, settings). Viewers cannot send; only the server does.
 * Never throws: a missed message is not worth failing a request over.
 */
export async function broadcast(e: LiveEvent, topic: "captions" | "chat" | "settings", body: unknown): Promise<boolean> {
  if (e.status !== "live" || !liveConfig()) return false;
  try {
    const { rooms } = clients();
    await rooms.sendData(e.room, new TextEncoder().encode(JSON.stringify(body)), DataPacket_Kind.RELIABLE, { topic });
    return true;
  } catch { return false; }
}

export async function linkRecording(e: LiveEvent, videoId: string): Promise<LiveEvent> {
  await save(e.id, { video_id: videoId });
  return (await getEvent(e.id))!;
}
