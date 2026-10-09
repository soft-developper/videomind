// src/lib/livechat.ts
// vm_livechat: the chat of a live event.
//
//   * the host chooses per event who may write: anyone with a name (no
//     wallet needed), signed in wallets only, or nobody (the host still can)
//   * messages are sent to the server, checked (length, one every few
//     seconds per person, blocked people), kept, and then sent to everyone
//     in the event's LiveKit room by the server. Viewers cannot send
//     anything into the room themselves
//   * the host can delete a message, or block its writer, which also
//     deletes everything that person wrote in this event
//   * the chat is open while the event is live
import crypto from "crypto";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import { liveConfig, broadcast, LiveError, type LiveEvent } from "./live.js";

export const CHAT_MAX_CHARS = 300;
export const NAME_MAX_CHARS = 30;
/** Time between two messages from one person (the host is not limited). */
export const slowMs = () => Math.max(0, Number(process.env.LIVE_CHAT_SLOW_MS ?? 3000));
/** Messages one event can hold. */
export const maxPerEvent = () => Math.max(1, Number(process.env.LIVE_CHAT_MAX_PER_EVENT) || 5000);

export interface ChatMessage {
  id: string; eventId: string; sender: string; name: string; wallet: string | null; host: boolean;
  text: string; deleted: boolean; createdAt: number;
}
const rowToMessage = (r: Record<string, unknown>): ChatMessage => ({
  id: String(r.id), eventId: String(r.event_id), sender: String(r.sender), name: String(r.name),
  wallet: r.wallet ? String(r.wallet) : null, host: Number(r.host) === 1, text: String(r.text),
  deleted: Number(r.deleted) === 1, createdAt: Number(r.created_at),
});

// ── who is writing ────────────────────────────────────────────────────────────

/** The key that signs chat passes: derived from the LiveKit secret, never stored. */
function key(): Buffer {
  const c = liveConfig();
  if (!c) throw new LiveError(503, "live_off", "Live is not set up on this server yet.");
  return Buffer.from(crypto.hkdfSync("sha256", c.secret, "videomind", "live chat pass", 32));
}
export interface ChatPass { eventId: string; sender: string; name: string; wallet: string | null; host: boolean }

/** A short, stable label for a writer, so viewers can tell writers apart without learning who they are. */
export const fromOf = (eventId: string, sender: string) =>
  crypto.createHmac("sha256", key()).update(`${eventId}|${sender}`).digest("base64url").slice(0, 10);

function sign(p: ChatPass): string {
  const body = Buffer.from(JSON.stringify({ e: p.eventId, s: p.sender, n: p.name, w: p.wallet, h: p.host ? 1 : 0, x: Date.now() + 12 * 3_600_000 })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", key()).update(body).digest("base64url")}`;
}
export function readPass(token: unknown, eventId: string): ChatPass | null {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString());
    if (j.e !== eventId || !(j.x > Date.now()) || typeof j.s !== "string" || typeof j.n !== "string") return null;
    return { eventId: j.e, sender: j.s, name: j.n, wallet: typeof j.w === "string" ? j.w : null, host: j.h === 1 };
  } catch { return null; }
}

const cleanName = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/**
 * Join the chat. The host always may. Otherwise the event's mode decides:
 * anyone (a name is needed, or a signed in wallet), wallets (sign in
 * needed), off (nobody).
 */
export async function joinChat(e: LiveEvent, who: { wallet: string | null; owner: boolean; profileName: string | null; name: unknown }): Promise<{ token: string; name: string; host: boolean; from: string }> {
  let pass: ChatPass;
  if (who.owner) {
    pass = { eventId: e.id, sender: "host", name: who.profileName ?? "Host", wallet: who.wallet, host: true };
  } else {
    if (e.chatMode === "off") throw new LiveError(409, "chat_off", "The host has turned the chat off.");
    if (e.chatMode === "wallets" && !who.wallet) throw new LiveError(401, "wallet_needed", "Only signed in wallets can write in this chat. Connect a wallet to join.");
    const typed = cleanName(who.name);
    if (typed.length > NAME_MAX_CHARS) throw new LiveError(400, "name_too_long", `Keep the name to ${NAME_MAX_CHARS} characters.`);
    if (/^host$/i.test(typed)) throw new LiveError(400, "bad_name", "Choose another name.");
    if (who.wallet) {
      const w = normalizeWallet(who.wallet) ?? who.wallet;
      pass = { eventId: e.id, sender: `w:${w}`, name: typed || who.profileName || short(w), wallet: w, host: false };
    } else {
      if (!typed) throw new LiveError(400, "bad_name", "Type a name to join the chat.");
      pass = { eventId: e.id, sender: `a:${crypto.randomBytes(9).toString("base64url")}`, name: typed, wallet: null, host: false };
    }
  }
  if (!pass.host && await isBlocked(e.id, pass.sender)) throw new LiveError(403, "blocked", "The host has blocked you from this chat.");
  return { token: sign(pass), name: pass.name, host: pass.host, from: fromOf(e.id, pass.sender) };
}

async function isBlocked(eventId: string, sender: string): Promise<boolean> {
  const r = await getDb().execute({ sql: "SELECT 1 FROM live_blocks WHERE event_id = ? AND sender = ?", args: [eventId, sender] });
  return r.rows.length > 0;
}

// ── messages ──────────────────────────────────────────────────────────────────

export const viewMessage = (m: ChatMessage) => ({
  id: m.id, name: m.name, host: m.host, wallet: !!m.wallet, text: m.text, at: m.createdAt, from: fromOf(m.eventId, m.sender),
});

