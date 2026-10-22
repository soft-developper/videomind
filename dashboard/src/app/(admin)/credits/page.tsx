"use client";
// vm_credits: Credits (Part 16a). The price of each action, the free amount
// every wallet gets once, giving and removing credits, refunds, and the
// ledger of every change. Credits are counted in micro dollars. Charging is
// off until the actions are wired to it (Part 16c): until then users see
// the prices on their Wallet page and nothing is taken from a balance.
//
// vm_pricing (Part 20a): next to each price, what one unit costs VideoMind
// (exact provider price, measured average or starting estimate), the
// platform fee, and the suggested price (cost plus fee) with Apply. A price
// below cost is marked. Nothing changes for users until an admin applies.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import {
  ApiError, getCredits, getCreditLedger, setCreditPrice, setWelcome, grantCredits, removeCredits, refundCredit, setCharging, setStorageFree,
  setPlatformFee, applySuggestedPrice, applyAllSuggestedPrices, setCostEstimate,
  type CreditsOverview, type CreditEntry, type CreditKind, type ActionPrice, type PricingRow, type CostEstimate,
} from "@/lib/api";
import { dollars, CREDIT_KINDS, CREDIT_UNITS } from "@/lib/actions";
import { num, when, short, gb } from "@/lib/format";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");
const asInput = (micros: number) => String(micros / 1_000_000);
const unitWord: Record<string, string> = { minute: "minutes", answer: "answers", search: "searches", generation: "generations", gb_month: "GB months", second: "seconds" };

function Tile({ label, value, sub, test }: { label: string; value: string; sub?: string; test: string }) {
  return (
    <div className="panel p-4 min-w-0" data-credit-tile={test}>
      <p className="stat-label !mt-0">{label}</p>
      <p className="stat-value mt-1.5" data-credit-value>{value}</p>
      {sub && <p className="text-[12.5px] text-dim mt-1">{sub}</p>}
    </div>
  );
}
function Panel({ title, children, hint, id }: { title: string; children: React.ReactNode; hint?: React.ReactNode; id?: string }) {
  return (
    <section className="panel panel-pad min-w-0" aria-label={title} id={id}>
      <div className="panel-head"><h2 className="panel-head-title">{title}</h2></div>
      {hint && <p className="text-[13px] text-dim -mt-1 mb-3 max-w-[80ch]">{hint}</p>}
      {children}
    </section>
  );
}

const SOURCE: Record<string, string> = { exact: "Exact", measured: "Measured", estimate: "Estimate", none: "No cost yet" };
const usd = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;

