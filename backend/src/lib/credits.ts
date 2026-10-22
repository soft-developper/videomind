// src/lib/credits.ts
// vm_credits: credits, the money a wallet holds with VideoMind (Part 16a).
//
// Everything is counted in whole micro dollars (1 dollar = 1,000,000), so
// no amount is ever a fraction. Tokens only matter when credits come in
// (a top up, Part 16b); inside VideoMind it is all dollars.
//
// credit_entries is the ledger. Rows are only ever added, never changed,
// and a wallet's balance is the sum of its rows. Kinds:
//   welcome  the free amount every wallet gets once (an admin sets it)
//   grant    free credits an admin gave
//   remove   credits an admin took back (never more than are available)
//   topup    credits paid for (Part 16b)
//   charge   what an action cost (always negative)
//   refund   a charge given back by an admin, once per charge
//
// A hold sets money aside before an action starts, at the price shown, so
// two actions at once can never spend the same money. When the action is
// done the hold is settled: one charge row, never more than was held. When
// it fails the hold is released and nothing is charged. A hold nobody
// settles expires, which also charges nothing.
//
// Charging is off until Part 16c wires actions to holds and an admin turns
// it on. While it is off, reserve() answers "free" for every action.
import crypto from "crypto";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import { listPrices, modelMatches, quantityIn } from "./costs.js";
import { minutesTranslated } from "./translate.js";

export const MICROS = 1_000_000;
const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => (v == null ? null : String(v));

export class CreditsError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export type EntryKind = "welcome" | "grant" | "remove" | "topup" | "charge" | "refund";
export const ENTRY_KINDS: EntryKind[] = ["welcome", "grant", "remove", "topup", "charge", "refund"];

export interface Entry {
  id: string; wallet: string; at: number; kind: EntryKind; amountMicros: number;
  action: string | null; quantity: number | null; videoId: string | null; holdId: string | null;
  refundOf: string | null; note: string | null; adminEmail: string | null; refunded: boolean;
  /** vm_topup: the transaction hash of a top up. */
  ref: string | null;
}
const rowToEntry = (r: any): Entry => ({
  id: String(r.id), wallet: String(r.wallet), at: n(r.at), kind: String(r.kind) as EntryKind, amountMicros: n(r.amount_micros),
  action: s(r.action), quantity: r.quantity == null ? null : n(r.quantity), videoId: s(r.video_id), holdId: s(r.hold_id),
  refundOf: s(r.refund_of), note: s(r.note), adminEmail: s(r.admin_email), refunded: !!n(r.refunded), ref: s(r.ref),
});

export interface Hold {
  id: string; wallet: string; action: string; quantity: number; amountMicros: number; unitMicros: number;
  status: "held" | "settled" | "released" | "expired"; videoId: string | null; jobId: string | null;
  createdAt: number; expiresAt: number; closedAt: number | null; chargedMicros: number | null;
}
const rowToHold = (r: any): Hold => ({
  id: String(r.id), wallet: String(r.wallet), action: String(r.action), quantity: n(r.quantity), amountMicros: n(r.amount_micros),
  unitMicros: n(r.unit_micros), status: String(r.status) as Hold["status"], videoId: s(r.video_id), jobId: s(r.job_id),
  createdAt: n(r.created_at), expiresAt: n(r.expires_at), closedAt: r.closed_at == null ? null : n(r.closed_at),
  chargedMicros: r.charged_micros == null ? null : n(r.charged_micros),
});

function walletOf(v: unknown): string {
  const w = normalizeWallet(v);
  if (!w) throw new CreditsError(400, "bad_wallet", "That is not a wallet address.");
  return w;
}

/** Dollars as typed in the dashboard ("2.5", 2.5) to micro dollars. */
export function dollarsToMicros(v: unknown, what = "The amount", max = 10_000): number {
  const raw = typeof v === "string" ? v.trim() : v;
  const x = typeof raw === "number" ? raw : raw === "" || raw == null ? NaN : Number(raw);
  if (!Number.isFinite(x) || x < 0) throw new CreditsError(400, "bad_amount", `${what} must be a number of US dollars, 0 or more.`);
  if (x > max) throw new CreditsError(400, "bad_amount", `${what} can be at most ${max.toLocaleString("en-US")} US dollars.`);
  return Math.round(x * MICROS);
}
const note = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || null;