const lastPost = new Map<string, number>();

export async function postMessage(e: LiveEvent, pass: ChatPass, text: unknown) {
  if (e.status !== "live") throw new LiveError(409, e.status === "ended" ? "ended" : "not_live", e.status === "ended" ? "This live event has ended." : "The chat opens when the event starts.");
  if (!pass.host) {
    if (e.chatMode === "off") throw new LiveError(409, "chat_off", "The host has turned the chat off.");
    if (e.chatMode === "wallets" && !pass.wallet) throw new LiveError(403, "wallet_needed", "The host now allows only signed in wallets to write. Connect a wallet to join again.");
    if (await isBlocked(e.id, pass.sender)) throw new LiveError(403, "blocked", "The host has blocked you from this chat.");
  }
  const t = String(text ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) throw new LiveError(400, "empty", "Type a message.");
  if (t.length > CHAT_MAX_CHARS) throw new LiveError(400, "too_long", `Keep a message to ${CHAT_MAX_CHARS} characters.`);
  const k = `${e.id}|${pass.sender}`, now = Date.now();
  if (!pass.host) {
    const wait = (lastPost.get(k) ?? 0) + slowMs() - now;
    if (wait > 0) throw Object.assign(new LiveError(429, "slow", `Slow mode: wait ${Math.ceil(wait / 1000)} s before the next message.`), { retryAfter: Math.ceil(wait / 1000) });
  }
  const count = await getDb().execute({ sql: "SELECT COUNT(*) AS n FROM live_chat WHERE event_id = ?", args: [e.id] });
  if (Number((count.rows[0] as any).n) >= maxPerEvent()) throw new LiveError(409, "chat_full", "This chat has reached its message limit.");
  lastPost.set(k, now);
  if (lastPost.size > 50_000) for (const [x, at] of lastPost) if (now - at > 60_000) lastPost.delete(x);
  const m: ChatMessage = { id: crypto.randomUUID(), eventId: e.id, sender: pass.sender, name: pass.name, wallet: pass.wallet, host: pass.host, text: t, deleted: false, createdAt: now };
  await getDb().execute({
    sql: "INSERT INTO live_chat (id, event_id, sender, name, wallet, host, text, deleted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
    args: [m.id, m.eventId, m.sender, m.name, m.wallet, m.host ? 1 : 0, m.text, m.createdAt],
  });
  const v = viewMessage(m);
  await broadcast(e, "chat", { type: "message", message: v });
  return v;
}

/** The latest messages, oldest first. */
export async function listMessages(e: LiveEvent, limit = 100) {
  const r = await getDb().execute({
    sql: "SELECT * FROM (SELECT * FROM live_chat WHERE event_id = ? AND deleted = 0 ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at ASC",
    args: [e.id, Math.min(500, Math.max(1, limit))],
  });
  return r.rows.map((x) => viewMessage(rowToMessage(x as Record<string, unknown>)));
}

async function getMessage(e: LiveEvent, id: string): Promise<ChatMessage | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM live_chat WHERE id = ? AND event_id = ?", args: [id, e.id] });
  return r.rows[0] ? rowToMessage(r.rows[0] as Record<string, unknown>) : null;
}

export async function deleteMessage(e: LiveEvent, id: string): Promise<void> {
  const m = await getMessage(e, id);
  if (!m) throw new LiveError(404, "not_found", "Message not found.");
  await getDb().execute({ sql: "UPDATE live_chat SET deleted = 1 WHERE id = ?", args: [id] });
  await broadcast(e, "chat", { type: "delete", ids: [id] });
}

/** Block the writer of a message from this event's chat and remove everything they wrote. */
export async function blockWriter(e: LiveEvent, messageId: string): Promise<number> {
  const m = await getMessage(e, messageId);
  if (!m) throw new LiveError(404, "not_found", "Message not found.");
  if (m.host) throw new LiveError(400, "is_host", "The host cannot be blocked.");
  await getDb().execute({ sql: "INSERT OR IGNORE INTO live_blocks (event_id, sender, created_at) VALUES (?, ?, ?)", args: [e.id, m.sender, Date.now()] });
  const gone = await getDb().execute({ sql: "SELECT id FROM live_chat WHERE event_id = ? AND sender = ? AND deleted = 0", args: [e.id, m.sender] });
  const ids = gone.rows.map((x: any) => String(x.id));
  await getDb().execute({ sql: "UPDATE live_chat SET deleted = 1 WHERE event_id = ? AND sender = ?", args: [e.id, m.sender] });
  await broadcast(e, "chat", { type: "delete", ids });
  return ids.length;
}

// ── captions kept with the event ──────────────────────────────────────────────

export async function addCaption(eventId: string, item: string, atMs: number, text: string): Promise<void> {
  await getDb().execute({
    sql: "INSERT INTO live_captions (event_id, item, at_ms, text, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [eventId, item, Math.max(0, Math.round(atMs)), text, Date.now()],
  });
}
export async function listCaptions(eventId: string, limit = 2000): Promise<Array<{ at: number; text: string }>> {
  const r = await getDb().execute({
    sql: "SELECT * FROM (SELECT at_ms, text, id FROM live_captions WHERE event_id = ? ORDER BY id DESC LIMIT ?) ORDER BY at_ms ASC, id ASC",
    args: [eventId, Math.min(5000, Math.max(1, limit))],
  });
  return r.rows.map((x: any) => ({ at: Number(x.at_ms), text: String(x.text) }));
}
