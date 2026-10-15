// src/lib/adminUsers.ts
// vm_admin_users: the dashboard's Users section. A user is a wallet that
// has signed in. Admins can list and search wallets, open one, sign it out
// everywhere, suspend it (it cannot sign in until the suspension is lifted)
// and delete its data. A suspension is kept in its own table, so it
// survives deleting the wallet's data.
import { getDb } from "./db.js";
import { normalizeWallet, revokeAllSessions } from "./auth.js";
import { store } from "./store.js";
import { usageTotals } from "./usage.js";

const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export class UsersError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const SUSPENDED_MESSAGE = "This wallet is suspended from VideoMind and cannot sign in. If you think this is a mistake, write to privacy@vidzmind.xyz.";

export async function isSuspended(wallet: string): Promise<boolean> {
  const w = normalizeWallet(wallet) ?? wallet;
  const r = await getDb().execute({ sql: "SELECT 1 FROM wallet_suspensions WHERE wallet = ?", args: [w] });
  return r.rows.length > 0;
}

export type UserSort = "joined" | "active" | "videos" | "storage";
export const SORTS: UserSort[] = ["joined", "active", "videos", "storage"];

// Every wallet that signed in, plus suspended wallets whose data was deleted.
const BASE = `
  WITH w AS (SELECT wallet_address AS wallet FROM users UNION SELECT wallet FROM wallet_suspensions),
  vids AS (
    SELECT COALESCE(v.owner_wallet, s.account_address) AS wallet, COUNT(*) AS n
      FROM videos v LEFT JOIN video_shelby s ON s.video_id = v.id
     WHERE v.status != 'uploading'
     GROUP BY 1
  ),
  bytes AS (
    SELECT owner_wallet AS wallet,
           SUM(CASE metric WHEN 'bytes_stored' THEN quantity WHEN 'bytes_deleted' THEN -quantity ELSE 0 END) AS n
      FROM usage_ledger WHERE owner_wallet IS NOT NULL GROUP BY owner_wallet
  ),
  sess AS (SELECT wallet_address AS wallet, COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ? GROUP BY wallet_address)
  SELECT w.wallet AS wallet, u.created_at AS joined_at, u.last_seen_at AS last_sign_in_at, p.name AS name,
         COALESCE(vids.n, 0) AS videos, MAX(COALESCE(bytes.n, 0), 0) AS storage, COALESCE(sess.n, 0) AS sessions,
         ws.suspended_at AS suspended_at, ws.reason AS suspended_reason
    FROM w
    LEFT JOIN users u ON u.wallet_address = w.wallet
    LEFT JOIN profiles p ON p.wallet = w.wallet
    LEFT JOIN vids ON vids.wallet = w.wallet
    LEFT JOIN bytes ON bytes.wallet = w.wallet
    LEFT JOIN sess ON sess.wallet = w.wallet
    LEFT JOIN wallet_suspensions ws ON ws.wallet = w.wallet`;

function rowToUser(r: any) {
  return {
    wallet: String(r.wallet), name: s(r.name),
    joinedAt: r.joined_at == null ? null : n(r.joined_at), lastSignInAt: r.last_sign_in_at == null ? null : n(r.last_sign_in_at),
    videos: n(r.videos), storageBytes: n(r.storage), openSessions: n(r.sessions),
    suspended: r.suspended_at != null, suspendedAt: r.suspended_at == null ? null : n(r.suspended_at), suspendedReason: s(r.suspended_reason),
    dataDeleted: r.joined_at == null,
  };
}
export type AdminUser = ReturnType<typeof rowToUser>;

