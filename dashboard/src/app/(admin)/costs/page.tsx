"use client";
// vm_costs: Costs, in the place of Atlassian Administration's Billing.
// Estimated cost per month, per feature and per wallet, from the quantities
// in the usage ledger and the prices in an editable table (seeded from each
// provider's official pricing page). Fixed monthly costs, such as hosting,
// are added by hand. Charging users stays parked.
//
// vm_budgets (Part 20e): VideoMind's monthly budget per provider. At 80% the
// admins get an email; when a budget is spent, the features using that
// provider pause for everyone until the budget is raised or the month ends.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import { ApiError, getCosts, updatePrice, addFixedCost, removeFixedCost, setProviderBudget, type CostReport, type Price, type ProviderBudget } from "@/lib/api";
import { featureLabel } from "@/lib/actions";
import { num, tokens, day, short } from "@/lib/format";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");
function usd(x: number): string {
  if (x === 0) return "$0.00";
  if (Math.abs(x) < 0.01) return x < 0 ? "-$0.01" : "under $0.01";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const rate = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
const PROVIDER: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", cloudflare: "Cloudflare", unknown: "Unknown" };
const METRIC: Record<string, string> = {
  input_tokens: "Input tokens", output_tokens: "Output tokens", cache_write_tokens: "Cache writes", cache_read_tokens: "Cache hits",
  audio_seconds: "Audio", gb_month: "Storage",
};
const UNIT: Record<string, string> = { minute: "per minute", million_tokens: "per million tokens", gb_month: "per GB month" };
const amount = (metric: string, q: number) =>
  metric === "audio_seconds" ? `${num(q / 60)} min` : metric === "gb_month" ? `${q.toFixed(2)} GB months` : `${tokens(q)} tokens`;
const service = (provider: string, model: string) => (model === "r2" ? "Cloudflare R2" : `${PROVIDER[provider] ?? provider} ${model}`);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });

function Tile({ label, value, sub, test }: { label: string; value: string; sub?: string; test: string }) {
  return (
    <div className="panel p-4 min-w-0" data-cost={test}>
      <p className="stat-label !mt-0">{label}</p>
      <p className="stat-value mt-1.5" data-cost-value>{value}</p>
      {sub && <p className="text-[12.5px] text-dim mt-1">{sub}</p>}
    </div>
  );
}
function Panel({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="panel panel-pad min-w-0" aria-label={title}>
      <div className="panel-head"><h2 className="panel-head-title">{title}</h2></div>
      {hint && <p className="text-[13px] text-dim -mt-1 mb-3 max-w-[80ch]">{hint}</p>}
      {children}
    </section>
  );
}

function PriceRow({ p, onSaved, onError }: { p: Price; onSaved: (p: Price) => void; onError: (m: string) => void }) {
  const [v, setV] = useState(String(p.usd));
  const [lv, setLv] = useState(p.longUsd == null ? "" : String(p.longUsd));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(String(p.usd)); setLv(p.longUsd == null ? "" : String(p.longUsd)); }, [p]);
  const changed = v !== String(p.usd) || (p.longUsd != null && lv !== String(p.longUsd));
  const save = async () => {
    const x = Number(v), lx = Number(lv);
    if (v.trim() === "" || !Number.isFinite(x) || x < 0) return onError("Write the price as a number of US dollars, for example 0.006.");
    if (p.longUsd != null && (lv.trim() === "" || !Number.isFinite(lx) || lx < 0)) return onError("Write the long prompt price as a number of US dollars.");
    setBusy(true);
    try { onSaved(await updatePrice(p.id, p.longUsd != null ? { usd: x, longUsd: lx } : { usd: x })); }
    catch (e) { onError(msg(e)); }
    finally { setBusy(false); }
  };
  const label = `${service(p.provider, p.model)}, ${METRIC[p.metric] ?? p.metric}`;
  return (
    <tr className="border-b border-rule last:border-0 align-top" data-price-row={p.id}>
      <td className="py-2 px-4 text-paper whitespace-nowrap">{service(p.provider, p.model)}</td>
      <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{METRIC[p.metric] ?? p.metric}</td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-1.5">
          <span className="text-dim">$</span>
          <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" className="h-8 px-2 w-24 text-[13.5px] tabular-nums" aria-label={`Price for ${label}`} />
          <span className="text-dim text-[12.5px] whitespace-nowrap">{UNIT[p.unit] ?? p.unit}</span>
        </div>
        {p.longUsd != null && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-dim">$</span>
            <input value={lv} onChange={(e) => setLv(e.target.value)} inputMode="decimal" className="h-8 px-2 w-24 text-[13.5px] tabular-nums" aria-label={`Long prompt price for ${label}`} />
            <span className="text-dim text-[12.5px] whitespace-nowrap">over {num(p.longPromptTokens ?? 0)} token prompts</span>
          </div>
        )}
        {p.freePerMonth > 0 && <p className="text-[12.5px] text-dim mt-1">First {num(p.freePerMonth)} GB months free each month</p>}
      </td>
      <td className="py-2 pr-4 text-[12.5px] text-dim whitespace-nowrap">
        {p.source ? <a href={p.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-paper">Pricing page <ExternalLink size={12} aria-hidden /></a> : "-"}
        <p className="mt-0.5">{p.updatedBy ? `Changed ${day(p.updatedAt)} by ${p.updatedBy}` : p.checkedOn ? `Checked ${day(Date.parse(p.checkedOn + "T12:00:00Z"))}` : ""}</p>
      </td>
      <td className="py-2 pr-4 text-right">
        <button onClick={() => void save()} disabled={!changed || busy} className="btn btn-ghost h-8 px-3 text-[13px] no-min">{busy ? "Saving" : "Save"}</button>
      </td>
    </tr>
  );
}

