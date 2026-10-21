// src/lib/storageCharge.ts
// vm_storagecharge: what keeping files on VideoMind's storage costs (Part 16e).
//
// Every file VideoMind keeps for a video is already a row in media_assets
// with its size (the original, its pictures and sound, clips). Once a day
// each owner is charged a thirtieth of the monthly price for the bytes they
// keep above the free allowance: one row in storage_days per owner and day,
// so running the job again the same day changes nothing. A public video on
// Shelby only has no original here any more, so it costs only its pictures.
//
// The charge takes what the wallet has free, never more. What it could not
// take is owed, and is paid first, oldest day first, whenever credits come
// in (a top up, a grant) and at every hourly run. After STORAGE_GRACE_DAYS
// (14) of owing, the owner's videos kept here stop playing and new uploads
// are refused until it is paid. Nothing is ever deleted for not paying.
//
// Nothing is charged while charging is off or the price is 0. An admin can
// forgive what a wallet owes; the days stay in the record as forgiven.
import crypto from "crypto";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import { balanceOf, getCreditSettings, priceFor, CreditsError } from "./credits.js";

export const GB = 1_000_000_000; // a GB as Cloudflare prices storage: 10^9 bytes
const DAY_MS = 86_400_000;
const n = (v: unknown) => Number(v ?? 0) || 0;

export function graceDays(): number {
  const d = Number(process.env.STORAGE_GRACE_DAYS);
  return Number.isFinite(d) && d >= 0 ? Math.floor(d) : 14;
}
/** "2026-10-21", the UTC day a time falls on. */
export const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfDay = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

function walletOf(v: unknown): string {
  const w = normalizeWallet(v);
  if (!w) throw new CreditsError(400, "bad_wallet", "That is not a wallet address.");
  return w;
}

// ── settings ─────────────────────────────────────────────────────────────────
export async function storageFreeBytes(): Promise<number> {
  const r = await getDb().execute("SELECT value FROM credit_settings WHERE id = 'storage_free_bytes'");
  return Math.max(0, Math.floor(n((r.rows[0] as any)?.value)));
}

/** The free allowance every owner gets before storage is charged, in GB. */
export async function setStorageFree(body: unknown): Promise<{ freeBytes: number }> {
  const raw = (body as any)?.freeGb;
  const x = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(x) || x < 0 || x > 10_000) throw new CreditsError(400, "bad_amount", "The free allowance must be a number of GB from 0 to 10,000.");
  const bytes = Math.round(x * GB);
  await getDb().execute({
    sql: "INSERT INTO credit_settings (id, value) VALUES ('storage_free_bytes', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    args: [String(bytes)],
  });
  return { freeBytes: bytes };
}

/** The price of one GB month right now: 0 while charging is off. */
async function storagePrice(): Promise<number> {
  const [settings, r] = await Promise.all([getCreditSettings(), getDb().execute("SELECT micros_per_unit FROM action_prices WHERE id = 'storage'")]);
  return settings.charging ? n((r.rows[0] as any)?.micros_per_unit) : 0;
}

// ── what each owner keeps ────────────────────────────────────────────────────
const BYTES_SQL = `SELECT COALESCE(m.owner_wallet, v.owner_wallet) AS w, SUM(m.bytes) AS b
                     FROM media_assets m LEFT JOIN videos v ON v.id = m.video_id
                    WHERE COALESCE(m.owner_wallet, v.owner_wallet) IS NOT NULL`;

export async function bytesByWallet(): Promise<Map<string, number>> {
  const r = await getDb().execute(`${BYTES_SQL} GROUP BY w`);
  const out = new Map<string, number>();
  for (const row of r.rows as any[]) {
    const w = normalizeWallet(row.w); if (!w) continue;
    out.set(w, (out.get(w) ?? 0) + n(row.b));
  }
  return out;
}
export async function bytesOf(walletIn: string): Promise<number> {
  const wallet = walletOf(walletIn);
  // Older rows may hold the address in another case, so compare without it.
  const r = await getDb().execute({ sql: `${BYTES_SQL} AND lower(COALESCE(m.owner_wallet, v.owner_wallet)) = ?`, args: [wallet.toLowerCase()] });
  return n((r.rows[0] as any)?.b);
}