// ── settings ─────────────────────────────────────────────────────────────────
export interface CreditSettings { charging: boolean; welcomeMicros: number }

export async function getCreditSettings(): Promise<CreditSettings> {
  const r = await getDb().execute("SELECT id, value FROM credit_settings");
  const m = new Map((r.rows as any[]).map((x) => [String(x.id), String(x.value)]));
  return { charging: m.get("charging") === "on", welcomeMicros: Math.max(0, Math.floor(n(m.get("welcome_micros")))) };
}

// vm_priceshapes: processing is charged for at least this many minutes per video (Part 20b).
export const DEFAULT_PROCESS_MIN_MINUTES = 5;
export async function getProcessMinMinutes(): Promise<number> {
  const r = await getDb().execute("SELECT value FROM credit_settings WHERE id = 'process_min_minutes'");
  const v = r.rows[0] ? Number((r.rows[0] as any).value) : DEFAULT_PROCESS_MIN_MINUTES;
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_PROCESS_MIN_MINUTES;
}
export async function setProcessMinMinutes(body: unknown): Promise<number> {
  const raw = (body as any)?.minutes;
  const x = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (raw === "" || raw == null || !Number.isInteger(x) || x < 0 || x > 60) throw new CreditsError(400, "bad_minimum", "The minimum must be a whole number of minutes from 0 to 60.");
  await getDb().execute({
    sql: "INSERT INTO credit_settings (id, value) VALUES ('process_min_minutes', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    args: [String(x)],
  });
  return x;
}

/** vm_charge: turn charging on or off. Holds already open are settled or released as usual either way. */
export async function setCharging(body: unknown): Promise<CreditSettings> {
  const on = (body as any)?.on;
  if (typeof on !== "boolean") throw new CreditsError(400, "bad_value", "Send on: true or on: false.");
  await getDb().execute({
    sql: "INSERT INTO credit_settings (id, value) VALUES ('charging', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    args: [on ? "on" : "off"],
  });
  return getCreditSettings();
}

/** Change the welcome amount. */
export async function setWelcome(body: unknown): Promise<CreditSettings> {
  const b = (body ?? {}) as Record<string, unknown>;
  const micros = dollarsToMicros(b.welcomeUsd, "The welcome amount", 100);
  await getDb().execute({
    sql: "INSERT INTO credit_settings (id, value) VALUES ('welcome_micros', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    args: [String(micros)],
  });
  return getCreditSettings();
}

/**
 * The welcome amount, once per wallet, the first time its credits are
 * looked at. The key makes a second time impossible, also after the
 * wallet's data was deleted: the ledger is kept as a record of money.
 */
