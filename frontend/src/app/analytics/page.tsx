"use client";
// vm_analytics: how the signed in wallet's videos and live events are watched.
// Views are counted without cookies and never say who watched (see
// src/lib/useViewCounter.ts and the backend's src/lib/views.ts).
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { clsx } from "clsx";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { getAnalytics, ApiError, type Analytics, type AnalyticsRange, type AnalyticsTotals } from "@/lib/api";
// vm_lang
import { useLocale, useTranslations } from "next-intl";
import { intlLocale, type Locale } from "@/i18n/config";

const RANGES: AnalyticsRange[] = [7, 28, 90, 365];
type T = ReturnType<typeof useTranslations<"analytics">>;
/** The bars: a darker step of the signal yellow that reads on the panel; the bar pointed at is the full yellow. */
const BAR = "#9C8327";
const BAR_ON = "var(--signal)";

/** Numbers, lengths and dates in the reader's language. */
function useFmt() {
  const il = intlLocale(useLocale() as Locale);
  return useMemo(() => {
    const num = new Intl.NumberFormat(il);
    const unit = (v: number, u: "hour" | "minute" | "second") => new Intl.NumberFormat(il, { style: "unit", unit: u, unitDisplay: "short" }).format(v);
    return {
      n: (x: number) => num.format(x),
      /** 3725 -> "1 h 2 min", 200 -> "3 min 20 s", 0 -> "0 s" */
      span: (sec: number): string => {
        const s = Math.round(sec);
        if (s < 60) return unit(s, "second");
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
        if (h) return m ? `${unit(h, "hour")} ${unit(m, "minute")}` : unit(h, "hour");
        return r && m < 10 ? `${unit(m, "minute")} ${unit(r, "second")}` : unit(m, "minute");
      },
      day: (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
        new Intl.DateTimeFormat(il, { ...opts, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)),
      date: (ms: number) => new Intl.DateTimeFormat(il, { dateStyle: "medium" }).format(new Date(ms)),
    };
  }, [il]);
}
type Fmt = ReturnType<typeof useFmt>;
const avg = (t: AnalyticsTotals) => (t.views ? t.watchSeconds / t.views : 0);
const endRate = (t: AnalyticsTotals) => (t.views ? Math.round((t.ended / t.views) * 100) : 0);

/** Days for 7 and 28, weeks for 90, months for 12 months. */
function buckets(a: Analytics, fm: Fmt, t: T) {
  const dayLabel = fm.day;
  if (a.days <= 28) return { unit: "day" as const, rows: a.daily.map((d) => ({ key: d.day, label: dayLabel(d.day), long: dayLabel(d.day, { weekday: "short", day: "numeric", month: "short", year: "numeric" }), views: d.views, watchSeconds: d.watchSeconds })) };
  if (a.days <= 90) {
    const rows: Array<{ key: string; label: string; long: string; views: number; watchSeconds: number }> = [];
    for (let i = 0; i < a.daily.length; i += 7) {
      const part = a.daily.slice(i, i + 7);
      const first = part[0].day, last = part[part.length - 1].day;
      rows.push({ key: first, label: dayLabel(first), long: t("fromTo", { from: dayLabel(first), to: dayLabel(last) }), views: part.reduce((x, d) => x + d.views, 0), watchSeconds: part.reduce((x, d) => x + d.watchSeconds, 0) });
    }
    return { unit: "week" as const, rows };
  }
  const by = new Map<string, { key: string; label: string; long: string; views: number; watchSeconds: number }>();
  for (const d of a.daily) {
    const k = d.day.slice(0, 7);
    const row = by.get(k) ?? { key: k, label: dayLabel(`${k}-01`, { month: "short" }), long: dayLabel(`${k}-01`, { month: "long", year: "numeric" }), views: 0, watchSeconds: 0 };
    row.views += d.views; row.watchSeconds += d.watchSeconds; by.set(k, row);
  }
  return { unit: "month" as const, rows: Array.from(by.values()) };
}

function Change({ now, before, days }: { now: number; before: number; days: AnalyticsRange }) {
  const t = useTranslations("analytics");
  const period = t(`before.${days}`);
  if (!before) return <p className="text-[12.5px] text-dim mt-1">{now ? t("noneIn", { period }) : "\u00a0"}</p>;
  const pct = Math.round(((now - before) / before) * 100);
  return <p className="text-[12.5px] text-dim mt-1">{pct === 0 ? t("same", { period }) : pct > 0 ? t("up", { pct, period }) : t("down", { pct: Math.abs(pct), period })}</p>;
}

function Tile({ label, value, children, test }: { label: string; value: string; children?: React.ReactNode; test: string }) {
  return (
    <div className="panel p-4 min-w-0">
      <p className="text-[12.5px] text-dim">{label}</p>
      <p className="font-display text-[24px] text-paper mt-1 leading-none tabular-nums" {...{ [`data-an-${test}`]: "" }}>{value}</p>
      {children}
    </div>
  );
}

function Panel({ title, hint, children, action }: { title: string; hint?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="panel p-4 sm:p-5 space-y-4 min-w-0" aria-label={title}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] text-paper">{title}</h2>
          {hint && <p className="text-[13px] text-dim mt-1 leading-relaxed max-w-[68ch]">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ViewsChart({ a }: { a: Analytics }) {
  const t = useTranslations("analytics");
  const fm = useFmt();
  const { n, span } = fm;
  const { unit, rows } = useMemo(() => buckets(a, fm, t), [a, fm, t]);
  const [on, setOn] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.views));
  const top = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const tip = on !== null ? rows[on] : null;
  const ticks = [0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter((x, i, all) => all.indexOf(x) === i);
  return (
    <Panel
      title={t(`per.${unit}`)}
      action={<button onClick={() => setTable((x) => !x)} className="btn btn-ghost h-8 px-3 text-[13px]" aria-pressed={table}>{table ? t("showChart") : t("showNumbers")}</button>}
    >
      {table ? (
        <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
          <table className="w-full text-[13.5px]" data-an-table>
            <thead><tr className="text-start text-dim"><th className="font-normal py-1.5 pe-4 text-start">{t(`unitHead.${unit}`)}</th><th className="font-normal py-1.5 pe-4 text-end">{t("views")}</th><th className="font-normal py-1.5 text-end">{t("watchTime")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-rule"><td className="py-1.5 pe-4 text-paper-2">{r.long}</td><td className="py-1.5 pe-4 text-end tabular-nums text-paper">{n(r.views)}</td><td className="py-1.5 text-end tabular-nums text-paper-2">{span(r.watchSeconds)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // Time runs left to right in every language, like the video timeline.
        <div className="relative" dir="ltr">
          <div className="flex gap-2">
            {/* the scale: the top value and zero */}
            <div className="flex flex-col justify-between text-[11.5px] text-dim tabular-nums h-[180px] text-right shrink-0 w-7" aria-hidden>
              <span className="-mt-1.5">{n(top)}</span><span className="-mb-1.5">0</span>
            </div>
            <div className="relative flex-1 min-w-0">
              <div className="absolute inset-x-0 top-0 border-t border-dashed border-rule" aria-hidden />
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-rule/60" aria-hidden />
              <div
                className="relative h-[180px] flex items-end border-b border-rule-lit"
                role="img"
                aria-label={t(`chartLabel.${unit}`, { count: rows.length, total: n(rows.reduce((x, r) => x + r.views, 0)) })}
                onMouseLeave={() => setOn(null)}
              >
                {rows.map((r, i) => (
                  <div
                    key={r.key}
                    className="flex-1 h-full flex items-end justify-center"
                    style={{ padding: "0 1px" }}
                    onMouseEnter={() => setOn(i)}
                    onTouchStart={() => setOn(i)}
                    data-an-bar={r.views}
                  >
                    <div
                      className="w-full max-w-[28px] rounded-t-[4px]"
                      style={{ height: r.views ? `${Math.max(2, (r.views / top) * 100)}%` : 0, background: on === i ? BAR_ON : BAR }}
                    />
                  </div>
                ))}
              </div>
              <div className="relative h-5 mt-1 text-[11.5px] text-dim" aria-hidden>
                {ticks.map((i) => (
                  <span key={i} className="absolute top-0 whitespace-nowrap" style={i === 0 ? { left: 0 } : i === rows.length - 1 ? { right: 0 } : { left: `${((i + 0.5) / rows.length) * 100}%`, transform: "translateX(-50%)" }}>{rows[i].label}</span>
                ))}
              </div>
              {tip && (
                <div
                  className="absolute top-0 z-10 pointer-events-none panel bg-slate-2 px-3 py-2 text-[12.5px] whitespace-nowrap shadow-lg"
                  style={on! < rows.length / 2 ? { left: `${((on! + 1) / rows.length) * 100}%`, marginLeft: 6 } : { right: `${((rows.length - on!) / rows.length) * 100}%`, marginRight: 6 }}
                  data-an-tip
                >
                  <p className="text-dim" dir="auto">{tip.long}</p>
                  <p className="text-paper tabular-nums mt-0.5" dir="auto">{t("tipViews", { count: tip.views, n: n(tip.views) })}</p>
                  <p className="text-paper-2 tabular-nums" dir="auto">{t("tipWatched", { time: span(tip.watchSeconds) })}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function initial(): { days: AnalyticsRange; video: string | null } {
  if (typeof window === "undefined") return { days: 28, video: null };
  const q = new URLSearchParams(window.location.search);
  const d = Number(q.get("days"));
  return { days: (RANGES.includes(d as AnalyticsRange) ? d : 28) as AnalyticsRange, video: q.get("video") || null };
}

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const tc = useTranslations("common");
  const { n, span, day: dayLabel, date } = useFmt();
  const when = (ms: number | null) => (ms ? date(ms) : t("notStarted"));
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const [days, setDays] = useState<AnalyticsRange>(28);
  const [video, setVideo] = useState<string | null>(null);
  useEffect(() => { const i = initial(); setDays(i.days); setVideo(i.video); }, []);
  // Keep the choice in the address, so it can be bookmarked. No scrolling.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (days === 28) url.searchParams.delete("days"); else url.searchParams.set("days", String(days));
    if (video) url.searchParams.set("video", video); else url.searchParams.delete("video");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [days, video]);

  const q = useQuery({
    queryKey: ["analytics", wallet ?? null, days, video],
    queryFn: () => getAnalytics(days, video),
    enabled: !!wallet,
    placeholderData: keepPreviousData,
    retry: (c, e) => !(e instanceof ApiError && e.status === 404) && c < 1,
  });
  // A video that is gone (or not this wallet's): show all videos instead.
  useEffect(() => { if (q.error instanceof ApiError && q.error.status === 404 && video) setVideo(null); }, [q.error, video]);
  // The list of videos for the picker comes from the unfiltered answer.
  const all = useQuery({ queryKey: ["analytics", wallet ?? null, days, null], queryFn: () => getAnalytics(days, null), enabled: !!wallet && !!video });
  const picker = (video ? all.data?.videos : q.data?.videos) ?? q.data?.videos ?? [];

  const a = q.data;
  const chosen = video ? picker.find((v) => v.id === video) : null;

  return (
    <AppShell>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="section pb-16">
        {!connected && (
          <EmptyState title={t("connect")} action={<WalletButton />}>{t("connectBody")}</EmptyState>
        )}
        {connected && !wallet && (
          <EmptyState title={t("signIn")}>{t("signInBody")}</EmptyState>
        )}
        {wallet && !a && !q.error && <p className="text-[14px] text-dim">{tc("loading")}</p>}
        {wallet && q.error && !a && <p className="text-[14px] text-error">{q.error instanceof ApiError ? q.error.message : t("loadFailed")}</p>}

        {wallet && a && (
          <div className={clsx("space-y-5 max-w-[1100px] transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
            {/* filters, in one row */}
            <div className="flex items-center gap-3 flex-wrap">
              <div role="radiogroup" aria-label={t("period")} className="inline-flex rounded-md border border-rule p-0.5 bg-slate">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    role="radio"
                    aria-checked={days === r}
                    onClick={() => setDays(r)}
                    className={clsx("h-8 px-3 rounded text-[13px] no-min", days === r ? "bg-slate-2 text-paper" : "text-dim hover:text-paper")}
                  >
                    {t(`range.${r}`)}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 min-w-0">
                <span className="sr-only">{t("video")}</span>
                <select value={video ?? ""} onChange={(e) => setVideo(e.target.value || null)} className="h-9 px-2.5 text-[13.5px] max-w-[320px] min-w-0" data-an-video>
                  <option value="">{t("allVideos")}</option>
                  {picker.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
              </label>
              <span className="text-[12.5px] text-dim">{t("dates", { from: dayLabel(a.from, { day: "numeric", month: "short", year: "numeric" }), to: dayLabel(a.to, { day: "numeric", month: "short", year: "numeric" }) })}</span>
            </div>

            {picker.length === 0 && !video ? (
              <EmptyState title={t("noVideos")} action={<Link href="/upload" className="btn btn-signal h-9 px-4 inline-flex items-center">{t("uploadVideo")}</Link>}>
                {t("noVideosBody")}
              </EmptyState>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Tile label={t("views")} value={n(a.totals.views)} test="views"><Change now={a.totals.views} before={a.previous.views} days={days} /></Tile>
                  <Tile label={t("watchTime")} value={span(a.totals.watchSeconds)} test="watch"><Change now={a.totals.watchSeconds} before={a.previous.watchSeconds} days={days} /></Tile>
                  <Tile label={t("averageView")} value={span(avg(a.totals))} test="avg"><Change now={avg(a.totals)} before={avg(a.previous)} days={days} /></Tile>
                  <Tile label={t("toTheEndLong")} value={t("percent", { pct: endRate(a.totals) })} test="end"><p className="text-[12.5px] text-dim mt-1">{t("endedOf", { count: a.totals.views, ended: n(a.totals.ended), views: n(a.totals.views) })}</p></Tile>
                </div>

                <ViewsChart a={a} />

                <Panel
                  title={chosen ? chosen.title : t("videos")}
                  hint={chosen ? <>{t("thisVideoOnly")} <button onClick={() => setVideo(null)} className="underline hover:text-paper">{t("showAll")}</button></> : t("videosHint")}
                >
                  <div className="overflow-x-auto -mx-1 px-1">
                    <table className="w-full text-[13.5px] min-w-[640px]">
                      <thead>
                        <tr className="text-start text-dim">
                          <th className="font-normal py-2 pe-4 text-start">{t("video")}</th>
                          <th className="font-normal py-2 pe-4 text-end">{t("views")}</th>
                          <th className="font-normal py-2 pe-4 text-end">{t("watchTime")}</th>
                          <th className="font-normal py-2 pe-4 text-end">{t("averageView")}</th>
                          <th className="font-normal py-2 pe-4 text-end" title={t("toTheEndHint")}>{t("toTheEnd")}</th>
                          <th className="font-normal py-2 pe-4 text-end" title={t("signedInHint")}>{t("signedIn")}</th>
                          <th className="font-normal py-2 text-end">{t("allTime")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.videos.map((v) => (
                          <tr key={v.id} className="border-t border-rule" data-an-row={v.id}>
                            <td className="py-2 pe-4 min-w-0 max-w-[280px]">
                              <div className="flex items-center gap-2 min-w-0">
                                {video !== v.id
                                  ? <button onClick={() => setVideo(v.id)} className="text-paper hover:text-signal truncate text-start" title={t("seeVideo")} dir="auto">{v.title}</button>
                                  : <span className="text-paper truncate" dir="auto">{v.title}</span>}
                                {v.visibility === "private" && <span className="tc text-dim-2 shrink-0">{tc("visibility.private")}</span>}
                              </div>
                              <div className="text-[12px] text-dim flex gap-3 mt-0.5">
                                <Link href={`/video/${v.id}`} className="hover:text-paper">{t("open")}</Link>
                                {v.clips > 0 && <span>{t("clips", { count: v.clips })}</span>}
                                {v.youtube > 0 && <span>{t("onYouTube")}</span>}
                              </div>
                            </td>
                            <td className="py-2 pe-4 text-end tabular-nums text-paper" data-an-cell="views">{n(v.views)}</td>
                            <td className="py-2 pe-4 text-end tabular-nums text-paper-2">{span(v.watchSeconds)}</td>
                            <td className="py-2 pe-4 text-end tabular-nums text-paper-2">{v.views ? span(v.watchSeconds / v.views) : "-"}</td>
                            <td className="py-2 pe-4 text-end tabular-nums text-paper-2">{v.views ? t("percent", { pct: Math.round((v.ended / v.views) * 100) }) : "-"}</td>
                            <td className="py-2 pe-4 text-end tabular-nums text-paper-2" data-an-cell="signed">{n(v.signedInViewers)}</td>
                            <td className="py-2 text-end tabular-nums text-paper-2" data-an-cell="alltime">{n(v.allTimeViews)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                {!video && (
                  <Panel title={t("liveEvents")} hint={t(`liveHint.${days}`)}>
                    {a.live.length === 0 ? (
                      <p className="text-[13.5px] text-dim">{t("noLive")} <Link href="/live" className="underline hover:text-paper">{t("goLive")}</Link></p>
                    ) : (
                      <div className="overflow-x-auto -mx-1 px-1">
                        <table className="w-full text-[13.5px] min-w-[560px]">
                          <thead>
                            <tr className="text-start text-dim">
                              <th className="font-normal py-2 pe-4 text-start">{t("event")}</th>
                              <th className="font-normal py-2 pe-4 text-start">{t("date")}</th>
                              <th className="font-normal py-2 pe-4 text-end">{t("length")}</th>
                              <th className="font-normal py-2 pe-4 text-end">{t("peak")}</th>
                              <th className="font-normal py-2 text-end">{t("chatMessages")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.live.map((e) => (
                              <tr key={e.id} className="border-t border-rule" data-an-live={e.id}>
                                <td className="py-2 pe-4 max-w-[260px] truncate"><Link href={`/live/${e.id}/studio`} className="text-paper hover:text-signal" dir="auto">{e.title}</Link></td>
                                <td className="py-2 pe-4 text-paper-2">{e.status === "live" ? t("liveNow") : when(e.startedAt)}</td>
                                <td className="py-2 pe-4 text-end tabular-nums text-paper-2">{e.durationSeconds != null ? span(e.durationSeconds) : "-"}</td>
                                <td className="py-2 pe-4 text-end tabular-nums text-paper" data-an-peak>{n(e.peakViewers)}</td>
                                <td className="py-2 text-end tabular-nums text-paper-2">{n(e.chatMessages)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                )}

                <Panel title={t("howTitle")}>
                  <ul className="list-disc ps-5 space-y-1.5 text-[13.5px] text-paper-2 leading-relaxed max-w-[80ch]">
                    <li>{t("how1")}</li>
                    <li>{t("how2")}</li>
                    <li>{t("how3")}</li>
                    <li>{t("how4")}</li>
                    <li>{t("how5")}</li>
                  </ul>
                  <p className="text-[13px] text-dim">{t.rich("usageOn", { wallet: (c) => <Link href="/wallet" className="underline hover:text-paper">{c}</Link> })}</p>
                </Panel>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
