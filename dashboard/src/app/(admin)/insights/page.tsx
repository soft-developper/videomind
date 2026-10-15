"use client";
// vm_insights: Insights, like Atlassian Administration's Insights. Usage
// across the site over time, the most watched videos, and the audit log of
// every admin sign in and action. Days are UTC.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import {
  ApiError, getInsights, getTopVideos, getAudit,
  type InsightMetric, type InsightRange, type InsightSeries, type TopVideo, type AuditPage, type AuditEntry,
} from "@/lib/api";
import { actionLabel, featureLabel } from "@/lib/actions";
import { num, tokens, when, short } from "@/lib/format";

const BAR = "#9C8327";
const BAR_ON = "var(--signal)";
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not load. Try again.");

const METRICS: Array<[InsightMetric, string, string]> = [
  ["views", "Views", "views"], ["watch_minutes", "Watch time", "minutes watched"], ["new_wallets", "New wallets", "new wallets"],
  ["uploads", "Uploads", "uploads"], ["transcribed_minutes", "Minutes transcribed", "minutes transcribed"],
  ["ai_tokens", "AI tokens", "AI tokens"], ["live_events", "Live events", "live events"],
];
const RANGES: Array<[InsightRange, string, string]> = [[7, "7 days", "the 7 days before"], [28, "28 days", "the 28 days before"], [90, "90 days", "the 90 days before"], [365, "12 months", "the year before"]];
const value = (m: InsightMetric, x: number) => (m === "ai_tokens" ? tokens(x) : num(x));
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString([], { ...opts, timeZone: "UTC" });

/** Days for 7 and 28, weeks for 90, months for 12 months (as in the site's Analytics). */
function buckets(s: InsightSeries) {
  type Row = { key: string; label: string; long: string; value: number };
  if (s.days <= 28) return { unit: "day", rows: s.points.map((p): Row => ({ key: p.day, label: dayLabel(p.day), long: dayLabel(p.day, { weekday: "short", day: "numeric", month: "short", year: "numeric" }), value: p.value })) };
  if (s.days <= 90) {
    const rows: Row[] = [];
    for (let i = 0; i < s.points.length; i += 7) {
      const part = s.points.slice(i, i + 7);
      const first = part[0].day, last = part[part.length - 1].day;
      rows.push({ key: first, label: dayLabel(first), long: `${dayLabel(first)} to ${dayLabel(last)}`, value: part.reduce((x, p) => x + p.value, 0) });
    }
    return { unit: "week", rows };
  }
  const by = new Map<string, Row>();
  for (const p of s.points) {
    const k = p.day.slice(0, 7);
    const row = by.get(k) ?? { key: k, label: dayLabel(`${k}-01`, { month: "short" }), long: dayLabel(`${k}-01`, { month: "long", year: "numeric" }), value: 0 };
    row.value += p.value; by.set(k, row);
  }
  return { unit: "month", rows: Array.from(by.values()) };
}

function Radio<T extends string | number>({ value: v, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md border border-rule p-0.5 bg-slate">
      {options.map(([k, l]) => <button key={String(k)} role="radio" aria-checked={v === k} onClick={() => onChange(k)} className={clsx("h-8 px-3 rounded text-[13px] no-min", v === k ? "bg-slate-2 text-paper" : "text-dim hover:text-paper")}>{l}</button>)}
    </div>
  );
}