/** One day of storage for this many bytes: the GB months above the free allowance, and their price. */
export function dayCharge(bytes: number, freeBytes: number, microsPerGbMonth: number) {
  const billable = Math.max(0, bytes - freeBytes);
  const gbMonths = billable / GB / 30;
  return { billable, gbMonths, micros: billable > 0 ? priceFor(microsPerGbMonth, gbMonths) : 0 };
}

// ── the daily charge ─────────────────────────────────────────────────────────
/**
 * Record today's storage for every owner above the allowance and take it
 * from their credits. Run by the hourly housekeeping; only the first run of
 * a UTC day records anything. Then collects what anyone owes.
 */
export async function chargeStorageDay(now = Date.now()): Promise<{ day: string; recorded: number; collectedMicros: number }> {
  const day = dayOf(now);
  const price = await storagePrice();
  let recorded = 0;
  if (price > 0) {
    const [bytes, free] = await Promise.all([bytesByWallet(), storageFreeBytes()]);
    for (const [wallet, b] of bytes) {
      const c = dayCharge(b, free, price);
      if (c.micros <= 0) continue;
      const r = await getDb().execute({
        sql: `INSERT INTO storage_days (wallet, day, bytes, free_bytes, unit_micros, gb_months, due_micros, paid_micros, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(wallet, day) DO NOTHING`,
        args: [wallet, day, b, free, price, c.gbMonths, c.micros, now],
      });
      recorded += r.rowsAffected;
    }
  }
  let collectedMicros = 0;
  const owing = await getDb().execute("SELECT DISTINCT wallet FROM storage_days WHERE paid_micros < due_micros AND forgiven_at IS NULL");
  for (const row of owing.rows as any[]) {
    collectedMicros += await collectOwed(String(row.wallet), now).catch((e) => { console.error(`[storage] collecting from ${row.wallet}: ${e?.message ?? e}`); return 0; });
  }
  if (recorded || collectedMicros) console.log(`[storage] ${day}: ${recorded} owner(s) charged, ${collectedMicros} micro dollars collected`);
  return { day, recorded, collectedMicros };
}

/**
 * Pay what a wallet owes for storage from what it has free, oldest day
 * first. Each payment is one charge row; a day can be paid in parts. Safe
 * to run twice at once: a payment is only counted when its row was written.
 * Answers the micro dollars collected.
 */
export async function collectOwed(walletIn: string, now = Date.now()): Promise<number> {
  const wallet = walletOf(walletIn);
  const days = await getDb().execute({
    sql: "SELECT * FROM storage_days WHERE wallet = ? AND paid_micros < due_micros AND forgiven_at IS NULL ORDER BY day",
    args: [wallet],
  });
  let collected = 0;
  for (const d of days.rows as any[]) {
    const due = n(d.due_micros), paid = n(d.paid_micros);
    const { availableMicros } = await balanceOf(wallet, now);
    const amount = Math.min(due - paid, availableMicros);
    if (amount <= 0) break;
    const key = `storage:${wallet}:${d.day}:${paid}`;
    const quantity = n(d.gb_months) * (amount / due);
    const res = await getDb().batch([
      {
        sql: `INSERT INTO credit_entries (id, wallet, at, kind, amount_micros, action, quantity, idempotency_key)
              SELECT ?, ?, ?, 'charge', ?, 'storage', ?, ?
               WHERE (SELECT COALESCE(SUM(amount_micros), 0) FROM credit_entries WHERE wallet = ?)
                   - (SELECT COALESCE(SUM(amount_micros), 0) FROM credit_holds WHERE wallet = ? AND status = 'held' AND expires_at > ?) >= ?
              ON CONFLICT(idempotency_key) DO NOTHING`,
        args: [crypto.randomUUID(), wallet, now, -amount, quantity, key, wallet, wallet, now, amount],
      },
      {
        sql: `UPDATE storage_days SET paid_micros = paid_micros + ?, paid_at = ?
               WHERE wallet = ? AND day = ? AND paid_micros = ?
                 AND EXISTS (SELECT 1 FROM credit_entries WHERE idempotency_key = ? AND at = ?)`,
        args: [amount, now, wallet, d.day, paid, key, now],
      },
    ], "write");
    if (res[1].rowsAffected === 0) break; // someone else paid it, or the money moved: the next run tries again
    collected += amount;
    if (amount < due - paid) break;
  }
  return collected;
}