function PriceRow({ p, row, est, charging, onSaved, onError }: {
  p: ActionPrice; row: PricingRow | undefined; est: CostEstimate | undefined; charging: boolean;
  onSaved: (message: string) => void; onError: (m: string) => void;
}) {
  const [v, setV] = useState(asInput(p.microsPerUnit));
  const [busy, setBusy] = useState(false);
  const [editEst, setEditEst] = useState(false);
  const [estV, setEstV] = useState(est ? String(est.usdPerUnit) : "");
  useEffect(() => { setV(asInput(p.microsPerUnit)); }, [p]);
  useEffect(() => { setEstV(est ? String(est.usdPerUnit) : ""); }, [est]);
  const changed = v.trim() !== asInput(p.microsPerUnit);
  const save = async () => {
    const x = Number(v);
    if (v.trim() === "" || !Number.isFinite(x) || x < 0) return onError("Write the price as a number of US dollars, for example 0.05. Write 0 to keep it free.");
    setBusy(true);
    try { const np = await setCreditPrice(p.id, v.trim()); onSaved(`The price of ${np.label.toLowerCase()} was saved.`); } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true);
    try { const r = await applySuggestedPrice(p.id); onSaved(`${p.label}: price set to the suggestion, ${dollars(r.toMicros, true)} ${CREDIT_UNITS[p.unit] ?? ""}.`); }
    catch (e) { onError(msg(e)); } finally { setBusy(false); }
  };
  const saveEst = async () => {
    const x = Number(estV);
    if (estV.trim() === "" || !Number.isFinite(x) || x < 0) return onError("Write the estimate as a number of US dollars, for example 0.02.");
    setBusy(true);
    try { await setCostEstimate(p.id, estV.trim()); setEditEst(false); onSaved(`The starting estimate for ${p.label.toLowerCase()} was saved.`); }
    catch (e) { onError(msg(e)); } finally { setBusy(false); }
  };
  const cost = row?.costUsd ?? null;
  const priceUsd = p.microsPerUnit / 1_000_000;
  const margin = cost != null && cost > 0 && priceUsd > 0 ? Math.round(((priceUsd - cost) / priceUsd) * 100) : null;
  const below = !!row?.belowCost;
  const loud = below && charging;
  const atSuggestion = row?.suggestedMicros != null && row.suggestedMicros === p.microsPerUnit;
  return (
    <tr className={clsx("border-b border-rule last:border-0 align-top", loud && "bg-error/5")} data-credit-price={p.id} data-below-cost={below ? "yes" : "no"}>
      <td className="py-2 px-4 text-paper">
        {p.label}
        {loud && <p className="text-[12px] text-error mt-0.5" data-below-note>Below cost: VideoMind loses money on each one</p>}
      </td>
      <td className="py-2 pr-4 text-[13px] text-paper-2 tabular-nums" data-credit-cost>
        {cost == null ? <span className="text-dim">No cost yet</span> : <span className="whitespace-nowrap">{usd(cost)}</span>}
        <p className="text-[12px] text-dim" title={row?.costNote ?? undefined}>
          <span data-cost-source={row?.costSource ?? "none"}>{SOURCE[row?.costSource ?? "none"]}</span>
          {row && row.units30 > 0 && <>, {num(Math.round(row.units30 * 100) / 100)} {unitWord[p.unit] ?? "units"} in 30 days</>}
        </p>
        {row?.costNote && <p className="text-[12px] text-dim max-w-[260px]">{row.costNote}</p>}
        {est && row?.costSource !== "exact" && (
          editEst ? (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-dim">$</span>
              <input value={estV} onChange={(e) => setEstV(e.target.value)} inputMode="decimal" className="h-7 px-2 w-24 text-[12.5px] tabular-nums" aria-label={`Starting estimate for ${p.label}`} />
              <button onClick={() => void saveEst()} disabled={busy} className="btn btn-ghost h-7 px-2 text-[12px] no-min">Save</button>
              <button onClick={() => { setEditEst(false); setEstV(String(est.usdPerUnit)); }} className="text-[12px] text-dim hover:text-paper no-min">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setEditEst(true)} className="text-[12px] text-dim underline hover:text-paper no-min mt-0.5" data-edit-estimate>
              Starting estimate {usd(est.usdPerUnit)}, edit
            </button>
          )
        )}
      </td>
      <td className="py-2 pr-4 text-[13px] tabular-nums" data-credit-suggested>
        {row?.suggestedMicros == null ? <span className="text-dim">-</span> : (
          <>
            <span className="text-paper whitespace-nowrap">{dollars(row.suggestedMicros, true)}</span>
            <div className="mt-1">
              {atSuggestion
                ? <span className="text-[12px] text-marker">Price is at the suggestion</span>
                : <button onClick={() => void apply()} disabled={busy} className="btn btn-ghost h-7 px-2.5 text-[12.5px] no-min" data-apply>Apply</button>}
            </div>
          </>
        )}
      </td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-1.5">
          <span className="text-dim">$</span>
          <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" className="h-8 px-2 w-24 text-[13.5px] tabular-nums" aria-label={`Price for ${p.label}`} />
          <button onClick={() => void save()} disabled={!changed || busy} className="btn btn-ghost h-8 px-3 text-[13px] no-min">{busy ? "Saving" : "Save"}</button>
        </div>
        <p className="text-[12.5px] text-dim mt-1">{p.microsPerUnit === 0 ? "Free" : `${dollars(p.microsPerUnit, true)} ${CREDIT_UNITS[p.unit] ?? ""}`}{p.updatedBy ? `, changed ${when(p.updatedAt)} by ${p.updatedBy}` : ""}</p>
      </td>
      <td className={clsx("py-2 pr-4 text-[13px] tabular-nums whitespace-nowrap", margin != null && margin < 0 ? "text-error" : "text-paper-2")} data-credit-margin>
        {margin == null ? <span className="text-dim">-</span> : `${margin}%`}
      </td>
    </tr>
  );
}

