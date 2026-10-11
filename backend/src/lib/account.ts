// src/lib/account.ts
// vm_settings: a wallet's settings, and deleting everything VideoMind
// holds about a wallet (the "Delete my data" button, which the privacy
// policy promises: deletion within 7 days; this does it at once).
import { getDb } from "./db.js";
import { normalizeWallet, revokeAllSessions } from "./auth.js";
import { CATEGORIES } from "./videoInfo.js";
import { store } from "./store.js";
import { abortUpload } from "./uploads.js";
import { disconnect as disconnectYouTube } from "./youtube.js";
import { eventsOf, endEvent, liveConfig } from "./live.js";
import { dropVideoWork } from "../routes/videos.js";

export type Visibility = "private" | "unlisted" | "public";
export interface Settings { uploadVisibility: Visibility | null; uploadCategory: string | null }

const VIS: Visibility[] = ["private", "unlisted", "public"];
const w = (wallet: string) => normalizeWallet(wallet) ?? wallet;

export async function getSettings(wallet: string): Promise<Settings> {
  const r = await getDb().execute({ sql: "SELECT * FROM user_settings WHERE wallet = ?", args: [w(wallet)] });
  const row = r.rows[0] as any;
  return {
    uploadVisibility: row && VIS.includes(row.upload_visibility) ? row.upload_visibility : null,
    uploadCategory: row && (CATEGORIES as readonly string[]).includes(row.upload_category) ? row.upload_category : null,
  };
}

export class SettingsError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Save what was sent. null (or "") clears a value, which means "remember my last choice". */
export async function saveSettings(wallet: string, body: unknown): Promise<Settings> {
  const b = (body ?? {}) as Record<string, unknown>;
  const cur = await getSettings(wallet);
  const next = { ...cur };
  if ("uploadVisibility" in b) {
    const v = b.uploadVisibility === "" ? null : b.uploadVisibility;
    if (v !== null && !VIS.includes(v as Visibility)) throw new SettingsError("bad_visibility", "Visibility is private, unlisted or public.");
    next.uploadVisibility = v as Visibility | null;
  }
  if ("uploadCategory" in b) {
    const c = b.uploadCategory === "" ? null : b.uploadCategory;
    if (c !== null && !(CATEGORIES as readonly string[]).includes(String(c))) throw new SettingsError("bad_category", "That category is not one VideoMind knows.");
    next.uploadCategory = c as string | null;
  }
  await getDb().execute({
    sql: `INSERT INTO user_settings (wallet, upload_visibility, upload_category, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(wallet) DO UPDATE SET upload_visibility = excluded.upload_visibility, upload_category = excluded.upload_category, updated_at = excluded.updated_at`,
    args: [w(wallet), next.uploadVisibility, next.uploadCategory, Date.now()],
  });
  return next;
}

/**
 * Delete everything VideoMind holds about a wallet. Usage quantities in
 * the ledger are kept, without content, as the privacy policy says.
 * Copies on Shelby and on YouTube are outside VideoMind and stay.
 */
export async function deleteAccountData(wallet: string): Promise<Record<string, number>> {
  const me = w(wallet);
  const db = getDb();
  const count = async (sql: string, args: any[]) => Number(((await db.execute({ sql, args })).rows[0] as any).n);
  const done: Record<string, number> = {};

  // Videos, with their files, transcripts, clips, notes, stores, jobs and uploads.
  const ids = await store.idsFor(me);
  for (const id of ids) { await dropVideoWork(id); await store.delete(id); }
  done.videos = ids.length;
  const open = await db.execute({ sql: "SELECT video_id FROM uploads WHERE owner_wallet = ? AND status = 'open'", args: [me] });
  for (const r of open.rows as any[]) await abortUpload(String(r.video_id)).catch(() => {});
  await db.execute({ sql: "DELETE FROM uploads WHERE owner_wallet = ?", args: [me] });

  // Collections.
  done.collections = await count("SELECT COUNT(*) AS n FROM collections WHERE owner_wallet = ?", [me]);
  await db.batch([
    { sql: "DELETE FROM collection_items WHERE collection_id IN (SELECT id FROM collections WHERE owner_wallet = ?)", args: [me] },
    { sql: "DELETE FROM collections WHERE owner_wallet = ?", args: [me] },
  ], "write");

  // What this wallet wrote on other people's videos.
  done.notes = await count("SELECT COUNT(*) AS n FROM video_notes WHERE wallet = ?", [me]);
  await db.batch([
    { sql: "DELETE FROM video_notes WHERE wallet = ?", args: [me] },
    { sql: "DELETE FROM watch_progress WHERE wallet = ?", args: [me] },
  ], "write");

  // Live events, with their captions and chat; and chat written in other events.
  const events = await eventsOf(me);
  for (const e of events) {
    if (e.status === "live" && liveConfig()) await endEvent(e).catch(() => {});
    await db.batch([
      { sql: "DELETE FROM live_captions WHERE event_id = ?", args: [e.id] },
      { sql: "DELETE FROM live_chat WHERE event_id = ?", args: [e.id] },
      { sql: "DELETE FROM live_blocks WHERE event_id = ?", args: [e.id] },
      { sql: "DELETE FROM live_events WHERE id = ?", args: [e.id] },
    ], "write");
  }
  done.liveEvents = events.length;
  done.chatMessages = await count("SELECT COUNT(*) AS n FROM live_chat WHERE wallet = ? OR sender = ?", [me, `w:${me}`]);
  await db.execute({ sql: "DELETE FROM live_chat WHERE wallet = ? OR sender = ?", args: [me, `w:${me}`] });

  // YouTube: revoke at Google and forget; and any upload records left.
  await disconnectYouTube(me).catch(() => {});
  await db.execute({ sql: "DELETE FROM publications WHERE wallet = ?", args: [me] });

  // Profile, settings, sign in.
  await db.batch([
    { sql: "DELETE FROM profiles WHERE wallet = ?", args: [me] },
    { sql: "DELETE FROM user_settings WHERE wallet = ?", args: [me] },
    { sql: "DELETE FROM clips WHERE wallet = ?", args: [me] },
    { sql: "DELETE FROM anchors WHERE wallet = ?", args: [me] },
  ], "write");
  await revokeAllSessions(me);
  await db.batch([
    { sql: "DELETE FROM sessions WHERE wallet_address = ?", args: [me] },
    { sql: "DELETE FROM users WHERE wallet_address = ?", args: [me] },
  ], "write");
  console.log(`[account] deleted the data of ${me}: ${JSON.stringify(done)}`);
  return done;
}
