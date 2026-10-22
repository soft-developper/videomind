// src/lib/pricing.ts
// vm_pricing: suggested prices (Part 20a, plan in claude/pricing-plan.md).
//
// For each paid action the dashboard shows what one unit costs VideoMind,
// the platform fee, the suggested price (cost plus fee) and the price users
// pay now. Nothing changes for users until an admin applies a suggestion.
//
// Where the cost of one unit comes from, best first:
//   exact      the provider's own price for exactly this unit (live
//              captions per minute, storage per GB month, generation per
//              second at the dearest model that is switched on)
//   measured   the last 30 days of the usage ledger, once an action has
//              been used enough (MIN_UNITS) for an average to mean something
//   estimate   a starting estimate per action (action_cost_estimates),
//              written from the provider prices on 22 Oct 2026 and editable
//
// The platform fee is a setting in basis points (30 = 0.3%) added to the
// cost of every charge. Prices are whole micro dollars, so a suggestion is
// rounded up and is never below cost.
import { getDb } from "./db.js";
import { getCreditSettings, listActionPrices, unitCosts, MICROS, CreditsError, type ActionPrice, type PriceUnit } from "./credits.js";
import { listPrices, listFixed } from "./costs.js";
import { generationUnitCost, listModels } from "./generation.js";

const n = (v: unknown) => Number(v ?? 0) || 0;
const DAY = 86400_000;

/** How many units an action needs in 30 days before its measured average is used. */
// viewer_minute: LiveKit is not in the usage ledger, so live keeps its estimate
const MIN_UNITS: Record<PriceUnit, number> = { minute: 60, answer: 20, search: 20, generation: 10, second: 60, gb_month: Infinity, answer_step: 20, viewer_minute: Infinity };

// ── the platform fee ─────────────────────────────────────────────────────────
export const DEFAULT_FEE_BPS = 30;
const MAX_FEE_BPS = 5000;   // 50%

export async function getFeeBps(): Promise<number> {
  const r = await getDb().execute("SELECT value FROM credit_settings WHERE id = 'platform_fee_bps'");
  const v = r.rows[0] ? Number((r.rows[0] as any).value) : DEFAULT_FEE_BPS;
  return Number.isFinite(v) && v >= 0 ? Math.min(MAX_FEE_BPS, Math.round(v)) : DEFAULT_FEE_BPS;
}

/** Set the fee from a percentage as typed in the dashboard ("0.3", 0.3). Two decimals at most. */
export async function setFeePercent(body: unknown): Promise<number> {
  const raw = (body as any)?.percent;
  const x = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (raw === "" || raw == null || !Number.isFinite(x) || x < 0 || x > MAX_FEE_BPS / 100) {
    throw new CreditsError(400, "bad_fee", `The platform fee must be a percentage from 0 to ${MAX_FEE_BPS / 100}.`);
  }
  const bps = Math.round(x * 100);
  if (Math.abs(bps - x * 100) > 1e-6) throw new CreditsError(400, "bad_fee", "Write the platform fee with at most two decimals, for example 0.3 or 1.25.");
  await getDb().execute({
    sql: "INSERT INTO credit_settings (id, value) VALUES ('platform_fee_bps', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    args: [String(bps)],
  });
  return bps;
}

/** The price for a cost per unit, with the fee, rounded up to a whole micro dollar. */
export const withFee = (costUsd: number, feeBps: number) => Math.ceil(Math.max(0, costUsd) * (1 + feeBps / 10_000) * MICROS - 1e-9);
/** A cost per unit in whole micro dollars, rounded up. */
export const costMicros = (costUsd: number) => Math.ceil(Math.max(0, costUsd) * MICROS - 1e-9);

// ── starting estimates ───────────────────────────────────────────────────────
export interface Estimate { id: string; usdPerUnit: number; note: string | null; updatedAt: number; updatedBy: string | null }

export async function listEstimates(): Promise<Estimate[]> {
  const r = await getDb().execute("SELECT * FROM action_cost_estimates ORDER BY id");
  return (r.rows as any[]).map((x) => ({ id: String(x.id), usdPerUnit: n(x.usd_per_unit), note: x.note == null ? null : String(x.note), updatedAt: n(x.updated_at), updatedBy: x.updated_by == null ? null : String(x.updated_by) }));
}

export async function updateEstimate(id: string, body: unknown, adminEmail: string): Promise<Estimate> {
  const raw = (body as any)?.usd;
  const x = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
  if (raw === "" || raw == null || !Number.isFinite(x) || x < 0 || x > 1000) throw new CreditsError(400, "bad_estimate", "The estimate must be a number of US dollars, 0 or more.");
  const r = await getDb().execute({ sql: "UPDATE action_cost_estimates SET usd_per_unit = ?, updated_at = ?, updated_by = ? WHERE id = ?", args: [x, Date.now(), adminEmail, id] });
  if (r.rowsAffected === 0) throw new CreditsError(404, "not_found", "No estimate for that action.");
  return (await listEstimates()).find((e) => e.id === id)!;
}