function Chart({ s, what }: { s: InsightSeries; what: string }) {
  const { unit, rows } = useMemo(() => buckets(s), [s]);
  const [on, setOn] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const top = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const tip = on !== null ? rows[on] : null;
  const ticks = [0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter((x, i, all) => all.indexOf(x) === i);
  return (
    <section className="panel p-4 sm:p-5 space-y-4 min-w-0" aria-label={`${what} per ${unit}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="font-display text-[17px] text-paper first-letter:uppercase">{what} per {unit}</h2>
        <button onClick={() => setTable((t) => !t)} className="btn btn-ghost h-8 px-3 text-[13px]" aria-pressed={table}>{table ? "Show the chart" : "Show the numbers"}</button>
      </div>
      {table ? (
        <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
          <table className="w-full text-[13.5px]" data-in-table>
            <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">{unit === "day" ? "Day" : unit === "week" ? "Week starting" : "Month"}</th><th className="font-normal py-1.5 text-right first-letter:uppercase">{what}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.key} className="border-t border-rule"><td className="py-1.5 pr-4 text-paper-2">{r.long}</td><td className="py-1.5 text-right tabular-nums text-paper">{value(s.metric, r.value)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex gap-2">
            <div className="flex flex-col justify-between text-[11.5px] text-dim tabular-nums h-[180px] text-right shrink-0 w-9" aria-hidden>
              <span className="-mt-1.5">{value(s.metric, top)}</span><span className="-mb-1.5">0</span>
            </div>
            <div className="relative flex-1 min-w-0">
              <div className="absolute inset-x-0 top-0 border-t border-dashed border-rule" aria-hidden />
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-rule/60" aria-hidden />
              <div className="relative h-[180px] flex items-end border-b border-rule-lit" role="img"
                aria-label={`${what} per ${unit}, ${rows.length} ${unit}s, ${value(s.metric, s.total)} in all. Use Show the numbers for the table.`}
                onMouseLeave={() => setOn(null)}>
                {rows.map((r, i) => (
                  <div key={r.key} className="flex-1 h-full flex items-end justify-center" style={{ padding: "0 1px" }} onMouseEnter={() => setOn(i)} onTouchStart={() => setOn(i)} data-in-bar={r.value}>
                    <div className="w-full max-w-[28px] rounded-t-[4px]" style={{ height: r.value ? `${Math.max(2, (r.value / top) * 100)}%` : 0, background: on === i ? BAR_ON : BAR }} />
                  </div>
                ))}
              </div>
              <div className="relative h-5 mt-1 text-[11.5px] text-dim" aria-hidden>
                {ticks.map((i) => <span key={i} className="absolute top-0 whitespace-nowrap" style={i === 0 ? { left: 0 } : i === rows.length - 1 ? { right: 0 } : { left: `${((i + 0.5) / rows.length) * 100}%`, transform: "translateX(-50%)" }}>{rows[i].label}</span>)}
              </div>
              {tip && (
                <div className="absolute top-0 z-10 pointer-events-none panel bg-slate-2 px-3 py-2 text-[12.5px] whitespace-nowrap shadow-lg" data-in-tip
                  style={on! < rows.length / 2 ? { left: `${((on! + 1) / rows.length) * 100}%`, marginLeft: 6 } : { right: `${((rows.length - on!) / rows.length) * 100}%`, marginRight: 6 }}>
                  <p className="text-dim">{tip.long}</p>
                  <p className="text-paper tabular-nums mt-0.5">{value(s.metric, tip.value)} {what}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Change({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before) return <p className="text-[12.5px] text-dim mt-1">{now ? `None in ${label}` : "None yet"}</p>;
  const pct = Math.round(((now - before) / before) * 100);
  return <p className="text-[12.5px] text-dim mt-1">{pct === 0 ? "Same as" : `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% on`} {label}</p>;
}

function Usage() {
  const { signedOut } = useAdmin();
  const [metric, setMetric] = useState<InsightMetric>("views");
  const [days, setDays] = useState<InsightRange>(28);
  const [s, setS] = useState<InsightSeries | null>(null);
  const [top, setTop] = useState<TopVideo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setErr(null);
    Promise.all([getInsights(metric, days), getTopVideos(days)]).then(([a, b]) => { if (live) { setS(a); setTop(b.videos); } }, (e) => {
      if (e instanceof ApiError && e.status === 401) return signedOut();
      if (live) setErr(msg(e));
    });
    return () => { live = false; };
  }, [metric, days, signedOut]);
  const m = METRICS.find((x) => x[0] === metric)!;
  const r = RANGES.find((x) => x[0] === days)!;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[13px] text-dim flex items-center gap-2">Show
          <select value={metric} onChange={(e) => setMetric(e.target.value as InsightMetric)} className="h-9 px-2.5 text-[13.5px]" aria-label="Measure">
            {METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <Radio label="Period" value={days} onChange={setDays} options={RANGES.map(([k, l]) => [k, l] as [InsightRange, string])} />
      </div>
      {err && <Note kind="error">{err}</Note>}
      {!s && !err && <p className="text-[14px] text-dim">Loading</p>}
      {s && s.metric === metric && (
        <>
          <div className="panel p-4 max-w-[320px]" data-in-total>
            <p className="stat-label !mt-0">{m[1]}, last {r[1]}</p>
            <p className="stat-value mt-1.5" data-in-value>{value(metric, s.total)}</p>
            <Change now={s.total} before={s.previous} label={r[2]} />
          </div>
          <Chart s={s} what={m[2]} />
          <div className="grid lg:grid-cols-2 gap-5">
            <section className="panel panel-pad min-w-0" aria-label="Use by feature">
              <div className="panel-head"><h2 className="panel-head-title">Use by feature, last {r[1]}</h2></div>
              {s.features.length === 0 ? <p className="text-[13.5px] text-dim">No AI or transcription use in this period.</p> : (
                <table className="w-full text-[13.5px]" data-in-features>
                  <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">Feature</th><th className="font-normal py-1.5 pr-4 text-right">Audio</th><th className="font-normal py-1.5 text-right">AI tokens</th></tr></thead>
                  <tbody>{s.features.map((f) => (
                    <tr key={f.feature} className="border-t border-rule"><td className="py-1.5 pr-4 text-paper-2">{featureLabel(f.feature)}</td><td className="py-1.5 pr-4 text-right tabular-nums text-paper-2">{f.audioMinutes ? `${num(f.audioMinutes)} min` : "-"}</td><td className="py-1.5 text-right tabular-nums text-paper">{f.tokens ? tokens(f.tokens) : "-"}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>
            <section className="panel panel-pad min-w-0" aria-label="Most watched videos">
              <div className="panel-head"><h2 className="panel-head-title">Most watched, last {r[1]}</h2></div>
              {!top ? <p className="text-[13.5px] text-dim">Loading</p> : top.length === 0 ? <p className="text-[13.5px] text-dim">No views in this period.</p> : (
                <ol className="space-y-1.5" data-in-top>
                  {top.map((v, i) => (
                    <li key={v.id} className="flex items-center gap-3 text-[13.5px] min-w-0" data-in-top-row={v.id}>
                      <span className="w-5 text-dim tabular-nums text-right shrink-0">{i + 1}</span>
                      <Link href={`/content/videos/${v.id}`} className="text-paper hover:text-signal truncate min-w-0">{v.title || "Untitled"}</Link>
                      {v.removed && <span className="badge shrink-0">Taken down</span>}
                      <span className="ml-auto text-dim truncate max-w-[30%] hidden sm:block">{v.ownerName ?? (v.owner ? short(v.owner) : "")}</span>
                      <span className="tabular-nums text-paper-2 shrink-0 w-24 text-right">{num(v.views)} {v.views === 1 ? "view" : "views"}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <p className="text-[12.5px] text-dim">Days are counted in UTC. Views are counted since the site began counting them, and AI use since the usage ledger began; older activity cannot be rebuilt.</p>
        </>
      )}
    </div>
  );
}

function detailText(e: AuditEntry): string {
  if (!e.detail || typeof e.detail !== "object") return e.detail ? String(e.detail) : "";
  return Object.entries(e.detail as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ");
}

function Audit() {
  const { signedOut } = useAdmin();
  const [action, setAction] = useState("");
  const [email, setEmail] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<AuditPage | null>(null);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (before: number | null) => {
    setBusy(true); setErr(null);
    try {
      const p = await getAudit({ action, email, q: query, before });
      setPage(p); setRows((old) => (before ? [...old, ...p.entries] : p.entries));
    } catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
    finally { setBusy(false); }
  }, [action, email, query, signedOut]);
  useEffect(() => { void load(null); }, [load]);
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-dim max-w-[80ch]">Every admin sign in and every action taken in the dashboard, newest first. Kept in the database; nothing here is deleted.</p>
      <form className="flex items-center gap-3 flex-wrap" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <select value={action} onChange={(e) => setAction(e.target.value)} className="h-9 px-2.5 text-[13.5px]" aria-label="Action">
          <option value="">Every action</option>
          {page?.actions.map((a) => <option key={a.action} value={a.action}>{actionLabel(a.action)} ({num(a.count)})</option>)}
        </select>
        <select value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 px-2.5 text-[13.5px]" aria-label="Admin">
          <option value="">Every admin</option>
          {page?.admins.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the target or details" className="h-9 px-3 text-[13.5px] w-full sm:w-64" aria-label="Search the log" />
        <button type="submit" className="btn btn-ghost h-9 px-3.5">Search</button>
      </form>
      {err && <Note kind="error">{err}</Note>}
      {!page && !err && <p className="text-[14px] text-dim">Loading</p>}
      {page && rows.length === 0 && <p className="text-[14px] text-dim py-6">Nothing matches.</p>}
      {rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[760px]" data-audit>
            <thead><tr className="text-left text-dim border-b border-rule"><th className="font-normal py-2.5 px-4">When</th><th className="font-normal py-2.5 pr-4">Admin</th><th className="font-normal py-2.5 pr-4">Action</th><th className="font-normal py-2.5 pr-4">On</th><th className="font-normal py-2.5 pr-4">Details</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-rule last:border-0 align-top" data-audit-row={e.action}>
                  <td className="py-2 px-4 text-paper-2 whitespace-nowrap tabular-nums">{when(e.at)}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{e.email ?? <span className="text-dim">-</span>}</td>
                  <td className={clsx("py-2 pr-4 whitespace-nowrap", /fail|lock/.test(e.action) ? "text-error" : "text-paper")}>{actionLabel(e.action)}</td>
                  <td className="py-2 pr-4 max-w-[200px] truncate">
                    {e.target && e.action.startsWith("video_") ? <Link href={`/content/videos/${e.target}`} className="text-paper-2 underline hover:text-paper">Open the video</Link>
                      : e.target && e.action.startsWith("user_") ? <Link href={`/users/${e.target}`} className="text-paper-2 underline hover:text-paper tc">{short(e.target)}</Link>
                      : <span className="text-dim tc">{e.target ? short(e.target) : "-"}</span>}
                  </td>
                  <td className="py-2 pr-4 text-dim text-[12.5px] break-words max-w-[360px]">{detailText(e) || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page?.next && <button onClick={() => void load(page.next)} disabled={busy} className="btn btn-ghost h-9 px-3.5" data-audit-more>{busy ? "Loading" : "Show older entries"}</button>}
    </div>
  );
}

type Tab = "usage" | "audit";
export default function InsightsPage() {
  const [tab, setTab] = useState<Tab>("usage");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "audit") setTab("audit"); }, []);
  const pick = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "usage") url.searchParams.delete("tab"); else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  return (
    <div className="section py-6 lg:py-8">
      <h1 className="font-display text-[22px] text-paper">Insights</h1>
      <p className="text-[14px] text-dim mt-1 mb-5">Use of VideoMind over time, and the audit log.</p>
      <div role="tablist" aria-label="Insights" className="flex gap-1 border-b border-rule mb-5 overflow-x-auto">
        {([["usage", "Usage over time"], ["audit", "Audit log"]] as Array<[Tab, string]>).map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => pick(t)} className={clsx("h-10 px-3 text-[13.5px] border-b-2 -mb-px whitespace-nowrap no-min", tab === t ? "border-signal text-paper" : "border-transparent text-dim hover:text-paper")}>{l}</button>)}
      </div>
      {tab === "usage" ? <Usage /> : <Audit />}
    </div>
  );
}
