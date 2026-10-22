// src/lib/budgets.ts
// vm_budgets: VideoMind's monthly budget per provider (Part 20e, plan in
// claude/pricing-plan.md).
//
// An admin sets a monthly amount in US dollars for each provider (none means
// no budget). checkBudgets() measures this UTC month's spending per provider
// and, once a budget is spent, marks the provider paused for the month: from
// then on every paid action using it is refused (credits.ts,
// assertProvidersOpen) until an admin raises the budget or the month ends.
// Admins are emailed once a month at 80% and once when a provider pauses.
// Storage, playback and sign in never use a budget.
//
// How spending is measured (estimates, like the Costs page):
//   anthropic, openai  the usage ledger × the prices on Costs
//   fal, google        what the generations cost (gen_models price per second)
//   livekit            viewer minutes × the cost per viewer minute on Credits
// Checked every 2 minutes, after a change on the dashboard, and when the
// dashboard reads the budgets, so a budget can be passed by up to about two
// minutes of use. The providers' own console limits stay the last guard.
import { getDb } from "./db.js";
import { monthReport } from "./costs.js";
import { costBasis } from "./pricing.js";
import { sendMail } from "./mail.js";
import { audit } from "./admin.js";
import { CreditsError } from "./credits.js";

export const PROVIDERS = ["anthropic", "openai", "fal", "google", "livekit"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)", openai: "OpenAI", fal: "fal (video generation)", google: "Google (video generation)", livekit: "LiveKit (live events)",
};
export const PROVIDER_FEATURES: Record<Provider, string> = {
  anthropic: "processing (chapters and summary), answers, Knowledge, translations, Let AI write it",
  openai: "processing (transcripts and search), search, live captions",
  fal: "generating videos with fal models",
  google: "generating videos with Google models",
  livekit: "live events",
};
const WARN_SHARE = 0.8;
const n = (v: unknown) => Number(v ?? 0) || 0;
const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);
const monthStart = (now: number) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

export interface Budget {
  provider: Provider; label: string; features: string;
  monthlyUsd: number | null; spentUsd: number; share: number | null;
  warned: boolean; paused: boolean; checkedAt: number | null; updatedAt: number | null; updatedBy: string | null;
}

/** This month's spending per provider, in US dollars. */
export async function spendThisMonth(now = Date.now()): Promise<Record<Provider, number>> {
  const out: Record<Provider, number> = { anthropic: 0, openai: 0, fal: 0, google: 0, livekit: 0 };
  const m0 = monthStart(now);
  const [report, gens, live, basis] = await Promise.all([
    monthReport(monthKey(now), now),
    getDb().execute({
      sql: `SELECT m.provider AS provider, COALESCE(SUM(g.cost_usd), 0) AS usd FROM generations g JOIN gen_models m ON m.id = g.model_id
             WHERE g.created_at >= ? AND g.status != 'failed' GROUP BY m.provider`,
      args: [m0],
    }),
    getDb().execute({
      sql: `SELECT COALESCE(SUM(CASE WHEN viewer_limit IS NOT NULL THEN COALESCE(viewer_seconds, 0) / 60.0
              ELSE (MIN(COALESCE(ended_at, ?), COALESCE(ends_at, ?)) - started_at) / 60000.0 END), 0) AS m
              FROM live_events WHERE started_at IS NOT NULL AND started_at >= ?`,
      args: [now, now, m0],
    }),
    costBasis(now),
  ]);
  for (const l of report.lines) if (l.provider === "anthropic" || l.provider === "openai") out[l.provider] += l.usd;
  for (const r of gens.rows as any[]) if (r.provider === "fal" || r.provider === "google") out[r.provider as Provider] += n(r.usd);
  const perViewerMinute = basis.find((b) => b.action === "live")?.usdPerUnit ?? 0;
  out.livekit = Math.max(0, n((live.rows[0] as any).m)) * perViewerMinute;
  return out;
}

async function admins(): Promise<string[]> {
  const r = await getDb().execute("SELECT email FROM admin_users");
  return (r.rows as any[]).map((x) => String(x.email));
}
async function tell(subject: string, lines: string[], key: string) {
  for (const to of await admins()) {
    try { await sendMail({ to, subject, lines, after: ["This email was sent by the VideoMind admin dashboard."] }, `${key}:${to}`); }
    catch (err: any) { console.error(`[budgets] "${subject}" not sent to ${to}: ${err?.message ?? err}`); }
  }
}
const usd = (x: number) => `$${x.toFixed(2)}`;

