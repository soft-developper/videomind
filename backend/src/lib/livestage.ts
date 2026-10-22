// src/lib/livestage.ts
// vm_stage (Part 21b1): bringing viewers on stage during a live event.
//
//   * only signed in wallets may raise a hand (their identity in the room is
//     tied to the wallet, see walletTag in lib/live.ts)
//   * the host sees the raised hands and invites one; nothing turns on until
//     the viewer says yes on their page and the browser asks for the camera
//     and the microphone
//   * on yes the server lets that participant publish a camera and a
//     microphone, never a screen (LiveKit UpdateParticipant)
//   * at most MAX_SPEAKERS invited or speaking at once, enforced here in one
//     UPDATE, so two invitations at the same moment cannot pass the limit
//   * the host can mute a speaker's microphone or camera (MutePublishedTrack;
//     the speaker can turn it back on) or remove them from the stage, which
//     takes the permission back: LiveKit unpublishes their tracks at once
//   * blocking a wallet in the chat also removes it from the stage and stops
//     it raising a hand again in that event
//   * the server tells the host and the viewer concerned through the room
//     (topic "stage", sent only to them); nothing is told to other viewers
//
// Rows live in live_stage while a hand is up, an invitation waits, or a
// speaker is on stage. They are deleted when the event ends.
import { TrackSource, TrackType } from "livekit-server-sdk";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import { LiveError, roomService, walletTag, broadcast, HOST_IDENTITY, type LiveEvent } from "./live.js";
import { isBlocked } from "./livechat.js";

export const MAX_SPEAKERS = 3;
/** An invitation not answered in this time lapses and the hand goes back up. */
export const INVITE_MS = 2 * 60_000;
/** The most hands up at once in one event. */
const MAX_HANDS = 200;
export const NOTE_MAX_CHARS = 100;

export type StageState = "raised" | "invited" | "speaking";
export interface StageRow {
  eventId: string; wallet: string; identity: string; name: string; note: string | null;
  state: StageState; raisedAt: number; updatedAt: number;
}
const toRow = (r: Record<string, unknown>): StageRow => ({
  eventId: String(r.event_id), wallet: String(r.wallet), identity: String(r.identity), name: String(r.name),
  note: r.note ? String(r.note) : null, state: String(r.state) as StageState,
  raisedAt: Number(r.raised_at), updatedAt: Number(r.updated_at),
});

const w = (wallet: string) => normalizeWallet(wallet) ?? wallet;

async function rowOf(eventId: string, wallet: string): Promise<StageRow | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM live_stage WHERE event_id = ? AND wallet = ?", args: [eventId, w(wallet)] });
  return r.rows[0] ? toRow(r.rows[0] as Record<string, unknown>) : null;
}

function mustBeLive(e: LiveEvent) {
  if (e.status !== "live") throw new LiveError(409, "not_live", "The stage is open while the event is live.");
}

/** What a speaker may do: a camera and a microphone, watch and listen. */
const SPEAKER = { canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE] };
const WATCHER = { canPublish: false, canSubscribe: true, canPublishData: false, canPublishSources: [] as TrackSource[] };

/** Tell the host the list changed, and the viewer concerned their new state. */
async function tell(e: LiveEvent, row: { identity: string } | null, state: StageState | "none", extra: Record<string, unknown> = {}) {
  await broadcast(e, "stage", { type: "hands" }, [HOST_IDENTITY]);
  if (row) await broadcast(e, "stage", { type: "stage", state, ...extra }, [row.identity]);
}

// ── the viewer's side ─────────────────────────────────────────────────────────

/** Raise a hand. The identity must be this wallet's, and in the room now. */
export async function raiseHand(e: LiveEvent, wallet: string, identity: unknown, name: string, note: unknown): Promise<StageRow> {
  mustBeLive(e);
  const id = typeof identity === "string" ? identity : "";
  if (!id.startsWith(walletTag(e.id, wallet))) {
    throw new LiveError(409, "rejoin", "Reload the page to raise your hand. You signed in after the page joined the event.");
  }
  if (await isBlocked(e.id, `w:${w(wallet)}`)) throw new LiveError(403, "blocked", "The host has blocked you from this event's chat and stage.");
  const text = typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX_CHARS) : "";
  const there = await roomService().getParticipant(e.room, id).catch(() => null);
  if (!there) throw new LiveError(409, "not_in_room", "Your page is not connected to the event. Reload it and try again.");
  const had = await rowOf(e.id, wallet);
  if (had && had.state !== "raised") return had;          // already invited or on stage
  const count = await getDb().execute({ sql: "SELECT COUNT(*) AS n FROM live_stage WHERE event_id = ? AND state = 'raised'", args: [e.id] });
  if (!had && Number((count.rows[0] as any).n) >= MAX_HANDS) throw new LiveError(429, "too_many_hands", "Many hands are up already. Try again in a moment.");
  const now = Date.now();
  await getDb().execute({
    sql: `INSERT INTO live_stage (event_id, wallet, identity, name, note, state, raised_at, updated_at) VALUES (?, ?, ?, ?, ?, 'raised', ?, ?)
          ON CONFLICT (event_id, wallet) DO UPDATE SET identity = excluded.identity, name = excluded.name, note = excluded.note, updated_at = excluded.updated_at
          WHERE live_stage.state = 'raised'`,
    args: [e.id, w(wallet), id, name.slice(0, 60), text || null, now, now],
  });
  const row = (await rowOf(e.id, wallet))!;
  await tell(e, row, row.state);
  return row;
}