// ── the cost of one unit ─────────────────────────────────────────────────────
export type CostSource = "exact" | "measured" | "estimate" | "none";
export interface CostBasis { action: string; usdPerUnit: number | null; source: CostSource; units30: number; note: string | null }

/** What one unit of every priced action costs VideoMind now, and where that figure comes from. */
export async function costBasis(now = Date.now()): Promise<CostBasis[]> {
  const [prices, estimates, measured, gen, providerPrices, models] = await Promise.all([
    listActionPrices(), listEstimates(), unitCosts(30, now), generationUnitCost(now), listPrices(), listModels(),
  ]);
  const byAction = new Map([...measured, gen].map((m) => [m.action, m]));
  const providerUsd = (id: string) => providerPrices.find((p) => p.id === id)?.usd ?? null;
  const dearestModel = models.filter((m) => m.enabled).reduce<number | null>((a, m) => (a == null || m.costUsdPerSecond > a ? m.costUsdPerSecond : a), null);

  return prices.map((p) => {
    const m = byAction.get(p.id);
    const est = estimates.find((e) => e.id === p.id);
    const units30 = m?.units ?? 0;
    // Exact: the provider bills exactly this unit.
    if (p.id === "live_captions") {
      const usd = providerUsd("openai-live-transcribe");
      if (usd != null) return { action: p.id, usdPerUnit: usd, source: "exact", units30, note: "OpenAI gpt-live-transcribe per minute" };
    }
    if (p.id === "storage") {
      const usd = providerUsd("cloudflare-r2-storage");
      if (usd != null) return { action: p.id, usdPerUnit: usd, source: "exact", units30, note: "Cloudflare R2 per GB month (VideoMind keeps the free 10 GB)" };
    }
    if (p.id === "generate_video" && dearestModel != null) {
      // One price covers every model, so it is set by the dearest one switched on.
      return { action: p.id, usdPerUnit: dearestModel, source: "exact", units30, note: "the dearest generation model switched on, per second" };
    }
    // Measured, once there is enough use.
    if (m && m.perUnitUsd != null && units30 >= (MIN_UNITS[p.unit] ?? Infinity)) {
      return { action: p.id, usdPerUnit: m.perUnitUsd, source: "measured", units30, note: "average of the last 30 days" };
    }
    if (est) return { action: p.id, usdPerUnit: est.usdPerUnit, source: "estimate", units30, note: est.note };
    return { action: p.id, usdPerUnit: null, source: "none", units30, note: null };
  });
}