/** Measure this month's spending, pause or reopen providers, and send the emails. Answers the budgets. */
export async function checkBudgets(now = Date.now()): Promise<Budget[]> {
  const m = monthKey(now);
  const spend = await spendThisMonth(now);
  const rows = (await getDb().execute("SELECT * FROM provider_budgets")).rows as any[];
  for (const r of rows) {
    const p = String(r.provider) as Provider;
    if (!PROVIDERS.includes(p)) continue;
    const budget = r.monthly_usd == null ? null : n(r.monthly_usd);
    const spent = spend[p];
    const wasPaused = r.paused_month === m;
    const pause = budget != null && spent >= budget;
    const warn = budget != null && budget > 0 && spent >= budget * WARN_SHARE && r.warned_month !== m;
    await getDb().execute({
      sql: "UPDATE provider_budgets SET spent_usd = ?, checked_at = ?, paused_month = ?, warned_month = ? WHERE provider = ?",
      args: [spent, now, pause ? m : null, warn || r.warned_month === m ? m : r.warned_month ?? null, p],
    });
    if (pause && !wasPaused) {
      console.warn(`[budgets] ${p} paused: ${usd(spent)} of ${usd(budget!)} this month`);
      await audit(null, "budget_paused", p, { spentUsd: Math.round(spent * 100) / 100, budgetUsd: budget });
      await tell(`VideoMind paused ${PROVIDER_LABEL[p]}`, [
        `VideoMind has spent about ${usd(spent)} on ${PROVIDER_LABEL[p]} this month, which reaches its budget of ${usd(budget!)}.`,
        `Until you raise the budget on the Costs page or the month ends, these are paused for everyone: ${PROVIDER_FEATURES[p]}.`,
      ], `budget-paused-${p}-${m}`);
    } else if (!pause && wasPaused) {
      await audit(null, "budget_reopened", p, { spentUsd: Math.round(spent * 100) / 100, budgetUsd: budget });
    }
    if (warn && !pause) {
      await tell(`VideoMind used 80% of the ${PROVIDER_LABEL[p]} budget`, [
        `VideoMind has spent about ${usd(spent)} on ${PROVIDER_LABEL[p]} this month, out of a budget of ${usd(budget!)}.`,
        `When the budget is reached, these pause for everyone until you raise it or the month ends: ${PROVIDER_FEATURES[p]}.`,
      ], `budget-warn-${p}-${m}`);
    }
  }
  return listBudgets(now);
}

/** The budgets as last checked, without measuring again. */
export async function listBudgets(now = Date.now()): Promise<Budget[]> {
  const m = monthKey(now);
  const rows = (await getDb().execute("SELECT * FROM provider_budgets")).rows as any[];
  return PROVIDERS.map((p) => {
    const r = rows.find((x) => x.provider === p) ?? {};
    const monthlyUsd = r.monthly_usd == null ? null : n(r.monthly_usd);
    const spentUsd = r.checked_at != null && monthKey(n(r.checked_at)) === m ? n(r.spent_usd) : 0;
    return {
      provider: p, label: PROVIDER_LABEL[p], features: PROVIDER_FEATURES[p],
      monthlyUsd, spentUsd, share: monthlyUsd && monthlyUsd > 0 ? spentUsd / monthlyUsd : monthlyUsd === 0 ? 1 : null,
      // No budget is never warned or paused, even if it was earlier this month (the 80% email is still sent only once).
      warned: monthlyUsd != null && r.warned_month === m, paused: monthlyUsd != null && r.paused_month === m,
      checkedAt: r.checked_at == null ? null : n(r.checked_at), updatedAt: r.updated_at == null ? null : n(r.updated_at), updatedBy: r.updated_by ?? null,
    };
  });
}

/** Set a provider's monthly budget in US dollars ("50", 50), or null for none. Measures again at once. */
export async function setBudget(provider: string, body: unknown, adminEmail: string, now = Date.now()): Promise<Budget[]> {
  if (!PROVIDERS.includes(provider as Provider)) throw new CreditsError(404, "not_found", "No budget for that provider.");
  const raw = (body as any)?.usd;
  let v: number | null = null;
  if (raw !== null) {
    const x = typeof raw === "string" ? Number(raw.trim()) : Number(raw);
    if (raw === "" || raw == null || !Number.isFinite(x) || x < 0 || x > 1_000_000) throw new CreditsError(400, "bad_budget", "The budget must be a number of US dollars, 0 or more, or empty for no budget.");
    v = Math.round(x * 100) / 100;
  }
  await getDb().execute({ sql: "UPDATE provider_budgets SET monthly_usd = ?, updated_at = ?, updated_by = ? WHERE provider = ?", args: [v, now, adminEmail, provider] });
  return checkBudgets(now);
}

/** Run checkBudgets every two minutes. Returns a stop function. */
export function startBudgetChecks(everyMs = 120_000): () => void {
  const run = () => { checkBudgets().catch((err) => console.error(`[budgets] check failed: ${err?.message ?? err}`)); };
  const first = setTimeout(run, 20_000); const t = setInterval(run, everyMs);
  first.unref(); t.unref();
  return () => { clearTimeout(first); clearInterval(t); };
}