/** Lower the hand, say no to an invitation, or leave the stage. */
export async function leaveStage(e: LiveEvent, wallet: string): Promise<void> {
  const row = await rowOf(e.id, wallet);
  if (!row) return;
  await getDb().execute({ sql: "DELETE FROM live_stage WHERE event_id = ? AND wallet = ?", args: [e.id, row.wallet] });
  if (row.state === "speaking" && e.status === "live") {
    await roomService().updateParticipant(e.room, row.identity, { permission: WATCHER }).catch(() => {});
  }
  await tell(e, row, "none");
}

/** Say yes to the host's invitation: the server lets this participant publish a camera and a microphone. */
export async function acceptInvite(e: LiveEvent, wallet: string): Promise<StageRow> {
  mustBeLive(e);
  const row = await rowOf(e.id, wallet);
  if (!row || row.state !== "invited") throw new LiveError(409, "not_invited", "The invitation is no longer open.");
  if (Date.now() - row.updatedAt > INVITE_MS) {
    await lapse(e, row);
    throw new LiveError(409, "invite_lapsed", "The invitation lapsed. Your hand is still up.");
  }
  const res = await getDb().execute({
    sql: "UPDATE live_stage SET state = 'speaking', updated_at = ? WHERE event_id = ? AND wallet = ? AND state = 'invited'",
    args: [Date.now(), e.id, row.wallet],
  });
  if (!res.rowsAffected) throw new LiveError(409, "not_invited", "The invitation is no longer open.");
  try {
    await roomService().updateParticipant(e.room, row.identity, { permission: SPEAKER });
  } catch (err) {
    await getDb().execute({ sql: "UPDATE live_stage SET state = 'raised', updated_at = ? WHERE event_id = ? AND wallet = ?", args: [Date.now(), e.id, row.wallet] });
    await tell(e, row, "raised");
    throw err;
  }
  const fresh = (await rowOf(e.id, wallet))!;
  await tell(e, fresh, "speaking");
  return fresh;
}

/** The viewer's own place: raised, invited, speaking, or none. */
export async function myStage(e: LiveEvent, wallet: string): Promise<{ state: StageState | "none"; note: string | null; invitedAt: number | null; blocked: boolean }> {
  const row = await rowOf(e.id, wallet);
  const blocked = await isBlocked(e.id, `w:${w(wallet)}`);
  if (row && row.state === "invited" && Date.now() - row.updatedAt > INVITE_MS) { await lapse(e, row); return { state: "raised", note: row.note, invitedAt: null, blocked }; }
  return { state: row?.state ?? "none", note: row?.note ?? null, invitedAt: row?.state === "invited" ? row.updatedAt : null, blocked };
}

async function lapse(e: LiveEvent, row: StageRow) {
  const res = await getDb().execute({
    sql: "UPDATE live_stage SET state = 'raised', updated_at = ? WHERE event_id = ? AND wallet = ? AND state = 'invited'",
    args: [Date.now(), e.id, row.wallet],
  });
  if (res.rowsAffected) await tell(e, row, "raised", { lapsed: true });
}

// ── the host's side ───────────────────────────────────────────────────────────

/**
 * The raised hands, the invitations waiting and the speakers. Anyone no
 * longer in the room is dropped, and invitations past INVITE_MS lapse.
 */