export async function listUsers(opts: { q?: unknown; filter?: unknown; sort?: unknown; limit?: unknown; offset?: unknown }) {
  const q = String(opts.q ?? "").trim().toLowerCase().slice(0, 100);
  const filter = opts.filter === "suspended" ? "suspended" : "all";
  const sort: UserSort = SORTS.includes(opts.sort as UserSort) ? (opts.sort as UserSort) : "joined";
  const limit = Math.min(Math.max(Math.floor(n(opts.limit)) || 50, 1), 200);
  const offset = Math.max(Math.floor(n(opts.offset)), 0);
  const where: string[] = []; const args: any[] = [Date.now()];
  if (q) { where.push("(w.wallet LIKE ? OR LOWER(COALESCE(p.name, '')) LIKE ?)"); args.push(`%${q}%`, `%${q}%`); }
  if (filter === "suspended") where.push("ws.suspended_at IS NOT NULL");
  const order = {
    joined: "COALESCE(u.created_at, ws.suspended_at) DESC",
    active: "COALESCE(u.last_seen_at, 0) DESC",
    videos: "videos DESC, COALESCE(u.created_at, 0) DESC",
    storage: "storage DESC, COALESCE(u.created_at, 0) DESC",
  }[sort];
  const sql = `${BASE} ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const db = getDb();
  const [rows, total] = await Promise.all([
    db.execute({ sql: `${sql} ORDER BY ${order}, w.wallet LIMIT ? OFFSET ?`, args: [...args, limit, offset] }),
    db.execute({ sql: `SELECT COUNT(*) AS n FROM (${sql})`, args }),
  ]);
  return { users: (rows.rows as any[]).map(rowToUser), total: n((total.rows[0] as any).n), limit, offset, sort, filter, q };
}

export async function getUser(walletRaw: string) {
  const wallet = normalizeWallet(walletRaw);
  if (!wallet) throw new UsersError(400, "bad_wallet", "That is not a wallet address.");
  const db = getDb();
  const r = await db.execute({ sql: `${BASE} WHERE w.wallet = ?`, args: [Date.now(), wallet] });
  if (!r.rows[0]) throw new UsersError(404, "not_found", "No wallet with that address has signed in to VideoMind.");
  const user = rowToUser(r.rows[0]);
  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const count = async (sql: string, args: any[] = [wallet]) => n(((await db.execute({ sql, args })).rows[0] as any).n);
  const videos = (await store.getAll(wallet)).map((v) => ({
    id: v.id, title: v.title, status: v.status, visibility: v.visibility ?? "unlisted", createdAt: v.createdAt,
    sizeBytes: v.meta?.sizeBytes ?? null, durationSeconds: v.meta?.durationSeconds ?? v.media?.durationSeconds ?? null,
    onShelby: !!v.shelby.accountAddress && !!v.shelby.videoTxHash,
  }));
  const [allTime, thisMonth, collections, notes, liveEvents, clips, youtube, views30] = await Promise.all([
    usageTotals(wallet, 0), usageTotals(wallet, month.getTime()),
    count("SELECT COUNT(*) AS n FROM collections WHERE owner_wallet = ?"),
    count("SELECT COUNT(*) AS n FROM video_notes WHERE wallet = ?"),
    count("SELECT COUNT(*) AS n FROM live_events WHERE wallet = ?"),
    count("SELECT COUNT(*) AS n FROM clips WHERE wallet = ?"),
    count("SELECT COUNT(*) AS n FROM youtube_accounts WHERE wallet = ?"),
    videos.length
      ? count(`SELECT COALESCE(SUM(views), 0) AS n FROM video_views WHERE day >= ? AND video_id IN (${videos.map(() => "?").join(",")})`,
          [new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10), ...videos.map((v) => v.id)])
      : Promise.resolve(0),
  ]);
  const sum = (t: typeof allTime, metric: string) => t.filter((x) => x.metric === metric).reduce((a, x) => a + x.total, 0);
  const usage = (t: typeof allTime) => ({
    transcribedSeconds: sum(t, "audio_seconds"),
    inputTokens: sum(t, "input_tokens") + sum(t, "cache_write_tokens") + sum(t, "cache_read_tokens"),
    outputTokens: sum(t, "output_tokens"),
    bytesUploaded: sum(t, "bytes_stored"),
  });
  return {
    user, videos, counts: { collections, notes, liveEvents, clips, views30 }, youtubeConnected: youtube > 0,
    usage: { allTime: usage(allTime), thisMonth: usage(thisMonth) },
  };
}

export async function suspendUser(walletRaw: string, reason: unknown, adminEmail: string) {
  const wallet = normalizeWallet(walletRaw);
  if (!wallet) throw new UsersError(400, "bad_wallet", "That is not a wallet address.");
  const why = String(reason ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  if (why.length < 3) throw new UsersError(400, "reason_needed", "Write the reason for the suspension. It is kept with it.");
  await getDb().execute({
    sql: `INSERT INTO wallet_suspensions (wallet, reason, suspended_at, admin_email) VALUES (?, ?, ?, ?)
          ON CONFLICT(wallet) DO UPDATE SET reason = excluded.reason, suspended_at = excluded.suspended_at, admin_email = excluded.admin_email`,
    args: [wallet, why, Date.now(), adminEmail],
  });
  const ended = await revokeAllSessions(wallet);
  return { wallet, ended };
}

export async function liftSuspension(walletRaw: string) {
  const wallet = normalizeWallet(walletRaw);
  if (!wallet) throw new UsersError(400, "bad_wallet", "That is not a wallet address.");
  const r = await getDb().execute({ sql: "DELETE FROM wallet_suspensions WHERE wallet = ?", args: [wallet] });
  if (r.rowsAffected === 0) throw new UsersError(409, "not_suspended", "That wallet is not suspended.");
  return { wallet };
}
