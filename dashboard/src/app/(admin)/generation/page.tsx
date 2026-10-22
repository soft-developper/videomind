"use client";
// vm_generate: Generation (Part 17b). Who may make videos from a prompt,
// the day's budget in real money (providers bill VideoMind, not the user),
// which models are offered and what they cost VideoMind per second, and the
// latest generations. The price users pay in credits is on Credits.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import {
  ApiError, getGeneration, setGeneration, setGenModel, allowGeneration, disallowGeneration,
  type GenerationOverview, type GenAccess, type GenModel,
} from "@/lib/api";
import { num, when, short } from "@/lib/format";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");
const usd = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const ACCESS: Record<GenAccess, { label: string; hint: string }> = {
  off: { label: "Off", hint: "Nobody can generate." },
  allowlist: { label: "Listed wallets", hint: "Only the wallets below." },
  everyone: { label: "Everyone", hint: "Every signed in wallet." },
};
const KEY: Record<string, string> = { fal: "FAL_KEY", google: "GEMINI_API_KEY" };

function Panel({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <section className="panel panel-pad min-w-0" aria-label={title}>
      <div className="panel-head"><h2 className="panel-head-title">{title}</h2></div>
      {hint && <p className="text-[13px] text-dim -mt-1 mb-3 max-w-[80ch]">{hint}</p>}
      {children}
    </section>
  );
}

function ModelRow({ m, onSaved, onError }: { m: GenModel; onSaved: (text: string) => void; onError: (e: unknown) => void }) {
  const [cost, setCost] = useState(String(m.costUsdPerSecond));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCost(String(m.costUsdPerSecond)); }, [m]);
  const save = async (body: { enabled?: boolean; costUsdPerSecond?: string }, text: string) => {
    setBusy(true);
    try { await setGenModel(m.id, body); onSaved(text); } catch (e) { onError(e); } finally { setBusy(false); }
  };
  return (
    <tr className="border-b border-rule last:border-0 align-top" data-gen-model={m.id}>
      <td className="py-2 px-4">
        <p className="text-paper">{m.label}</p>
        <p className="text-[12.5px] text-dim">{m.provider === "fal" ? "fal" : "Google"}, {m.resolution}, {m.minSeconds === m.maxSeconds ? `${m.maxSeconds} s` : `${m.minSeconds} to ${m.maxSeconds} s`}</p>
        {m.note && <p className="text-[12px] text-dim">{m.note}</p>}
      </td>
      <td className="py-2 pr-4 text-[13px]">
        {m.ready ? <span className="text-marker">Key set</span> : <span className="text-warn">{KEY[m.provider]} not set on Render</span>}
      </td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-1.5">
          <span className="text-dim">$</span>
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className="h-8 px-2 w-20 text-[13.5px] tabular-nums" aria-label={`Cost per second for ${m.label}`} />
          <span className="text-dim text-[12.5px]">a second</span>
          <button disabled={busy || cost.trim() === String(m.costUsdPerSecond)} onClick={() => void save({ costUsdPerSecond: cost.trim() }, `The cost of ${m.label} was saved.`)} className="btn btn-ghost h-8 px-3 text-[13px] no-min">Save</button>
        </div>
      </td>
      <td className="py-2 pr-4 text-right">
        <button disabled={busy} onClick={() => void save({ enabled: !m.enabled }, `${m.label} is ${m.enabled ? "off" : "on"}.`)} className={clsx("btn h-8 px-3 text-[13px] no-min", m.enabled ? "btn-ghost" : "btn-signal")} data-gen-toggle={m.id}>
          {m.enabled ? "Turn off" : "Turn on"}
        </button>
      </td>
    </tr>
  );
}