function Fee({ feeBps, onSaved, onError }: { feeBps: number; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const shown = String(feeBps / 100);
  const [v, setV] = useState(shown);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(String(feeBps / 100)); }, [feeBps]);
  const save = async () => {
    const x = Number(v);
    if (v.trim() === "" || !Number.isFinite(x) || x < 0) return onError("Write the platform fee as a percentage, for example 0.3.");
    setBusy(true);
    try { const r = await setPlatformFee(v.trim()); onSaved(`The platform fee is now ${r.feeBps / 100}%. Suggested prices were updated; apply them to change what users pay.`); }
    catch (e) { onError(msg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-end gap-3 flex-wrap" data-platform-fee>
      <label className="text-[13px] text-dim flex flex-col gap-1">Platform fee, %
        <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" className="h-9 px-3 text-[13.5px] w-28 tabular-nums" aria-label="Platform fee in percent" />
      </label>
      <button onClick={() => void save()} disabled={busy || v.trim() === shown} className="btn btn-ghost h-9 px-3.5">Save</button>
    </div>
  );
}

function What({ e }: { e: CreditEntry }) {
  const parts: React.ReactNode[] = [];
  if (e.action) parts.push(e.action.replace(/_/g, " "));
  if (e.quantity != null && e.kind === "charge") parts.push(e.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  if (e.videoId) parts.push(<Link key="v" href={`/content/videos/${e.videoId}`} className="underline hover:text-paper">video</Link>);
  if (e.kind === "topup" && e.ref) parts.push(<a key="t" href={`https://explorer.aptoslabs.com/txn/${e.ref}?network=shelbynet`} target="_blank" rel="noreferrer" className="underline hover:text-paper">ShelbyUSD transfer</a>);
  return (
    <span className="text-paper-2">
      {parts.map((x, i) => <span key={i}>{i > 0 && ", "}{x}</span>)}
      {e.note && <span className="text-dim">{parts.length ? ". " : ""}{e.note}</span>}
    </span>
  );
}

/** What was charged this month, what it cost VideoMind, the fee and the fixed costs. */
function ThisMonth({ o }: { o: CreditsOverview }) {
  const m = o.pricing.totals;
  const left = m.marginMicros - m.fixedMonthMicros;
  const rows = o.pricing.rows.filter((r) => r.unitsMonth > 0 || r.chargedMonthMicros > 0);
  const label = (id: string) => o.prices.find((p) => p.id === id)?.label ?? id;
  return (
    <Panel title={`This month (${o.pricing.month})`} hint={<>Since the first of the month, UTC. Charged is what users paid, refunds taken off. Cost is the units used times the cost per unit above, so it is an estimate; the providers&rsquo; invoices are the real figures. Fixed costs are the monthly amounts on <Link href="/costs" className="underline hover:text-paper">Costs</Link>.{o.settings.charging ? "" : " Charging is off, so nothing is charged and everything used is a cost to VideoMind."}</>}>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4" data-month-totals>
        <Tile test="m-charged" label="Charged" value={dollars(m.chargedMicros)} />
        <Tile test="m-cost" label="Cost of what was used" value={dollars(m.costMicros)} />
        <Tile test="m-margin" label="Charged less cost" value={dollars(m.marginMicros)} sub={`Of which the ${o.pricing.feeBps / 100}% fee: ${dollars(m.feeMicros)}`} />
        <Tile test="m-fixed" label="Fixed costs, a month" value={dollars(m.fixedMonthMicros)} sub="Hosting and plans" />
        <Tile test="m-left" label="Left after fixed costs" value={dollars(left)} sub={left < 0 ? "VideoMind is paying the difference" : "Covered"} />
      </div>
      {rows.length === 0 ? <p className="text-[13.5px] text-dim">Nothing used yet this month.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[640px]" data-month-rows>
            <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">Action</th><th className="font-normal py-1.5 pr-4 text-right">Used</th><th className="font-normal py-1.5 pr-4 text-right">Charged</th><th className="font-normal py-1.5 pr-4 text-right">Cost</th><th className="font-normal py-1.5 pr-4 text-right">Difference</th></tr></thead>
            <tbody>{rows.map((r) => {
              const d = r.chargedMonthMicros - r.costMonthMicros;
              return (
                <tr key={r.action} className="border-t border-rule">
                  <td className="py-1.5 pr-4 text-paper-2">{label(r.action)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-paper-2">{num(Math.round(r.unitsMonth * 100) / 100)} {unitWord[r.unit] ?? "units"}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-paper-2">{dollars(r.chargedMonthMicros)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-paper-2">{dollars(r.costMonthMicros)}</td>
                  <td className={clsx("py-1.5 pr-4 text-right tabular-nums", d < 0 ? "text-error" : "text-paper-2")}>{d > 0 ? "+" : ""}{dollars(d)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default function CreditsPage() {
  const { signedOut } = useAdmin();
  const [o, setO] = useState<CreditsOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [welcome, setWelcomeV] = useState("");
  const [freeGb, setFreeGb] = useState("");
  const [wallet, setWallet] = useState(""); const [amt, setAmt] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // The ledger
  const [fWallet, setFWallet] = useState(""); const [fKind, setFKind] = useState<CreditKind | "">("");
  const [rows, setRows] = useState<CreditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const seq = useRef(0);

  const fail = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) return signedOut(); setDone(null); setErr(msg(e)); }, [signedOut]);
  const load = useCallback(async () => {
    try { const r = await getCredits(); setO(r); setWelcomeV(asInput(r.settings.welcomeMicros)); setFreeGb(String(r.storage.freeBytes / r.storage.gbBytes)); } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => { void load(); }, [load]);

  // ?wallet= from a user's page fills the forms and the ledger filter.
  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("wallet");
    if (w) { setWallet(w); setFWallet(w); }
  }, []);

  const loadLedger = useCallback(async (before: string | null) => {
    const my = ++seq.current;
    try {
      const r = await getCreditLedger({ wallet: fWallet.trim() || undefined, kind: fKind, before });
      if (my !== seq.current) return;
      setRows((cur) => (before ? [...(cur ?? []), ...r.entries] : r.entries)); setNext(r.next);
    } catch (e) { if (my === seq.current) fail(e); }
  }, [fWallet, fKind, fail]);
  useEffect(() => { const t = setTimeout(() => void loadLedger(null), 300); return () => clearTimeout(t); }, [loadLedger]);

  const refresh = async (message: string) => { setErr(null); await Promise.all([load(), loadLedger(null)]); setDone(message); };

  const toggleCharging = async (on: boolean) => {
    const priced = (o?.prices ?? []).filter((p) => p.microsPerUnit > 0).length;
    const ask = on
      ? `Turn charging on? ${priced} of ${o?.prices.length ?? 0} actions have a price above 0 and will need credits from now on.`
      : "Turn charging off? Actions become free until you turn it on again.";
    if (!window.confirm(ask)) return;
    setBusy(true);
    try { const s = await setCharging(on); await refresh(s.charging ? "Charging is on." : "Charging is off."); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const saveWelcome = async () => {
    const x = Number(welcome);
    if (welcome.trim() === "" || !Number.isFinite(x) || x < 0) return fail(new ApiError("Write the welcome amount as a number of US dollars, for example 1. Write 0 for none.", 400));
    setBusy(true);
    try { const s = await setWelcome(welcome.trim()); await refresh(s.welcomeMicros ? `Every wallet now gets ${dollars(s.welcomeMicros, true)} once.` : "New wallets get no welcome credits."); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const saveFree = async () => {
    const x = Number(freeGb);
    if (freeGb.trim() === "" || !Number.isFinite(x) || x < 0) return fail(new ApiError("Write the free storage as a number of GB, for example 1. Write 0 for none.", 400));
    setBusy(true);
    try { const s = await setStorageFree(freeGb.trim()); await refresh(s.freeBytes ? `Every owner now keeps ${gb(s.freeBytes)} free.` : "Storage is charged from the first byte."); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const change = async (how: "grant" | "remove") => {
    if (!wallet.trim()) return fail(new ApiError("Write the wallet address.", 400));
    const x = Number(amt);
    if (amt.trim() === "" || !Number.isFinite(x) || x <= 0) return fail(new ApiError("Write the amount as a number of US dollars above 0, for example 5.", 400));
    if (how === "remove" && !window.confirm(`Remove ${dollars(Math.round(x * 1e6), true)} from ${short(wallet.trim())}?`)) return;
    setBusy(true);
    try {
      const e = how === "grant" ? await grantCredits(wallet.trim(), amt.trim(), note.trim()) : await removeCredits(wallet.trim(), amt.trim(), note.trim());
      setAmt(""); setNote(""); setFWallet(e.wallet);
      await refresh(how === "grant" ? `Gave ${dollars(e.amountMicros, true)} to ${short(e.wallet)}.` : `Removed ${dollars(-e.amountMicros, true)} from ${short(e.wallet)}.`);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const refund = async (e: CreditEntry) => {
    const why = window.prompt(`Refund ${dollars(-e.amountMicros, true)} to ${short(e.wallet)}? You can add a note for the ledger.`, "");
    if (why === null) return;
    try { const r = await refundCredit(e.id, why); await refresh(`Refunded ${dollars(r.amountMicros, true)} to ${short(r.wallet)}.`); } catch (x) { fail(x); }
  };

  const applyAll = async (count: number) => {
    if (!window.confirm(`Set ${count} ${count === 1 ? "price" : "prices"} to the suggestion? Users pay the new prices for actions started from now on.`)) return;
    setBusy(true);
    try { const r = await applyAllSuggestedPrices(); await refresh(`${r.changed.length} ${r.changed.length === 1 ? "price was" : "prices were"} set to the suggestion.`); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  const t = o?.totals;
  const given = t ? t.byKind.welcome.micros + t.byKind.grant.micros + t.byKind.remove.micros : 0;
  const spent = t ? Math.max(0, -(t.byKind.charge.micros + t.byKind.refund.micros)) : 0;
  return (
    <div className="section py-6 lg:py-8">
      <h1 className="font-display text-[22px] text-paper">Credits</h1>
      <p className="text-[14px] text-dim mt-1 mb-5 max-w-[80ch]">What each action costs a user, free credits, and every change to a balance. Amounts are US dollars.</p>
      {err && <div className="mb-4"><Note kind="error">{err}</Note></div>}
      {done && <div className="mb-4"><Note kind="ok">{done}</Note></div>}
      {!o && !err && <p className="text-[14px] text-dim">Loading</p>}
      {o && t && (
        <div className="space-y-5">
          <section className={clsx("panel panel-pad", o.settings.charging ? "border-marker-dim" : "")} aria-label="Charging" data-charging={o.settings.charging ? "on" : "off"}>
            <div className="flex items-start gap-4 flex-wrap">
              <div className="flex-1 min-w-[260px]">
                <h2 className="text-[15px] font-semibold text-paper">Charging is {o.settings.charging ? "on" : "off"}</h2>
                <p className="text-[13px] text-dim mt-1 max-w-[80ch]">
                  {o.settings.charging
                    ? "Each action holds its price before it starts and is charged when it succeeds; a failed action costs nothing. Processing a video and answers on a video are paid by the video's owner (also for visitors' questions); search and Knowledge by the person using them; live captions by the host, per minute. Actions priced at 0 stay free."
                    : "Nothing is taken from a balance. Users see the prices on their Wallet page. Set the prices first: when you turn charging on, every action with a price above 0 needs credits."}
                </p>
              </div>
              <button onClick={() => void toggleCharging(!o.settings.charging)} disabled={busy} className={clsx("btn h-9 px-4", o.settings.charging ? "btn-ghost" : "btn-signal")} data-charging-toggle>
                {o.settings.charging ? "Turn charging off" : "Turn charging on"}
              </button>
            </div>
          </section>

          {o.topup.treasury ? (
            <p className="text-[13px] text-dim" data-credit-treasury>
              Top ups go to the treasury <a href={`https://explorer.aptoslabs.com/account/${o.topup.treasury}?network=${o.topup.network}`} target="_blank" rel="noreferrer" className="tc text-paper-2 underline hover:text-paper break-all">{o.topup.treasury}</a> on {o.topup.network}, 1 ShelbyUSD for 1 dollar of credits. It is set on the server (TOPUP_TREASURY_ADDRESS on Render).
            </p>
          ) : (
            <Note kind="error">Adding credits is off: no treasury address is set. Add TOPUP_TREASURY_ADDRESS on Render, with the address of the wallet that should receive ShelbyUSD.</Note>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile test="outstanding" label="Credits held by wallets" value={dollars(t.outstandingMicros)} sub={`${num(t.walletsWithCredits)} ${t.walletsWithCredits === 1 ? "wallet" : "wallets"} with credits`} />
            <Tile test="given" label="Given free" value={dollars(given)} sub="Welcome and admin grants, less removals" />
            <Tile test="spent" label="Spent" value={dollars(spent)} sub={`Charges less ${num(t.byKind.refund.count)} ${t.byKind.refund.count === 1 ? "refund" : "refunds"}`} />
            <Tile test="topups" label="Top ups" value={dollars(t.byKind.topup.micros)} sub={`${num(t.byKind.topup.count)} paid in ShelbyUSD${t.openHolds.count ? `. ${num(t.openHolds.count)} open ${t.openHolds.count === 1 ? "hold" : "holds"}, ${dollars(t.openHolds.micros)}` : ""}`} />
          </div>

          <Panel title="Prices" hint={<>For each action: what one unit costs VideoMind, the suggested price (that cost plus the platform fee) and the price users pay now. The cost is <b className="font-medium text-paper-2">exact</b> when the provider bills exactly that unit, <b className="font-medium text-paper-2">measured</b> from the last 30 days once an action has enough use, and otherwise a <b className="font-medium text-paper-2">starting estimate</b> you can edit. Provider prices are on <Link href="/costs" className="underline hover:text-paper">Costs</Link>. Nothing changes for users until you apply a suggestion or save a price, and a new price applies to actions started after that.</>}>
            <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
              <Fee feeBps={o.pricing.feeBps} onError={(m) => { setDone(null); setErr(m); }} onSaved={(m) => void refresh(m)} />
              <div className="flex items-center gap-3 flex-wrap">
                {o.pricing.belowCost.length > 0 && (
                  <span className={clsx("text-[13px]", o.settings.charging ? "text-error" : "text-dim")} data-below-count>
                    {o.pricing.belowCost.length} {o.pricing.belowCost.length === 1 ? "price is" : "prices are"} below cost{o.settings.charging ? "" : " (charging is off, so everything is free now)"}
                  </span>
                )}
                {(() => {
                  const differ = o.pricing.rows.filter((r) => r.suggestedMicros != null && r.suggestedMicros !== r.priceMicros).length;
                  return (
                    <button onClick={() => void applyAll(differ)} disabled={busy || differ === 0} className="btn btn-ghost h-9 px-3.5" data-apply-all>
                      {differ === 0 ? "Every price is at its suggestion" : `Apply all suggestions (${differ})`}
                    </button>
                  );
                })()}
              </div>
            </div>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-[13.5px] min-w-[980px]" data-credit-prices>
                <thead><tr className="text-left text-dim border-b border-rule"><th className="font-normal py-2.5 px-4">Action</th><th className="font-normal py-2.5 pr-4">Cost to VideoMind, per unit</th><th className="font-normal py-2.5 pr-4">Suggested, with {o.pricing.feeBps / 100}% fee</th><th className="font-normal py-2.5 pr-4">Price now</th><th className="font-normal py-2.5 pr-4">Margin</th></tr></thead>
                <tbody>{o.prices.map((p) => (
                  <PriceRow key={p.id} p={p} row={o.pricing.rows.find((r) => r.action === p.id)} est={o.estimates.find((e) => e.id === p.id)} charging={o.settings.charging}
                    onError={(m) => { setDone(null); setErr(m); }} onSaved={(m) => void refresh(m)} />
                ))}</tbody>
              </table>
            </div>
          </Panel>

          <ThisMonth o={o} />

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Welcome credits" hint="Given once to every wallet, the first time it opens its Wallet page or starts a paid action. Changing it does not change what wallets got before. 0 means none.">
              <div className="flex items-end gap-3 flex-wrap">
                <label className="text-[13px] text-dim flex flex-col gap-1">US dollars<input value={welcome} onChange={(e) => setWelcomeV(e.target.value)} inputMode="decimal" className="h-9 px-3 text-[13.5px] w-32 tabular-nums" data-credit-welcome /></label>
                <button onClick={() => void saveWelcome()} disabled={busy || welcome.trim() === asInput(o.settings.welcomeMicros)} className="btn btn-ghost h-9 px-3.5">Save</button>
              </div>
            </Panel>

            <Panel title="Storage on VideoMind" id="storage" hint={<>Files VideoMind keeps for a video (the original, its pictures and sound, clips) are charged once a day, a thirtieth of the storage price above, for what each owner keeps above the free amount. A public video on Shelby only no longer counts its original. What a wallet cannot pay is owed and paid first from its next credits. After {o.storage.graceDays} days owed, its videos kept here stop playing (a public video also on Shelby plays from there) and new uploads wait. Nothing is deleted. Nothing is charged while charging is off or the price is 0.</>}>
              <div className="text-[13.5px] text-paper-2 space-y-1 mb-3" data-credit-storage>
                <p>{gb(o.storage.totalBytes)} kept by {num(o.storage.owners)} {o.storage.owners === 1 ? "owner" : "owners"}{(() => { const p = o.prices.find((p) => p.id === "storage"); return p && p.microsPerUnit > 0 && o.settings.charging ? `, charged at ${dollars(p.microsPerUnit, true)} per GB month` : ", not charged now"; })()}.</p>
                {o.storage.walletsOwing > 0
                  ? <p className={o.storage.walletsPaused ? "text-warn" : ""}>{dollars(o.storage.owedMicros, true)} owed by {num(o.storage.walletsOwing)} {o.storage.walletsOwing === 1 ? "wallet" : "wallets"}{o.storage.walletsPaused ? `, ${num(o.storage.walletsPaused)} paused` : ""}. Forgive it from a user&rsquo;s page.</p>
                  : <p className="text-dim">Nothing owed.</p>}
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <label className="text-[13px] text-dim flex flex-col gap-1">Free per owner, GB<input value={freeGb} onChange={(e) => setFreeGb(e.target.value)} inputMode="decimal" className="h-9 px-3 text-[13.5px] w-32 tabular-nums" data-credit-free-gb /></label>
                <button onClick={() => void saveFree()} disabled={busy || freeGb.trim() === String(o.storage.freeBytes / o.storage.gbBytes)} className="btn btn-ghost h-9 px-3.5">Save</button>
              </div>
            </Panel>

            <Panel title="Give or remove credits" hint="Giving adds free credits. Removing takes back at most what the wallet has free. Both are written in the ledger with your email and the note.">
              <div className="space-y-3">
                <label className="text-[13px] text-dim flex flex-col gap-1">Wallet address<input value={wallet} onChange={(e) => setWallet(e.target.value)} spellCheck={false} autoComplete="off" placeholder="0x..." className="h-9 px-3 text-[13px] tc w-full" data-credit-wallet /></label>
                <div className="flex items-end gap-3 flex-wrap">
                  <label className="text-[13px] text-dim flex flex-col gap-1">US dollars<input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="5" className="h-9 px-3 text-[13.5px] w-28 tabular-nums" data-credit-amount /></label>
                  <label className="text-[13px] text-dim flex flex-col gap-1 flex-1 min-w-[160px]">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Beta tester" className="h-9 px-3 text-[13.5px] w-full" /></label>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void change("grant")} disabled={busy} className="btn btn-ghost h-9 px-3.5" data-credit-give>Give</button>
                  <button onClick={() => void change("remove")} disabled={busy} className="btn btn-ghost h-9 px-3.5">Remove</button>
                </div>
              </div>
            </Panel>
          </div>

          <Panel title="Ledger" hint="Every change to a balance, newest first. Rows are never changed or deleted: a mistake is put right with a new row.">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <input value={fWallet} onChange={(e) => setFWallet(e.target.value)} spellCheck={false} placeholder="Filter by wallet address" aria-label="Filter by wallet address" className="h-9 px-3 text-[13px] tc w-full max-w-[420px]" />
              <select value={fKind} onChange={(e) => setFKind(e.target.value as CreditKind | "")} aria-label="Kind" className="h-9 px-2.5 text-[13.5px]">
                <option value="">Every kind</option>
                {Object.entries(CREDIT_KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            {!rows ? <p className="text-[13.5px] text-dim">Loading</p> : rows.length === 0 ? <p className="text-[13.5px] text-dim">No rows{fWallet || fKind ? " match" : " yet"}.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px] min-w-[760px]" data-credit-ledger>
                  <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">When</th><th className="font-normal py-1.5 pr-4">Wallet</th><th className="font-normal py-1.5 pr-4">Kind</th><th className="font-normal py-1.5 pr-4">What</th><th className="font-normal py-1.5 pr-4 text-right">Amount</th><th className="font-normal py-1.5 pr-4">By</th><th className="py-1.5" /></tr></thead>
                  <tbody>{rows.map((e) => (
                    <tr key={e.id} className="border-t border-rule align-top" data-credit-row={e.kind}>
                      <td className="py-1.5 pr-4 text-paper-2 whitespace-nowrap">{when(e.at)}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap"><Link href={`/users/${e.wallet}`} className="tc text-paper-2 hover:text-signal">{short(e.wallet)}</Link></td>
                      <td className="py-1.5 pr-4 text-paper-2 whitespace-nowrap">{CREDIT_KINDS[e.kind] ?? e.kind}{e.refunded && <span className="text-dim"> (refunded)</span>}</td>
                      <td className="py-1.5 pr-4 max-w-[280px]"><What e={e} /></td>
                      <td className={clsx("py-1.5 pr-4 text-right tabular-nums whitespace-nowrap", e.amountMicros < 0 ? "text-paper-2" : "text-marker")}>{e.amountMicros > 0 ? "+" : ""}{dollars(e.amountMicros, true)}</td>
                      <td className="py-1.5 pr-4 text-dim whitespace-nowrap">{e.adminEmail ?? (e.kind === "charge" || e.kind === "welcome" ? "VideoMind" : "-")}</td>
                      <td className="py-1.5 text-right">{e.kind === "charge" && !e.refunded && <button onClick={() => void refund(e)} className="btn btn-ghost h-8 px-3 text-[13px] no-min">Refund</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {next && <button onClick={() => void loadLedger(next)} className="btn btn-ghost h-9 px-3.5 mt-3">Show older</button>}
          </Panel>
        </div>
      )}
    </div>
  );
}