/** vm_budgets: one provider's budget, this month's spending, and its state. */
function BudgetRow({ b, onSaved, onError }: { b: ProviderBudget; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const shown = b.monthlyUsd == null ? "" : String(b.monthlyUsd);
  const [v, setV] = useState(shown);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(b.monthlyUsd == null ? "" : String(b.monthlyUsd)); }, [b.monthlyUsd]);
  const save = async () => {
    const t = v.trim();
    if (t !== "" && (!Number.isFinite(Number(t)) || Number(t) < 0)) return onError("Write the budget as a number of US dollars, or leave it empty for no budget.");
    setBusy(true);
    try { await setProviderBudget(b.provider, t === "" ? null : t); onSaved(t === "" ? `${b.label} has no budget now.` : `The ${b.label} budget is now $${Number(t).toFixed(2)} a month.`); }
    catch (e) { onError(msg(e)); } finally { setBusy(false); }
  };
  const pct = b.share == null ? null : Math.min(999, Math.round(b.share * 100));
  return (
    <tr className={clsx("border-t border-rule align-top", b.paused && "bg-error/5")} data-budget={b.provider} data-budget-state={b.paused ? "paused" : b.warned ? "warned" : "ok"}>
      <td className="py-2 pr-4">
        <span className="text-paper">{b.label}</span>
        <p className="text-[12px] text-dim max-w-[320px]">{b.features}</p>
      </td>
      <td className="py-2 pr-4 tabular-nums text-paper-2 whitespace-nowrap">{usd(b.spentUsd)}</td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-1.5">
          <span className="text-dim">$</span>
          <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder="No budget" className="h-8 px-2 w-28 text-[13.5px] tabular-nums" aria-label={`Monthly budget for ${b.label}`} />
          <button onClick={() => void save()} disabled={busy || v.trim() === shown} className="btn btn-ghost h-8 px-3 text-[13px] no-min">Save</button>
        </div>
        {b.updatedBy && <p className="text-[12px] text-dim mt-1">Changed {day(b.updatedAt ?? 0)} by {b.updatedBy}</p>}
      </td>
      <td className={clsx("py-2 pr-4 text-[13px] whitespace-nowrap", b.paused ? "text-error" : b.warned ? "text-warn" : "text-paper-2")} data-budget-status>
        {b.monthlyUsd == null ? <span className="text-dim">No budget</span> : b.paused ? `Paused, ${pct}% used` : `${pct}% used${b.warned ? ", over 80%" : ""}`}
      </td>
    </tr>
  );
}

