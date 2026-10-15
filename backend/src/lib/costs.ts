// src/lib/costs.ts
// vm_costs: estimated costs, from the quantities in the usage ledger and
// the prices in model_prices (seeded by migration 022 from each provider's
// official pricing page on 15 Oct 2026, editable in the dashboard). These
// are estimates; the providers' invoices are the real figures. Not counted:
// LiveKit, R2 operations, Resend and hosting, which admins can add as fixed
// monthly costs.
import crypto from "crypto";
import { getDb } from "./db.js";
import { namesOf } from "./profiles.js";
import { normalizeWallet } from "./auth.js";

const n = (v: unknown) => Number(v ?? 0) || 0;
const GB = 1e9;

export class CostsError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface Price {
  id: string; provider: string; model: string; metric: string; unit: "minute" | "million_tokens" | "gb_month";
  usd: number; longPromptTokens: number | null; longUsd: number | null; freePerMonth: number;
  source: string | null; checkedOn: string | null; updatedAt: number; updatedBy: string | null;
}
const rowToPrice = (r: any): Price => ({
  id: String(r.id), provider: String(r.provider), model: String(r.model), metric: String(r.metric), unit: String(r.unit) as Price["unit"],
  usd: n(r.usd_per_unit), longPromptTokens: r.long_prompt_tokens == null ? null : n(r.long_prompt_tokens), longUsd: r.long_usd_per_unit == null ? null : n(r.long_usd_per_unit),
  freePerMonth: n(r.free_per_month), source: r.source_url == null ? null : String(r.source_url), checkedOn: r.checked_on == null ? null : String(r.checked_on),
  updatedAt: n(r.updated_at), updatedBy: r.updated_by == null ? null : String(r.updated_by),
});

export async function listPrices(): Promise<Price[]> {
  const r = await getDb().execute("SELECT * FROM model_prices ORDER BY provider, model, metric");
  return (r.rows as any[]).map(rowToPrice);
}
export async function updatePrice(id: string, body: unknown, adminEmail: string): Promise<Price> {
  const b = (body ?? {}) as Record<string, unknown>;
  const num = (v: unknown, what: string) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0 || x > 1_000_000) throw new CostsError(400, "bad_price", `${what} must be a number of US dollars, 0 or more.`);
    return x;
  };
  const sets: string[] = []; const args: any[] = [];
  if ("usd" in b) { sets.push("usd_per_unit = ?"); args.push(num(b.usd, "The price")); }
  if ("longUsd" in b) { sets.push("long_usd_per_unit = ?"); args.push(b.longUsd === null || b.longUsd === "" ? null : num(b.longUsd, "The long prompt price")); }
  if ("freePerMonth" in b) { sets.push("free_per_month = ?"); args.push(num(b.freePerMonth, "The free amount")); }
  if (!sets.length) throw new CostsError(400, "nothing_to_change", "Send a new price.");
  sets.push("checked_on = ?", "updated_at = ?", "updated_by = ?"); args.push(new Date().toISOString().slice(0, 10), Date.now(), adminEmail);
  const r = await getDb().execute({ sql: `UPDATE model_prices SET ${sets.join(", ")} WHERE id = ?`, args: [...args, id] });
  if (r.rowsAffected === 0) throw new CostsError(404, "not_found", "No price with that id.");
  return rowToPrice((await getDb().execute({ sql: "SELECT * FROM model_prices WHERE id = ?", args: [id] })).rows[0]);
}

export interface FixedCost { id: string; name: string; usdPerMonth: number; note: string | null; createdAt: number }
export async function listFixed(): Promise<FixedCost[]> {
  const r = await getDb().execute("SELECT * FROM fixed_costs ORDER BY created_at");
  return (r.rows as any[]).map((x) => ({ id: String(x.id), name: String(x.name), usdPerMonth: n(x.usd_per_month), note: x.note == null ? null : String(x.note), createdAt: n(x.created_at) }));
}
export async function addFixed(body: unknown): Promise<FixedCost> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  const usd = Number(b.usdPerMonth);
  if (name.length < 2) throw new CostsError(400, "name_needed", "Give the cost a name, for example Render.");
  if (!Number.isFinite(usd) || usd < 0 || usd > 1_000_000) throw new CostsError(400, "bad_price", "The monthly amount must be a number of US dollars, 0 or more.");
  const note = String(b.note ?? "").trim().slice(0, 200) || null;
  const id = crypto.randomUUID(), now = Date.now();
  await getDb().execute({ sql: "INSERT INTO fixed_costs (id, name, usd_per_month, note, created_at) VALUES (?, ?, ?, ?, ?)", args: [id, name, usd, note, now] });
  return { id, name, usdPerMonth: usd, note, createdAt: now };
}
export async function removeFixed(id: string) {
  const r = await getDb().execute({ sql: "DELETE FROM fixed_costs WHERE id = ?", args: [id] });
  if (r.rowsAffected === 0) throw new CostsError(404, "not_found", "No fixed cost with that id.");
}