export async function ensureWelcome(wallet: string): Promise<void> {
  const { welcomeMicros } = await getCreditSettings();
  if (welcomeMicros <= 0) return;
  await getDb().execute({
    sql: `INSERT INTO credit_entries (id, wallet, at, kind, amount_micros, idempotency_key)
          VALUES (?, ?, ?, 'welcome', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
    args: [crypto.randomUUID(), wallet, Date.now(), welcomeMicros, `welcome:${wallet}`],
  });
}

// ── balances ─────────────────────────────────────────────────────────────────
const BALANCE_SQL = "(SELECT COALESCE(SUM(amount_micros), 0) FROM credit_entries WHERE wallet = ?)";
const HELD_SQL = "(SELECT COALESCE(SUM(amount_micros), 0) FROM credit_holds WHERE wallet = ? AND status = 'held' AND expires_at > ?)";

export interface Balance { balanceMicros: number; heldMicros: number; availableMicros: number }

export async function balanceOf(walletIn: string, now = Date.now()): Promise<Balance> {
  const wallet = walletOf(walletIn);
  const r = await getDb().execute({ sql: `SELECT ${BALANCE_SQL} AS b, ${HELD_SQL} AS h`, args: [wallet, wallet, now] });
  const row = r.rows[0] as any;
  const balanceMicros = n(row.b), heldMicros = n(row.h);
  return { balanceMicros, heldMicros, availableMicros: balanceMicros - heldMicros };
}

const ENTRY_SELECT = `SELECT e.*, EXISTS (SELECT 1 FROM credit_entries r WHERE r.refund_of = e.id) AS refunded FROM credit_entries e`;

export async function entriesOf(walletIn: string, limit = 30): Promise<Entry[]> {
  const wallet = walletOf(walletIn);
  const r = await getDb().execute({
    sql: `${ENTRY_SELECT} WHERE e.wallet = ? ORDER BY e.at DESC, e.id DESC LIMIT ?`,
    args: [wallet, Math.max(1, Math.min(200, Math.floor(limit)))],
  });
  return (r.rows as any[]).map(rowToEntry);
}

/** What the Wallet page shows: the balance, what is set aside, the recent rows and the prices. */
export async function myCredits(walletIn: string) {
  const wallet = walletOf(walletIn);
  await ensureWelcome(wallet);
  const [balance, entries, settings, prices] = await Promise.all([balanceOf(wallet), entriesOf(wallet, 30), getCreditSettings(), listActionPrices()]);
  // Admin emails and notes are for the dashboard, not the wallet page.
  const shown = entries.map((e) => ({ id: e.id, at: e.at, kind: e.kind, amountMicros: e.amountMicros, action: e.action, quantity: e.quantity, videoId: e.videoId, refunded: e.refunded, txHash: e.kind === "topup" ? e.ref : null }));
  return { wallet, ...balance, charging: settings.charging, entries: shown, prices: prices.map(publicPrice) };
}

// ── prices ───────────────────────────────────────────────────────────────────
// vm_priceshapes: answer_step is one answer for every 30 minutes of the video (Part 20b)
export type PriceUnit = "minute" | "answer" | "search" | "generation" | "gb_month" | "second" | "answer_step";
export interface ActionPrice { id: string; label: string; unit: PriceUnit; microsPerUnit: number; position: number; updatedAt: number; updatedBy: string | null }
const rowToActionPrice = (r: any): ActionPrice => ({
  id: String(r.id), label: String(r.label), unit: String(r.unit) as PriceUnit, microsPerUnit: n(r.micros_per_unit),
  position: n(r.position), updatedAt: n(r.updated_at), updatedBy: s(r.updated_by),
});
export const publicPrice = (p: ActionPrice) => ({ id: p.id, unit: p.unit, microsPerUnit: p.microsPerUnit });

export async function listActionPrices(): Promise<ActionPrice[]> {
  const r = await getDb().execute("SELECT * FROM action_prices ORDER BY position, id");
  return (r.rows as any[]).map(rowToActionPrice);
}

export async function updateActionPrice(id: string, body: unknown, adminEmail: string): Promise<ActionPrice> {
  const b = (body ?? {}) as Record<string, unknown>;
  const micros = dollarsToMicros(b.usd, "The price", 1_000);
  const r = await getDb().execute({
    sql: "UPDATE action_prices SET micros_per_unit = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    args: [micros, Date.now(), adminEmail, id],
  });
  if (r.rowsAffected === 0) throw new CreditsError(404, "not_found", "No price with that id.");
  return rowToActionPrice((await getDb().execute({ sql: "SELECT * FROM action_prices WHERE id = ?", args: [id] })).rows[0]);
}

/** vm_charge: what one unit of an action costs right now: 0 while charging is off. */
export async function currentPrice(action: string): Promise<number> {
  const [settings, prices] = await Promise.all([getCreditSettings(), listActionPrices()]);
  return settings.charging ? (prices.find((p) => p.id === action)?.microsPerUnit ?? 0) : 0;
}

/** The price of a quantity of an action, rounded up to a whole micro dollar. */
export const priceFor = (microsPerUnit: number, quantity: number) => Math.ceil(Math.max(0, microsPerUnit) * Math.max(0, quantity));

// ── admin changes ────────────────────────────────────────────────────────────
async function entryById(id: string): Promise<Entry> {
  const r = await getDb().execute({ sql: `${ENTRY_SELECT} WHERE e.id = ?`, args: [id] });
  if (!r.rows.length) throw new CreditsError(404, "not_found", "No entry with that id.");
  return rowToEntry(r.rows[0]);
}

/** Free credits from an admin. */
export async function grantCredits(body: unknown, adminEmail: string): Promise<Entry> {
  const b = (body ?? {}) as Record<string, unknown>;
  const wallet = walletOf(b.wallet);
  const micros = dollarsToMicros(b.usd, "The amount");
  if (micros <= 0) throw new CreditsError(400, "bad_amount", "Give an amount above 0.");
  const id = crypto.randomUUID();
  await getDb().execute({
    sql: `INSERT INTO credit_entries (id, wallet, at, kind, amount_micros, note, admin_email) VALUES (?, ?, ?, 'grant', ?, ?, ?)`,
    args: [id, wallet, Date.now(), micros, note(b.note), adminEmail],
  });
  return entryById(id);
}

/** Credits an admin takes back, for example a grant made by mistake. Never more than the wallet has free. */
export async function removeCredits(body: unknown, adminEmail: string, now = Date.now()): Promise<Entry> {
  const b = (body ?? {}) as Record<string, unknown>;
  const wallet = walletOf(b.wallet);
  const micros = dollarsToMicros(b.usd, "The amount");
  if (micros <= 0) throw new CreditsError(400, "bad_amount", "Give an amount above 0.");
  const id = crypto.randomUUID();
  const r = await getDb().execute({
    sql: `INSERT INTO credit_entries (id, wallet, at, kind, amount_micros, note, admin_email)
          SELECT ?, ?, ?, 'remove', ?, ?, ? WHERE ${BALANCE_SQL} - ${HELD_SQL} >= ?`,
    args: [id, wallet, now, -micros, note(b.note), adminEmail, wallet, wallet, now, micros],
  });
  if (r.rowsAffected === 0) throw new CreditsError(409, "not_enough", "The wallet does not have that much free. Remove less, or wait for its open holds to finish.");
  return entryById(id);
}

/** Give a charge back, in full, once. */
export async function refundCharge(entryId: string, body: unknown, adminEmail: string): Promise<Entry> {
  const b = (body ?? {}) as Record<string, unknown>;
  const charge = await entryById(entryId);
  if (charge.kind !== "charge") throw new CreditsError(400, "not_a_charge", "Only a charge can be refunded.");
  const id = crypto.randomUUID();
  const r = await getDb().execute({
    sql: `INSERT INTO credit_entries (id, wallet, at, kind, amount_micros, action, quantity, video_id, refund_of, note, admin_email, idempotency_key)
          SELECT ?, wallet, ?, 'refund', -amount_micros, action, quantity, video_id, id, ?, ?, 'refund:' || id
            FROM credit_entries WHERE id = ? AND kind = 'charge'
          ON CONFLICT(idempotency_key) DO NOTHING`,
    args: [id, Date.now(), note(b.note), adminEmail, entryId],
  });
  if (r.rowsAffected === 0) throw new CreditsError(409, "already_refunded", "That charge was refunded already.");
  return entryById(id);
}

// ── holds: reserve, settle, release ──────────────────────────────────────────
const DEFAULT_HOLD_MS = 6 * 3600_000;
const MAX_HOLD_MS = 7 * 24 * 3600_000;

export interface ReserveArgs {
  wallet: string; action: string; quantity: number;
  videoId?: string | null; jobId?: string | null;
  /** The same key a second time gives back the first hold, so a retried request never holds twice. */
  key?: string | null;
  /** How long the hold may stay open. 6 hours unless said, at most 7 days. */
  ttlMs?: number;
  now?: number;
}
export type Reservation = { free: true; amountMicros: 0 } | { free: false; hold: Hold; amountMicros: number };

/**
 * Set the price of an action aside. Free when charging is off or the price
 * is 0. Throws CreditsError 402 not_enough_credits when the wallet does not
 * have the amount free. One statement checks and holds, so two requests
 * at the same moment cannot both spend the same money.
 */
export async function reserve(a: ReserveArgs): Promise<Reservation> {
  const wallet = walletOf(a.wallet);
  const quantity = Number(a.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) throw new CreditsError(400, "bad_quantity", "The quantity must be 0 or more.");
  const [settings, price] = await Promise.all([
    getCreditSettings(),
    getDb().execute({ sql: "SELECT * FROM action_prices WHERE id = ?", args: [a.action] }).then((r) => (r.rows[0] ? rowToActionPrice(r.rows[0]) : null)),
  ]);
  if (!price) throw new CreditsError(400, "unknown_action", `No price for the action ${a.action}.`);
  const amount = priceFor(price.microsPerUnit, quantity);
  if (!settings.charging || amount === 0) return { free: true, amountMicros: 0 };

  await ensureWelcome(wallet);
  const now = a.now ?? Date.now();
  const ttl = Math.max(60_000, Math.min(MAX_HOLD_MS, Math.floor(a.ttlMs ?? DEFAULT_HOLD_MS)));
  const id = crypto.randomUUID();
  const key = a.key ? String(a.key).slice(0, 200) : null;
  const r = await getDb().execute({
    sql: `INSERT INTO credit_holds (id, wallet, action, quantity, amount_micros, unit_micros, status, video_id, job_id, created_at, expires_at, idempotency_key)
          SELECT ?, ?, ?, ?, ?, ?, 'held', ?, ?, ?, ?, ? WHERE ${BALANCE_SQL} - ${HELD_SQL} >= ?
          ON CONFLICT(idempotency_key) DO NOTHING`,
    args: [id, wallet, price.id, quantity, amount, price.microsPerUnit, a.videoId ?? null, a.jobId ?? null, now, now + ttl, key,
      wallet, wallet, now, amount],
  });
  if (r.rowsAffected === 0) {
    if (key) {
      const prev = await getDb().execute({ sql: "SELECT * FROM credit_holds WHERE idempotency_key = ?", args: [key] });
      if (prev.rows.length) { const h = rowToHold(prev.rows[0]); return { free: false, hold: h, amountMicros: h.amountMicros }; }
    }
    throw new CreditsError(402, "not_enough_credits", "Not enough credits for this. Add credits on the Wallet page and try again.");
  }
  return { free: false, hold: await holdById(id), amountMicros: amount };
}

export async function holdById(id: string): Promise<Hold> {
  const r = await getDb().execute({ sql: "SELECT * FROM credit_holds WHERE id = ?", args: [id] });
  if (!r.rows.length) throw new CreditsError(404, "not_found", "No hold with that id.");
  return rowToHold(r.rows[0]);
}

/**
 * The action is done: charge it. With the quantity really used (minutes
 * transcribed, say) the charge is that quantity at the held price, and
 * never more than was held. Settling twice charges once. A hold that
 * expired is not charged. Answers the micro dollars charged.
 */
export async function settle(holdId: string | null | undefined, used?: { quantity?: number }, now = Date.now()): Promise<number> {
  if (!holdId) return 0;
  const h = await holdById(holdId);
  if (h.status !== "held") return h.status === "settled" ? n(h.chargedMicros) : 0;
  if (h.expiresAt <= now) {
    await getDb().execute({ sql: "UPDATE credit_holds SET status = 'expired', closed_at = ? WHERE id = ? AND status = 'held'", args: [now, holdId] });
    console.warn(`[credits] hold ${holdId} expired before it was settled; nothing charged`);
    return 0;
  }
  const q = used?.quantity;
  const charge = q == null || !Number.isFinite(q) ? h.amountMicros : Math.min(h.amountMicros, priceFor(h.unitMicros, q));
  const res = await getDb().batch([
    {
      sql: `INSERT INTO credit_entries (id, wallet, at, kind, amount_micros, action, quantity, video_id, hold_id, idempotency_key)
            SELECT ?, wallet, ?, 'charge', ?, action, ?, video_id, id, 'settle:' || id
              FROM credit_holds WHERE id = ? AND status = 'held' AND ? > 0
            ON CONFLICT(idempotency_key) DO NOTHING`,
      args: [crypto.randomUUID(), now, -charge, q ?? h.quantity, holdId, charge],
    },
    { sql: "UPDATE credit_holds SET status = 'settled', closed_at = ?, charged_micros = ? WHERE id = ? AND status = 'held'", args: [now, charge, holdId] },
  ], "write");
  if (res[1].rowsAffected === 0) return n((await holdById(holdId)).chargedMicros);
  return charge;
}

/** The action failed or was cancelled: nothing is charged. Releasing twice, or after settling, changes nothing. */
export async function release(holdId: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!holdId) return false;
  const r = await getDb().execute({ sql: "UPDATE credit_holds SET status = 'released', closed_at = ? WHERE id = ? AND status = 'held'", args: [now, holdId] });
  return r.rowsAffected > 0;
}

/** Holds past their time are marked expired (they already stopped counting). Run by the hourly housekeeping. */
export async function expireHolds(now = Date.now()): Promise<number> {
  const r = await getDb().execute({ sql: "UPDATE credit_holds SET status = 'expired', closed_at = ? WHERE status = 'held' AND expires_at <= ?", args: [now, now] });
  return r.rowsAffected;
}

// ── the dashboard ────────────────────────────────────────────────────────────
export async function adminLedger(q: Record<string, unknown>) {
  const where: string[] = []; const args: any[] = [];
  if (q.wallet) { where.push("e.wallet = ?"); args.push(walletOf(q.wallet)); }
  if (typeof q.kind === "string" && (ENTRY_KINDS as string[]).includes(q.kind)) { where.push("e.kind = ?"); args.push(q.kind); }
  // The cursor is "<at>_<id>" of the last row shown, so rows written in the same millisecond are not skipped.
  const m = typeof q.before === "string" ? /^(\d+)_([0-9a-f-]{36})$/.exec(q.before) : null;
  if (m) { where.push("(e.at < ? OR (e.at = ? AND e.id < ?))"); args.push(Number(m[1]), Number(m[1]), m[2]); }
  const limit = Math.max(1, Math.min(100, Math.floor(Number(q.limit) || 50)));
  const r = await getDb().execute({
    sql: `${ENTRY_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY e.at DESC, e.id DESC LIMIT ?`,
    args: [...args, limit + 1],
  });
  const rows = (r.rows as any[]).map(rowToEntry);
  const more = rows.length > limit;
  const entries = rows.slice(0, limit);
  const last = entries[entries.length - 1];
  return { entries, next: more ? `${last.at}_${last.id}` : null };
}

/** Totals over every wallet. */
export async function creditsTotals(now = Date.now()) {
  const db = getDb();
  const [kinds, holds, wallets] = await Promise.all([
    db.execute("SELECT kind, COALESCE(SUM(amount_micros), 0) AS m, COUNT(*) AS c FROM credit_entries GROUP BY kind"),
    db.execute({ sql: "SELECT COUNT(*) AS c, COALESCE(SUM(amount_micros), 0) AS m FROM credit_holds WHERE status = 'held' AND expires_at > ?", args: [now] }),
    db.execute("SELECT COUNT(*) AS c FROM (SELECT wallet FROM credit_entries GROUP BY wallet HAVING SUM(amount_micros) > 0)"),
  ]);
  const byKind: Record<string, { micros: number; count: number }> = {};
  for (const k of ENTRY_KINDS) byKind[k] = { micros: 0, count: 0 };
  for (const r of kinds.rows as any[]) byKind[String(r.kind)] = { micros: n(r.m), count: n(r.c) };
  const outstanding = Object.values(byKind).reduce((a, k) => a + k.micros, 0);
  const h = holds.rows[0] as any;
  return { byKind, outstandingMicros: outstanding, openHolds: { count: n(h.c), micros: n(h.m) }, walletsWithCredits: n((wallets.rows[0] as any).c) };
}

/** Which usage features each action stands for, and how its units are counted, for the cost per unit. */
const COST_BASIS: Record<string, { features: string[]; count: { feature: string; metric: string; as: "rows" | "minutes" | "quantity" } }> = {
  process_video: { features: ["transcribe", "analyze", "embed"], count: { feature: "transcribe", metric: "audio_seconds", as: "minutes" } },
  // vm_priceshapes: answers are counted in steps of 30 minutes of the video (from the answers below)
  ask: { features: ["ask"], count: { feature: "ask", metric: "answer_steps", as: "quantity" } },
  search: { features: ["search"], count: { feature: "search", metric: "input_tokens", as: "rows" } },
  learn_paths: { features: ["learn_paths"], count: { feature: "learn_paths", metric: "output_tokens", as: "rows" } },
  learn_ask: { features: ["learn_ask"], count: { feature: "learn_ask", metric: "output_tokens", as: "rows" } },
  live_captions: { features: ["live_captions"], count: { feature: "live_captions", metric: "audio_seconds", as: "minutes" } },
  // vm_translate: Claude's tokens for translating, per minute of video translated (counted from the translations below)
  translate: { features: ["translate"], count: { feature: "translate", metric: "minutes_translated", as: "minutes" } },
  // vm_priceshapes: "Let AI write it", one per answer
  generate_direct: { features: ["generate_direct"], count: { feature: "generate_direct", metric: "output_tokens", as: "rows" } },
};

export interface UnitCost { action: string; units: number; costUsd: number; perUnitUsd: number | null }

/**
 * What one unit of each action cost VideoMind in the last 30 days, from the
 * usage ledger and the provider prices on the Costs page. Standard prices
 * only (no long prompt prices), so it is an estimate.
 */
export async function unitCosts(days = 30, now = Date.now()): Promise<UnitCost[]> {
  const since = now - days * 86400_000;
  const features = [...new Set(Object.values(COST_BASIS).flatMap((b) => b.features))];
  const [rows, prices] = await Promise.all([
    getDb().execute({
      sql: `SELECT feature, metric, provider, model, SUM(quantity) AS q, COUNT(*) AS c FROM usage_ledger
             WHERE created_at >= ? AND feature IN (${features.map(() => "?").join(",")})
             GROUP BY feature, metric, provider, model`,
      args: [since, ...features],
    }),
    listPrices(),
  ]);
  const costByFeature = new Map<string, number>();
  const counted = new Map<string, { q: number; c: number }>();
  for (const r of rows.rows as any[]) {
    const feature = String(r.feature), metric = String(r.metric), provider = String(r.provider ?? ""), model = s(r.model);
    const k = `${feature}|${metric}`;
    const prev = counted.get(k) ?? { q: 0, c: 0 };
    counted.set(k, { q: prev.q + n(r.q), c: prev.c + n(r.c) });
    const p = prices.find((x) => x.provider === provider && x.metric === metric && modelMatches(model, x.model));
    if (p) costByFeature.set(feature, (costByFeature.get(feature) ?? 0) + quantityIn(p.unit, n(r.q)) * p.usd);
  }
  const out: UnitCost[] = [];
  // vm_translate: the ledger has the tokens, the translations have the minutes
  counted.set("translate|minutes_translated", { q: (await minutesTranslated(since)) * 60, c: 0 });
  // vm_priceshapes: each answer counts one step per 30 minutes of its video (at least one)
  const steps = await getDb().execute({
    sql: `SELECT COALESCE(SUM(MAX(1, CAST((COALESCE(v.duration_sec, 0) + 1799) / 1800 AS INTEGER))), 0) AS s
            FROM usage_ledger u LEFT JOIN videos v ON v.id = u.video_id
           WHERE u.created_at >= ? AND u.feature = 'ask' AND u.metric = 'output_tokens'`,
    args: [since],
  });
  counted.set("ask|answer_steps", { q: n((steps.rows[0] as any).s), c: 0 });
  for (const [action, b] of Object.entries(COST_BASIS)) {
    const c = counted.get(`${b.count.feature}|${b.count.metric}`) ?? { q: 0, c: 0 };
    const units = b.count.as === "minutes" ? c.q / 60 : b.count.as === "quantity" ? c.q : c.c;
    const costUsd = b.features.reduce((a, f) => a + (costByFeature.get(f) ?? 0), 0);
    out.push({ action, units, costUsd, perUnitUsd: units > 0 ? costUsd / units : null });
  }
  // Storage: the R2 price per GB month (the free amount is VideoMind's, not shared out).
  const r2 = prices.find((x) => x.metric === "gb_month");
  out.push({ action: "storage", units: 0, costUsd: 0, perUnitUsd: r2 ? r2.usd : null });
  return out;
}

export async function creditsOverview() {
  const [settings, prices, costs, totals] = await Promise.all([getCreditSettings(), listActionPrices(), unitCosts(), creditsTotals()]);
  return { settings, prices, costs, totals };
}

/** One wallet, for its page in the dashboard. */
export async function walletCredits(walletIn: string) {
  const wallet = walletOf(walletIn);
  const [balance, entries] = await Promise.all([balanceOf(wallet), entriesOf(wallet, 10)]);
  return { wallet, ...balance, entries };
}