export async function listStage(e: LiveEvent): Promise<{ hands: StageRow[]; invited: StageRow[]; speakers: StageRow[]; max: number }> {
  const r = await getDb().execute({ sql: "SELECT * FROM live_stage WHERE event_id = ? ORDER BY raised_at", args: [e.id] });
  let rows = r.rows.map((x) => toRow(x as Record<string, unknown>));
  if (rows.length && e.status === "live") {
    const inRoom = await roomService().listParticipants(e.room).catch(() => null);
    if (inRoom) {
      const here = new Set(inRoom.map((p) => p.identity));
      const gone = rows.filter((x) => !here.has(x.identity));
      for (const g of gone) await getDb().execute({ sql: "DELETE FROM live_stage WHERE event_id = ? AND wallet = ? AND identity = ?", args: [e.id, g.wallet, g.identity] });
      rows = rows.filter((x) => here.has(x.identity));
    }
    for (const x of rows) if (x.state === "invited" && Date.now() - x.updatedAt > INVITE_MS) { await lapse(e, x); x.state = "raised"; }
  }
  return {
    hands: rows.filter((x) => x.state === "raised"),
    invited: rows.filter((x) => x.state === "invited"),
    speakers: rows.filter((x) => x.state === "speaking"),
    max: MAX_SPEAKERS,
  };
}

/** Invite a raised hand. Refused while MAX_SPEAKERS are invited or speaking. */
export async function invite(e: LiveEvent, wallet: string): Promise<StageRow> {
  mustBeLive(e);
  await listStage(e);                                     // drop people who left, lapse old invitations
  const row = await rowOf(e.id, wallet);
  if (!row || row.state !== "raised") throw new LiveError(409, "no_hand", "That hand is no longer up.");
  const res = await getDb().execute({
    sql: `UPDATE live_stage SET state = 'invited', updated_at = ? WHERE event_id = ? AND wallet = ? AND state = 'raised'
          AND (SELECT COUNT(*) FROM live_stage WHERE event_id = ? AND state IN ('invited', 'speaking')) < ?`,
    args: [Date.now(), e.id, row.wallet, e.id, MAX_SPEAKERS],
  });
  if (!res.rowsAffected) {
    const again = await rowOf(e.id, wallet);
    if (!again || again.state !== "raised") throw new LiveError(409, "no_hand", "That hand is no longer up.");
    throw new LiveError(409, "stage_full", `Up to ${MAX_SPEAKERS} people can be on stage with you. Remove someone first.`);
  }
  const fresh = (await rowOf(e.id, wallet))!;
  await tell(e, fresh, "invited");
  return fresh;
}

/** Take someone off the stage, cancel an invitation, or lower a hand. */
export async function removeFromStage(e: LiveEvent, wallet: string): Promise<boolean> {
  const row = await rowOf(e.id, wallet);
  if (!row) return false;
  await getDb().execute({ sql: "DELETE FROM live_stage WHERE event_id = ? AND wallet = ?", args: [e.id, row.wallet] });
  if (row.state === "speaking" && e.status === "live") {
    await roomService().updateParticipant(e.room, row.identity, { permission: WATCHER }).catch((err) => {
      console.error(`[live] ${e.id}: taking the stage back from ${row.identity} failed: ${err?.message ?? err}`);
    });
  }
  await tell(e, row, "none", { removed: true });
  return true;
}

/** Mute a speaker's microphone or camera. The speaker can turn it back on; removing is the stronger step. */
export async function muteSpeaker(e: LiveEvent, wallet: string, kind: unknown): Promise<void> {
  mustBeLive(e);
  if (kind !== "audio" && kind !== "video") throw new LiveError(400, "bad_kind", "Mute the microphone or the camera.");
  const row = await rowOf(e.id, wallet);
  if (!row || row.state !== "speaking") throw new LiveError(409, "not_speaking", "That person is not on stage.");
  const p = await roomService().getParticipant(e.room, row.identity).catch(() => null);
  const track = p?.tracks.find((t) => (kind === "audio" ? t.type === TrackType.AUDIO : t.type === TrackType.VIDEO));
  if (!track) throw new LiveError(409, "no_track", kind === "audio" ? "Their microphone is not on." : "Their camera is not on.");
  await roomService().mutePublishedTrack(e.room, row.identity, track.sid, true);
  await broadcast(e, "stage", { type: "muted", kind }, [row.identity]);
}

/** vm_stage: the wallet that wrote a chat message, when it was a signed in wallet. */
export async function writerWallet(eventId: string, messageId: string): Promise<string | null> {
  const r = await getDb().execute({ sql: "SELECT wallet, host FROM live_chat WHERE id = ? AND event_id = ?", args: [messageId, eventId] });
  const m = r.rows[0] as any;
  return m && m.wallet && Number(m.host) !== 1 ? String(m.wallet) : null;
}

export const viewRow = (x: StageRow) => ({ wallet: x.wallet, name: x.name, note: x.note, state: x.state, raisedAt: x.raisedAt, updatedAt: x.updatedAt });