/** "2026-10" for the month a time falls in (UTC), and that month's start and end. */
export function monthBounds(month?: unknown, now = Date.now()) {
  const m = typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : new Date(now).toISOString().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const start = Date.UTC(y, mo - 1, 1), end = Date.UTC(y, mo, 1);
  return { month: m, start, end, days: Math.round((end - start) / 86400_000) };
}

const modelMatches = (ledgerModel: string | null, priceModel: string) =>
  priceModel === "*" || (!!ledgerModel && (ledgerModel === priceModel || ledgerModel.startsWith(priceModel + "-")));
const quantityIn = (unit: Price["unit"], q: number) => (unit === "minute" ? q / 60 : unit === "million_tokens" ? q / 1e6 : q);

/**
 * GB months of storage in a month: the bytes held at the end of each day,
 * from the ledger, averaged over the month's days (days still to come in
 * the current month are not counted).
 */
async function storageGbMonths(start: number, end: number, days: number, now = Date.now()): Promise<{ total: number; byWallet: Map<string, number> }> {
  const db = getDb();
  const until = Math.min(end, now);
  const before = (await db.execute({
    sql: `SELECT owner_wallet AS w, SUM(CASE metric WHEN 'bytes_stored' THEN quantity WHEN 'bytes_deleted' THEN -quantity ELSE 0 END) AS b
            FROM usage_ledger WHERE feature = 'storage' AND created_at < ? GROUP BY owner_wallet`, args: [start],
  })).rows as any[];
  const during = (await db.execute({
    sql: `SELECT owner_wallet AS w, created_at AS t, CASE metric WHEN 'bytes_stored' THEN quantity ELSE -quantity END AS d
            FROM usage_ledger WHERE feature = 'storage' AND metric IN ('bytes_stored','bytes_deleted') AND created_at >= ? AND created_at < ? ORDER BY created_at`,
    args: [start, until],
  })).rows as any[];
  const held = new Map<string, number>(before.map((r) => [String(r.w ?? ""), Math.max(0, n(r.b))]));
  const gbDays = new Map<string, number>();
  let i = 0;
  for (let d = start; d < until; d += 86400_000) {
    const cut = Math.min(d + 86400_000, until);
    while (i < during.length && n(during[i].t) < cut) { const k = String(during[i].w ?? ""); held.set(k, Math.max(0, (held.get(k) ?? 0) + n(during[i].d))); i++; }
    const share = (cut - d) / 86400_000; // the last day counts only as far as it has gone
    for (const [k, b] of held) gbDays.set(k, (gbDays.get(k) ?? 0) + (b / GB) * share);
  }
  const byWallet = new Map<string, number>();
  let total = 0;
  for (const [k, v] of gbDays) { const gm = v / days; total += gm; if (k) byWallet.set(k, gm); }
  return { total, byWallet };
}