export default function CostsPage() {
  const { signedOut } = useAdmin();
  const [month, setMonth] = useState<string>("");
  const [r, setR] = useState<CostReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [name, setName] = useState(""); const [amt, setAmt] = useState(""); const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try { setR(await getCosts(month || undefined)); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
  }, [month, signedOut]);
  useEffect(() => { void load(); }, [load]);

  const addFixed = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setDone(null);
    const x = Number(amt);
    if (amt.trim() === "" || !Number.isFinite(x) || x < 0) return setErr("Write the monthly amount as a number of US dollars, for example 7.");
    try { await addFixedCost(name.trim(), x, note.trim()); setName(""); setAmt(""); setNote(""); await load(); setDone("The fixed cost was added."); }
    catch (e2) { setErr(msg(e2)); }
  };
  const removeFixed = async (id: string, n: string) => {
    if (!window.confirm(`Remove "${n}" from the fixed costs?`)) return;
    setErr(null); setDone(null);
    try { await removeFixedCost(id); await load(); setDone("The fixed cost was removed."); }
    catch (e) { setErr(msg(e)); }
  };

  const partial = r ? r.elapsedShare < 1 : false;
  return (
    <div className="section py-6 lg:py-8">
      <h1 className="font-display text-[22px] text-paper">Costs</h1>
      <p className="text-[14px] text-dim mt-1 mb-5 max-w-[80ch]">Estimates from the usage the site recorded and the prices below. The providers&apos; own bills are the real figures.</p>
      {err && <div className="mb-4"><Note kind="error">{err}</Note></div>}
      {done && <div className="mb-4"><Note kind="ok">{done}</Note></div>}
      {!r && !err && <p className="text-[14px] text-dim">Loading</p>}
      {r && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-[13px] text-dim flex items-center gap-2">Month
              <select value={r.month} onChange={(e) => setMonth(e.target.value)} className="h-9 px-2.5 text-[13.5px]" aria-label="Month">
                {r.months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
            </label>
            {partial && <span className="text-[13px] text-dim" data-cost-partial>So far: {Math.round(r.elapsedShare * 100)}% of the month has passed (UTC).</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Tile test="usage" label="Usage, estimated" value={usd(r.totals.usageUsd)} sub={partial && r.elapsedShare > 0 ? `About ${usd(r.totals.usageUsd / r.elapsedShare)} for the month at this rate` : undefined} />
            <Tile test="fixed" label="Fixed costs" value={usd(r.totals.fixedUsd)} sub={`${r.fixed.length} ${r.fixed.length === 1 ? "item" : "items"} added below`} />
            <Tile test="total" label="Total" value={usd(r.totals.totalUsd)} sub={monthName(r.month)} />
          </div>

          {r.unpriced.length > 0 && (
            <Note kind="error">
              Not counted, because no price matches: {r.unpriced.map((u) => `${service(u.provider, u.model)} ${(METRIC[u.metric] ?? u.metric).toLowerCase()} (${amount(u.metric, u.quantity)})`).join("; ")}. Add the model to the price table to include it.
            </Note>
          )}

          <Panel title="By service">
            {r.lines.length === 0 ? <p className="text-[13.5px] text-dim">No usage recorded in this month.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px] min-w-[520px]" data-cost-lines>
                  <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">Service</th><th className="font-normal py-1.5 pr-4">What</th><th className="font-normal py-1.5 pr-4 text-right">Amount</th><th className="font-normal py-1.5 text-right">Cost</th></tr></thead>
                  <tbody>{r.lines.map((l) => (
                    <tr key={`${l.provider}|${l.model}|${l.metric}`} className="border-t border-rule" data-cost-line={`${l.model}|${l.metric}`}>
                      <td className="py-1.5 pr-4 text-paper-2">{service(l.provider, l.model)}</td>
                      <td className="py-1.5 pr-4 text-paper-2">{METRIC[l.metric] ?? l.metric}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-paper-2">{amount(l.metric, l.quantity)}</td>
                      <td className="py-1.5 text-right tabular-nums text-paper">{l.priced ? usd(l.usd) : <span className="text-error">No price</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {r.storage.gbMonths > 0 && <p className="text-[12.5px] text-dim mt-3">Storage is the space held each day, averaged over the month ({r.storage.gbMonths.toFixed(2)} GB months), less the free {num(r.storage.freeGbMonths)} GB months.</p>}
          </Panel>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="By feature">
              {r.byFeature.length === 0 ? <p className="text-[13.5px] text-dim">Nothing yet.</p> : (
                <table className="w-full text-[13.5px]" data-cost-features>
                  <tbody>{r.byFeature.map((f) => (
                    <tr key={f.feature} className="border-t border-rule first:border-0"><td className="py-1.5 pr-4 text-paper-2">{featureLabel(f.feature)}</td><td className="py-1.5 text-right tabular-nums text-paper">{usd(f.usd)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Panel>
            <Panel title="Wallets that cost the most" hint="Usage and each wallet's share of storage. Fixed costs are not shared out.">
              {r.topWallets.length === 0 ? <p className="text-[13.5px] text-dim">Nothing yet.</p> : (
                <table className="w-full text-[13.5px]" data-cost-wallets>
                  <tbody>{r.topWallets.map((w) => (
                    <tr key={w.wallet} className="border-t border-rule first:border-0">
                      <td className="py-1.5 pr-4 min-w-0"><Link href={`/users/${w.wallet}`} className="text-paper-2 hover:text-signal">{w.name ?? <span className="tc">{short(w.wallet)}</span>}</Link></td>
                      <td className="py-1.5 text-right tabular-nums text-paper">{usd(w.usd)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </Panel>
          </div>

          <Panel title="Provider budgets" hint="VideoMind's own limit per provider for this month (UTC), measured from the usage and the prices on this page. Admins get an email at 80%. When a budget is spent, the features listed pause for everyone until you raise it or the month ends; storage, playback and sign in never pause. Measured every two minutes, so a budget can be passed by a few minutes of use. Leave a budget empty for none. Keep the spend limits in the providers' own consoles as well.">
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px] min-w-[720px]" data-budgets>
                <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">Provider</th><th className="font-normal py-1.5 pr-4">Spent this month</th><th className="font-normal py-1.5 pr-4">Monthly budget</th><th className="font-normal py-1.5 pr-4">Status</th></tr></thead>
                <tbody>{r.budgets.map((b) => <BudgetRow key={b.provider} b={b} onError={(m) => { setDone(null); setErr(m); }} onSaved={(m) => { setErr(null); void load().then(() => setDone(m)); }} />)}</tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Fixed monthly costs" hint="Costs the ledger does not see: Render, Vercel, Turso, LiveKit, Resend, a domain. Each one counts in full in every month.">
            {r.fixed.length > 0 && (
              <ul className="mb-4 divide-y divide-rule" data-fixed>
                {r.fixed.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2 text-[13.5px]" data-fixed-row={f.name}>
                    <span className="text-paper">{f.name}</span>
                    {f.note && <span className="text-dim truncate min-w-0">{f.note}</span>}
                    <span className="ml-auto tabular-nums text-paper">{usd(f.usdPerMonth)} a month</span>
                    <button onClick={() => void removeFixed(f.id, f.name)} className="btn btn-ghost h-8 px-3 text-[13px] no-min">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addFixed} className="flex items-end gap-3 flex-wrap">
              <label className="text-[13px] text-dim flex flex-col gap-1">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Render" className="h-9 px-3 text-[13.5px] w-44" /></label>
              <label className="text-[13px] text-dim flex flex-col gap-1">US dollars a month<input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="7" className="h-9 px-3 text-[13.5px] w-32 tabular-nums" /></label>
              <label className="text-[13px] text-dim flex flex-col gap-1">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Starter plan" className="h-9 px-3 text-[13.5px] w-48" /></label>
              <button type="submit" className="btn btn-ghost h-9 px-3.5">Add</button>
            </form>
          </Panel>

          <Panel title="Prices" hint="Taken from each provider's official pricing page on 15 October 2026. Prices change: check the page and save the new figure here. A change applies to every month shown.">
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-[13.5px] min-w-[760px]" data-prices>
                <thead><tr className="text-left text-dim border-b border-rule"><th className="font-normal py-2.5 px-4">Service</th><th className="font-normal py-2.5 pr-4">What</th><th className="font-normal py-2.5 pr-4">Price</th><th className="font-normal py-2.5 pr-4">Source</th><th className="py-2.5 pr-4" /></tr></thead>
                <tbody>{r.prices.map((p) => (
                  <PriceRow key={p.id} p={p} onError={(m) => { setDone(null); setErr(m); }} onSaved={(np) => { setErr(null); void load().then(() => setDone(`The price for ${service(np.provider, np.model)} was saved.`)); }} />
                ))}</tbody>
              </table>
            </div>
          </Panel>

          <p className="text-[12.5px] text-dim max-w-[90ch]">
            Not in the estimate: LiveKit minutes for live events, R2 requests (class A and B operations; R2 does not charge for downloads), email through Resend, and hosting. Add the ones you pay as fixed costs.
            Claude prices are the standard ones; prompts longer than the limit shown use the long prompt price. Storage before the ledger began is not known.
          </p>
        </div>
      )}
    </div>
  );
}