export default function GenerationPage() {
  const { signedOut } = useAdmin();
  const [o, setO] = useState<GenerationOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) return signedOut(); setDone(null); setErr(msg(e)); }, [signedOut]);
  const load = useCallback(async () => {
    try { const r = await getGeneration(); setO(r); setBudget(String(r.settings.dailyUsd)); } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => { void load(); }, [load]);
  const refresh = async (text: string) => { setErr(null); await load(); setDone(text); };
  const act = async (fn: () => Promise<string>) => { setBusy(true); try { await refresh(await fn()); } catch (e) { fail(e); } finally { setBusy(false); } };

  const setAccess = (access: GenAccess) => {
    if (access === "everyone" && !window.confirm("Open video generation to every signed in wallet? Each video costs VideoMind real money, up to the daily budget.")) return;
    void act(async () => { await setGeneration({ access }); return `Video generation: ${ACCESS[access].label.toLowerCase()}.`; });
  };
  const saveBudget = () => {
    const x = Number(budget);
    if (budget.trim() === "" || !Number.isFinite(x) || x < 0) return fail(new ApiError("Write the budget as a number of US dollars, for example 5.", 400));
    void act(async () => { const s = await setGeneration({ dailyUsd: budget.trim() }); return `The daily budget is now ${usd(s.dailyUsd)}.`; });
  };

  return (
    <div className="section py-6 lg:py-8">
      <h1 className="font-display text-[22px] text-paper">Generation</h1>
      <p className="text-[14px] text-dim mt-1 mb-5 max-w-[80ch]">Videos made from a prompt. The provider bills VideoMind in real money for every video; users pay with credits at the price on <Link href="/credits" className="underline hover:text-paper">Credits</Link> (Generating a video, per second). A finished video is processed like an upload.</p>
      {err && <div className="mb-4"><Note kind="error">{err}</Note></div>}
      {done && <div className="mb-4"><Note kind="ok">{done}</Note></div>}
      {!o && !err && <p className="text-[14px] text-dim">Loading</p>}
      {o && (
        <div className="space-y-5">
          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Who can generate">
              <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Who can generate" data-gen-access={o.settings.access}>
                {(Object.keys(ACCESS) as GenAccess[]).map((a) => (
                  <button key={a} role="radio" aria-checked={o.settings.access === a} disabled={busy} onClick={() => o.settings.access !== a && setAccess(a)}
                    className={clsx("btn h-9 px-3.5 text-[13.5px]", o.settings.access === a ? "btn-signal" : "btn-ghost")}>{ACCESS[a].label}</button>
                ))}
              </div>
              <p className="text-[13px] text-dim mt-2">{ACCESS[o.settings.access].hint}</p>
            </Panel>
            <Panel title="Daily budget" hint="The most VideoMind spends at the providers in one day (UTC), counted from the cost per second below. Past it, new generations wait until tomorrow.">
              <p className="text-[13.5px] text-paper-2 mb-3" data-gen-spent>Spent today: <span className="tabular-nums text-paper">{usd(o.spentTodayUsd)}</span> of {usd(o.settings.dailyUsd)}</p>
              <div className="flex items-end gap-3 flex-wrap">
                <label className="text-[13px] text-dim flex flex-col gap-1">US dollars a day<input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" className="h-9 px-3 text-[13.5px] w-32 tabular-nums" data-gen-budget /></label>
                <button onClick={saveBudget} disabled={busy || budget.trim() === String(o.settings.dailyUsd)} className="btn btn-ghost h-9 px-3.5">Save</button>
              </div>
            </Panel>
          </div>

          <Panel title="Models" hint="A model needs its provider's key on Render. The cost is what the provider charges VideoMind per second; it counts against the daily budget and shows next to the user price on Credits.">
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-[13.5px] min-w-[720px]" data-gen-models>
                <thead><tr className="text-left text-dim border-b border-rule"><th className="font-normal py-2.5 px-4">Model</th><th className="font-normal py-2.5 pr-4">Key</th><th className="font-normal py-2.5 pr-4">Cost to VideoMind</th><th className="py-2.5 pr-4" /></tr></thead>
                <tbody>{o.models.map((m) => <ModelRow key={m.id} m={m} onSaved={(t) => void refresh(t)} onError={fail} />)}</tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Listed wallets" hint="Used when Who can generate is Listed wallets.">
            <div className="flex gap-2 flex-wrap mb-3">
              <input value={wallet} onChange={(e) => setWallet(e.target.value)} spellCheck={false} placeholder="0x..." aria-label="Wallet address" className="h-9 px-3 text-[13px] tc flex-1 min-w-[240px]" data-gen-wallet />
              <button disabled={busy || !wallet.trim()} onClick={() => void act(async () => { const r = await allowGeneration(wallet.trim()); setWallet(""); return `${short(r.wallet)} can generate.`; })} className="btn btn-ghost h-9 px-3.5">Add</button>
            </div>
            {o.allowlist.length === 0 ? <p className="text-[13.5px] text-dim">No wallets yet.</p> : (
              <ul className="divide-y divide-rule text-[13.5px]" data-gen-allowlist>
                {o.allowlist.map((a) => (
                  <li key={a.wallet} className="flex items-center gap-3 py-1.5">
                    <Link href={`/users/${a.wallet}`} className="tc text-paper-2 hover:text-signal">{short(a.wallet)}</Link>
                    <span className="text-dim text-[12.5px]">added {when(a.createdAt)}{a.addedBy ? ` by ${a.addedBy}` : ""}</span>
                    <button disabled={busy} onClick={() => void act(async () => { await disallowGeneration(a.wallet); return `${short(a.wallet)} was removed.`; })} className="btn btn-ghost h-8 px-3 text-[13px] no-min ml-auto">Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Latest generations" hint={`In the last 30 days: ${num(o.last30.videos)} ${o.last30.videos === 1 ? "video" : "videos"}, ${num(o.last30.seconds)} seconds, ${usd(o.last30.costUsd)} at the providers.`}>
            {o.recent.length === 0 ? <p className="text-[13.5px] text-dim">None yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px] min-w-[760px]" data-gen-recent>
                  <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">When</th><th className="font-normal py-1.5 pr-4">Wallet</th><th className="font-normal py-1.5 pr-4">Model</th><th className="font-normal py-1.5 pr-4">Prompt</th><th className="font-normal py-1.5 pr-4 text-right">Cost</th><th className="font-normal py-1.5">Status</th></tr></thead>
                  <tbody>{o.recent.map((g) => (
                    <tr key={g.id} className="border-t border-rule align-top">
                      <td className="py-1.5 pr-4 text-paper-2 whitespace-nowrap">{when(g.createdAt)}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap"><Link href={`/users/${g.wallet}`} className="tc text-paper-2 hover:text-signal">{short(g.wallet)}</Link></td>
                      <td className="py-1.5 pr-4 text-paper-2 whitespace-nowrap">{g.model}, {g.seconds} s</td>
                      <td className="py-1.5 pr-4 text-paper-2 max-w-[320px]"><span className="line-clamp-2">{g.prompt}</span></td>
                      <td className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">{usd(g.costUsd)}</td>
                      <td className={clsx("py-1.5 whitespace-nowrap", g.status === "failed" ? "text-error" : g.status === "succeeded" ? "text-marker" : "text-paper-2")} title={g.error ?? undefined}>
                        {g.status === "succeeded" ? <Link href={`/content/videos/${g.videoId}`} className="underline">Made</Link> : g.status === "failed" ? `Failed${g.errorCode ? ` (${g.errorCode.replace(/_/g, " ")})` : ""}` : g.status === "running" ? "Being made" : "Waiting"}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