export async function monthReport(month?: unknown, now = Date.now()) {
  const { month: m, start, end, days } = monthBounds(month, now);
  const db = getDb();
  const prices = await listPrices();
  const fixed = await listFixed();
  const rows = (await db.execute({
    sql: `SELECT feature, metric, provider, model, owner_wallet, quantity, meta FROM usage_ledger
           WHERE created_at >= ? AND created_at < ? AND metric NOT IN ('bytes_stored','bytes_deleted')`,
    args: [start, end],
  })).rows as any[];

  // The prompt size of each Claude request, for prices that change above a prompt length.
  const promptOf = new Map<string, number>();
  for (const r of rows) {
    if (!["input_tokens", "cache_write_tokens", "cache_read_tokens"].includes(String(r.metric))) continue;
    const id = r.meta ? (() => { try { return JSON.parse(String(r.meta))?.requestId ?? null; } catch { return null; } })() : null;
    if (id) promptOf.set(id, (promptOf.get(id) ?? 0) + n(r.quantity));
  }

  type Line = { provider: string; model: string; metric: string; unit: string; quantity: number; usd: number; priced: boolean; priceId: string | null };
  const lines = new Map<string, Line>();
  const byFeature = new Map<string, number>();
  const byWallet = new Map<string, number>();
  for (const r of rows) {
    const provider = String(r.provider ?? "unknown"), model = r.model == null ? null : String(r.model), metric = String(r.metric);
    const p = prices.find((x) => x.provider === provider && x.metric === metric && modelMatches(model, x.model));
    const q = n(r.quantity);
    let usd = 0;
    if (p) {
      let rate = p.usd;
      if (p.longPromptTokens != null && p.longUsd != null && r.meta) {
        try { const id = JSON.parse(String(r.meta))?.requestId; if (id && (promptOf.get(id) ?? 0) > p.longPromptTokens) rate = p.longUsd; } catch { /* plain rate */ }
      }
      usd = quantityIn(p.unit, q) * rate;
    }
    const key = `${provider}|${p?.model ?? model ?? "?"}|${metric}`;
    const line = lines.get(key) ?? { provider, model: p?.model ?? model ?? "unknown", metric, unit: p?.unit ?? (metric === "audio_seconds" ? "minute" : "million_tokens"), quantity: 0, usd: 0, priced: !!p, priceId: p?.id ?? null };
    line.quantity += q; line.usd += usd; lines.set(key, line);
    const f = String(r.feature);
    byFeature.set(f, (byFeature.get(f) ?? 0) + usd);
    const w = normalizeWallet(r.owner_wallet);
    if (w) byWallet.set(w, (byWallet.get(w) ?? 0) + usd);
  }

  // Storage, priced per GB months after the free amount.
  const sp = prices.find((x) => x.metric === "gb_month");
  const st = await storageGbMonths(start, end, days, now);
  const billable = Math.max(0, st.total - (sp?.freePerMonth ?? 0));
  const storageUsd = sp ? billable * sp.usd : 0;
  if (st.total > 0 || sp) {
    lines.set("storage", { provider: sp?.provider ?? "storage", model: sp?.model ?? "*", metric: "gb_month", unit: "gb_month", quantity: st.total, usd: storageUsd, priced: !!sp, priceId: sp?.id ?? null });
    byFeature.set("storage", (byFeature.get("storage") ?? 0) + storageUsd);
    // Each wallet's share of the storage bill, by its share of the GB months.
    if (st.total > 0) for (const [w, gm] of st.byWallet) { const k = normalizeWallet(w); if (k) byWallet.set(k, (byWallet.get(k) ?? 0) + storageUsd * (gm / st.total)); }
  }

  const usageUsd = [...lines.values()].reduce((a, l) => a + l.usd, 0);
  const fixedUsd = fixed.reduce((a, f) => a + f.usdPerMonth, 0);
  const top = [...byWallet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const names = top.length ? await namesOf(top.map(([w]) => w)).catch(() => new Map<string, string>()) : new Map<string, string>();
  const elapsed = Math.max(0, Math.min(now, end) - start) / (end - start);
  return {
    month: m, start, end, days, elapsedShare: Math.round(elapsed * 1000) / 1000,
    totals: { usageUsd, fixedUsd, totalUsd: usageUsd + fixedUsd },
    lines: [...lines.values()].sort((a, b) => b.usd - a.usd || b.quantity - a.quantity),
    byFeature: [...byFeature.entries()].map(([feature, usd]) => ({ feature, usd })).sort((a, b) => b.usd - a.usd),
    topWallets: top.map(([wallet, usd]) => ({ wallet, name: names.get(wallet) ?? null, usd })),
    storage: { gbMonths: st.total, freeGbMonths: sp?.freePerMonth ?? 0 },
    unpriced: [...lines.values()].filter((l) => !l.priced).map((l) => ({ provider: l.provider, model: l.model, metric: l.metric, quantity: l.quantity })),
    fixed,
  };
}

/** Months with any usage, newest first, for the month picker. */
export async function monthsWithUsage(): Promise<string[]> {
  const r = await getDb().execute("SELECT DISTINCT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS m FROM usage_ledger ORDER BY m DESC LIMIT 24");
  const list = (r.rows as any[]).map((x) => String(x.m)).filter(Boolean);
  const cur = new Date().toISOString().slice(0, 7);
  return list.includes(cur) ? list : [cur, ...list];
}