/** An admin lets a wallet off what it owes for storage. The days stay, marked forgiven. */
export async function forgiveStorage(walletIn: string, adminEmail: string, now = Date.now()): Promise<{ forgivenMicros: number; days: number }> {
  const wallet = walletOf(walletIn);
  const r = await getDb().execute({
    sql: "SELECT COALESCE(SUM(due_micros - paid_micros), 0) AS m, COUNT(*) AS c FROM storage_days WHERE wallet = ? AND paid_micros < due_micros AND forgiven_at IS NULL",
    args: [wallet],
  });
  const forgivenMicros = n((r.rows[0] as any).m), days = n((r.rows[0] as any).c);
  if (!days) throw new CreditsError(409, "nothing_owed", "This wallet owes nothing for storage.");
  await getDb().execute({
    sql: "UPDATE storage_days SET forgiven_at = ?, forgiven_by = ? WHERE wallet = ? AND paid_micros < due_micros AND forgiven_at IS NULL",
    args: [now, adminEmail, wallet],
  });
  return { forgivenMicros, days };
}

// ── what a wallet sees ───────────────────────────────────────────────────────
export interface StorageStatus {
  bytes: number; freeBytes: number;
  /** The price of a GB month now (0 while charging is off), and what one day of the current bytes costs. */
  microsPerGbMonth: number; dailyMicros: number;
  owedMicros: number;
  /** The start of the oldest day still owed, and when playback and uploads pause. */
  owedSince: number | null; pausesAt: number | null; paused: boolean;
  graceDays: number;
}

export async function storageStatus(walletIn: string, now = Date.now()): Promise<StorageStatus> {
  const wallet = walletOf(walletIn);
  const [bytes, freeBytes, price, owed] = await Promise.all([
    bytesOf(wallet), storageFreeBytes(), storagePrice(),
    getDb().execute({
      sql: "SELECT COALESCE(SUM(due_micros - paid_micros), 0) AS m, MIN(day) AS d FROM storage_days WHERE wallet = ? AND paid_micros < due_micros AND forgiven_at IS NULL",
      args: [wallet],
    }),
  ]);
  const row = owed.rows[0] as any;
  const owedMicros = n(row.m);
  const owedSince = owedMicros > 0 && row.d ? startOfDay(String(row.d)) : null;
  const grace = graceDays();
  const pausesAt = owedSince == null ? null : owedSince + grace * DAY_MS;
  return {
    bytes, freeBytes, microsPerGbMonth: price, dailyMicros: dayCharge(bytes, freeBytes, price).micros,
    owedMicros, owedSince, pausesAt, paused: pausesAt != null && now >= pausesAt, graceDays: grace,
  };
}

/** True when this owner's videos kept here must not play and new uploads wait. */
export async function storagePaused(walletIn: string | null | undefined, now = Date.now()): Promise<boolean> {
  const wallet = normalizeWallet(walletIn);
  if (!wallet) return false;
  const r = await getDb().execute({
    sql: "SELECT MIN(day) AS d FROM storage_days WHERE wallet = ? AND paid_micros < due_micros AND forgiven_at IS NULL",
    args: [wallet],
  });
  const d = (r.rows[0] as any)?.d;
  return !!d && now >= startOfDay(String(d)) + graceDays() * DAY_MS;
}

export const STORAGE_UNPAID = "Your storage on VideoMind is unpaid, so new uploads are paused. Add credits on the Wallet page and what is owed is paid first.";

/** For the dashboard: everything kept, what is owed, and who is paused. */
export async function storageTotals(now = Date.now()) {
  const [bytes, owed, freeBytes] = await Promise.all([
    bytesByWallet(),
    getDb().execute("SELECT wallet, SUM(due_micros - paid_micros) AS m, MIN(day) AS d FROM storage_days WHERE paid_micros < due_micros AND forgiven_at IS NULL GROUP BY wallet"),
    storageFreeBytes(),
  ]);
  let totalBytes = 0; for (const b of bytes.values()) totalBytes += b;
  let owedMicros = 0, paused = 0;
  const grace = graceDays() * DAY_MS;
  for (const r of owed.rows as any[]) { owedMicros += n(r.m); if (now >= startOfDay(String(r.d)) + grace) paused++; }
  return { totalBytes, owners: bytes.size, freeBytes, owedMicros, walletsOwing: owed.rows.length, walletsPaused: paused, graceDays: graceDays(), gbBytes: GB };
}