// ── this month ───────────────────────────────────────────────────────────────
export function monthStart(now = Date.now()): number {
  const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Units of each action used since the start of the month (also when it was free). */
async function unitsThisMonth(now: number): Promise<Map<string, number>> {
  const m0 = monthStart(now);
  const days = Math.max(1 / 24, (now - m0) / DAY);
  const [usage, gen, storage, live] = await Promise.all([
    unitCosts(days, now),
    getDb().execute({ sql: "SELECT COALESCE(SUM(seconds), 0) AS s FROM generations WHERE status = 'succeeded' AND created_at >= ?", args: [m0] }),
    getDb().execute({ sql: "SELECT COALESCE(SUM(gb_months), 0) AS g FROM storage_days WHERE day >= ?", args: [new Date(m0).toISOString().slice(0, 10)] }),
    // vm_liveviewers: viewer minutes counted (events from before 20c count their minutes run)
    getDb().execute({ sql: `SELECT COALESCE(SUM(CASE WHEN viewer_limit IS NOT NULL THEN COALESCE(viewer_seconds, 0) / 60.0
              ELSE (MIN(COALESCE(ended_at, ?), COALESCE(ends_at, ?)) - started_at) / 60000.0 END), 0) AS m
            FROM live_events WHERE started_at IS NOT NULL AND started_at >= ?`, args: [now, now, m0] }),
  ]);
  const out = new Map(usage.map((u) => [u.action, u.units]));
  out.set("generate_video", n((gen.rows[0] as any).s));
  out.set("storage", n((storage.rows[0] as any).g));
  out.set("live", Math.max(0, n((live.rows[0] as any).m)));
  return out;
}

/** What users were charged per action since the start of the month, refunds taken off, in micro dollars. */
async function chargedThisMonth(now: number): Promise<Map<string, number>> {
  const r = await getDb().execute({
    sql: "SELECT action, COALESCE(SUM(amount_micros), 0) AS m FROM credit_entries WHERE kind IN ('charge', 'refund') AND action IS NOT NULL AND at >= ? GROUP BY action",
    args: [monthStart(now)],
  });
  return new Map((r.rows as any[]).map((x) => [String(x.action), Math.max(0, -n(x.m))]));
}

// ── the rows on the Credits page ─────────────────────────────────────────────
export interface PricingRow {
  action: string; unit: PriceUnit; priceMicros: number;
  costUsd: number | null; costSource: CostSource; costNote: string | null; units30: number;
  suggestedMicros: number | null;
  /** The price is below what one unit costs (only a loss while charging is on, or the action is free). */
  belowCost: boolean;
  unitsMonth: number; chargedMonthMicros: number; costMonthMicros: number;
}

export interface PricingReport {
  feeBps: number; charging: boolean; month: string;
  rows: PricingRow[];
  /** Since the start of the month, across every action. */
  totals: { chargedMicros: number; costMicros: number; marginMicros: number; feeMicros: number; fixedMonthMicros: number; lossMicros: number };
  belowCost: string[];
}

export async function pricingReport(now = Date.now()): Promise<PricingReport> {
  const [settings, feeBps, prices, basis, units, charged, fixed] = await Promise.all([
    getCreditSettings(), getFeeBps(), listActionPrices(), costBasis(now), unitsThisMonth(now), chargedThisMonth(now), listFixed(),
  ]);
  const rows: PricingRow[] = prices.map((p: ActionPrice) => {
    const b = basis.find((x) => x.action === p.id)!;
    const cost = b.usdPerUnit;
    const unitsMonth = units.get(p.id) ?? 0;
    const chargedMonthMicros = charged.get(p.id) ?? 0;
    return {
      action: p.id, unit: p.unit, priceMicros: p.microsPerUnit,
      costUsd: cost, costSource: b.source, costNote: b.note, units30: b.units30,
      suggestedMicros: cost == null ? null : withFee(cost, feeBps),
      belowCost: cost != null && cost > 0 && p.microsPerUnit < costMicros(cost),
      unitsMonth, chargedMonthMicros,
      costMonthMicros: cost == null ? 0 : Math.round(cost * unitsMonth * MICROS),
    };
  });
  const chargedMicros = rows.reduce((a, r) => a + r.chargedMonthMicros, 0);
  const costMicros_ = rows.reduce((a, r) => a + r.costMonthMicros, 0);
  // With charging off every action is free: everything it cost is a loss.
  const lossMicros = rows.reduce((a, r) => a + Math.max(0, r.costMonthMicros - r.chargedMonthMicros), 0);
  return {
    feeBps, charging: settings.charging, month: new Date(monthStart(now)).toISOString().slice(0, 7),
    rows,
    totals: {
      chargedMicros, costMicros: costMicros_, marginMicros: chargedMicros - costMicros_,
      // The part of what was charged that is the platform fee, if prices are at their suggestions.
      feeMicros: Math.round(chargedMicros * feeBps / (10_000 + feeBps)),
      fixedMonthMicros: Math.round(fixed.reduce((a, f) => a + f.usdPerMonth, 0) * MICROS),
      lossMicros,
    },
    belowCost: rows.filter((r) => r.belowCost).map((r) => r.action),
  };
}

// ── applying suggestions ─────────────────────────────────────────────────────
/** Set an action's price to its suggestion. Answers the old and new price. */
export async function applySuggestion(id: string, adminEmail: string, now = Date.now()): Promise<{ id: string; fromMicros: number; toMicros: number }> {
  const [feeBps, basis, prices] = await Promise.all([getFeeBps(), costBasis(now), listActionPrices()]);
  const p = prices.find((x) => x.id === id);
  if (!p) throw new CreditsError(404, "not_found", "No price with that id.");
  const b = basis.find((x) => x.action === id);
  if (!b || b.usdPerUnit == null) throw new CreditsError(409, "no_cost", "There is no cost for this action yet, so there is nothing to suggest. Add an estimate first.");
  const to = withFee(b.usdPerUnit, feeBps);
  await getDb().execute({ sql: "UPDATE action_prices SET micros_per_unit = ?, updated_at = ?, updated_by = ? WHERE id = ?", args: [to, now, adminEmail, id] });
  return { id, fromMicros: p.microsPerUnit, toMicros: to };
}

/** Apply every suggestion that differs from the price now. */
export async function applyAllSuggestions(adminEmail: string, now = Date.now()) {
  const report = await pricingReport(now);
  const changed: Array<{ id: string; fromMicros: number; toMicros: number }> = [];
  for (const r of report.rows) {
    if (r.suggestedMicros == null || r.suggestedMicros === r.priceMicros) continue;
    changed.push(await applySuggestion(r.action, adminEmail, now));
  }
  return changed;
}
