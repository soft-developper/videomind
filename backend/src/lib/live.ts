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
import crypto from "crypto";
import {
  AccessToken, RoomServiceClient, EgressClient, StreamOutput, StreamProtocol, TrackSource, TrackType,
  type ParticipantInfo,
} from "livekit-server-sdk";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";

export type LiveStatus = "scheduled" | "live" | "ended";

export interface LiveEvent {
  id: string; wallet: string; title: string; room: string; status: LiveStatus;
  startedAt: number | null; endedAt: number | null; egressId: string | null; restream: boolean;
  peakViewers: number; videoId: string | null; createdAt: number; updatedAt: number;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
function rowToEvent(r: Record<string, unknown>): LiveEvent {
  return {
    id: String(r.id), wallet: String(r.wallet), title: String(r.title), room: String(r.room), status: String(r.status) as LiveStatus,
    startedAt: n(r.started_at), endedAt: n(r.ended_at), egressId: r.egress_id ? String(r.egress_id) : null,
    restream: Number(r.restream) === 1, peakViewers: Number(r.peak_viewers ?? 0), videoId: r.video_id ? String(r.video_id) : null,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
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
async function save(id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  await getDb().execute({ sql: `UPDATE live_events SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, args: [...keys.map((k) => patch[k] as any), Date.now(), id] });
}
export const isOwner = (e: LiveEvent, wallet: string | null | undefined) => !!wallet && normalizeWallet(wallet) === e.wallet;

// ── tokens ────────────────────────────────────────────────────────────────────

const HOST = "host";

/** The host may publish a camera or a screen and a microphone. The room is made here, with a viewer limit. */
export async function hostToken(e: LiveEvent, name: string): Promise<{ url: string; token: string }> {
  if (e.status === "ended") throw new LiveError(409, "ended", "This live event has ended.");
  const { cfg, rooms } = clients();
  await rooms.createRoom({ name: e.room, emptyTimeout: 10 * 60, departureTimeout: 120, maxParticipants: maxViewers() + 1, metadata: JSON.stringify({ title: e.title }) });
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
  const { cfg } = clients();
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

/** The host is publishing: mark the event live and start any restream. */
export async function goLive(e: LiveEvent, restream: string[]): Promise<{ event: LiveEvent; restreamError: string | null }> {
  if (e.status === "ended") throw new LiveError(409, "ended", "This live event has ended.");
  const host = await hostOf(e.room);
  const video = host?.tracks.find((t) => t.type === TrackType.VIDEO);
  const audio = host?.tracks.find((t) => t.type === TrackType.AUDIO);
  if (!host || !video) throw new LiveError(409, "not_publishing", "The camera or screen is not reaching the live server yet. Wait a moment and try again.");
  let egressId: string | null = null, restreamError: string | null = null;
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
  await save(e.id, { status: "live", started_at: e.startedAt ?? Date.now(), egress_id: egressId, restream: egressId ? 1 : 0 });
  return { event: (await getEvent(e.id))!, restreamError };
}

/** End the event: stop any restream and close the room, which disconnects every viewer. */
export async function endEvent(e: LiveEvent): Promise<LiveEvent> {
  if (e.status !== "ended") {
    const c = liveConfig();
    if (c) {
      const { rooms, egress } = clients();
      if (e.egressId) await egress.stopEgress(e.egressId).catch(() => {});
      await rooms.deleteRoom(e.room).catch(() => {});
    }
    await save(e.id, { status: "ended", ended_at: Date.now() });
  }
  return (await getEvent(e.id))!;
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
  if (e.status !== "live" || !liveConfig()) return e;
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

export async function linkRecording(e: LiveEvent, videoId: string): Promise<LiveEvent> {
  await save(e.id, { video_id: videoId });
  return (await getEvent(e.id))!;
}
