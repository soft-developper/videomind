"use client";
// vm_admin: Overview, a snapshot of the whole site, as Atlassian
// Administration's Overview is of an organization.
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { RefreshCw } from "lucide-react";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import { ApiError, getOverview, type Overview } from "@/lib/api";
import { ACTIONS, dollars } from "@/lib/actions";
import { num, bytes, duration, tokens, when } from "@/lib/format";


function Tile({ label, value, sub, test }: { label: string; value: string; sub?: string; test: string }) {
  return (
    <div className="panel p-4 min-w-0" data-ov={test}>
      <p className="stat-label !mt-0">{label}</p>
      <p className="stat-value mt-1.5" data-ov-value>{value}</p>
      {sub && <p className="text-[12.5px] text-dim mt-1">{sub}</p>}
    </div>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel panel-pad min-w-0" aria-label={title}><div className="panel-head"><h2 className="panel-head-title">{title}</h2></div>{children}</section>;
}

export default function OverviewPage() {
  const { admin, signedOut } = useAdmin();
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setO(await getOverview()); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) return signedOut();
      setErr(e instanceof ApiError ? e.message : "The overview could not be loaded.");
    } finally { setBusy(false); }
  }, [signedOut]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("recovery")) { setRecovery(true); url.searchParams.delete("recovery"); window.history.replaceState(null, "", url.pathname + url.search); }
  }, []);

  const attention = o ? [
    o.jobs.failed && `${num(o.jobs.failed)} processing ${o.jobs.failed === 1 ? "job" : "jobs"} failed`,
    o.videos.failed && `${num(o.videos.failed)} ${o.videos.failed === 1 ? "video" : "videos"} could not be processed`,
    o.youtube.failed30 && `${num(o.youtube.failed30)} YouTube ${o.youtube.failed30 === 1 ? "upload" : "uploads"} failed in the last 30 days`,
    ...o.health.filter((h) => !h.ok && !h.optional).map((h) => `${h.name}: ${h.note}`),
    // vm_pricing: only while charging is on (with it off everything is free on purpose)
    o.pricing?.charging && o.pricing.belowCost.length > 0 && `${num(o.pricing.belowCost.length)} ${o.pricing.belowCost.length === 1 ? "price is" : "prices are"} below cost${o.pricing.lossMicros > 0 ? `, ${dollars(o.pricing.lossMicros)} lost this month` : ""}. See Credits, Prices`,
  ].filter(Boolean) as string[] : [];

  return (
    <div className="section py-6 lg:py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-[22px] text-paper">Overview</h1>
          <p className="text-[14px] text-dim mt-1">VideoMind at a glance. Counts across the whole site{o ? `, as of ${new Date(o.at).toLocaleTimeString([], { timeStyle: "short" })}` : ""}.</p>
        </div>
        <button onClick={() => void load()} disabled={busy} className="btn btn-ghost h-9 px-3 inline-flex items-center gap-2"><RefreshCw size={14} className={clsx(busy && "animate-spin")} /> Refresh</button>
      </div>

      <div className="space-y-5 max-w-[1200px]">
        {recovery && <Note kind="info">You signed in with a recovery code. {admin.recoveryCodesLeft} {admin.recoveryCodesLeft === 1 ? "code is" : "codes are"} left.</Note>}
        {err && <Note kind="error">{err}</Note>}
        {!o && !err && <p className="text-[14px] text-dim">Loading</p>}
        {o && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Tile test="wallets" label="Wallets" value={num(o.users.total)} sub={`${num(o.users.new7)} new in 7 days`} />
              <Tile test="active" label="Signed in, 30 days" value={num(o.users.active30)} sub={`${num(o.users.active7)} in 7 days, ${num(o.users.signedInNow)} now`} />
              <Tile test="videos" label="Videos" value={num(o.videos.total)} sub={`${num(o.videos.new7)} new in 7 days`} />
              <Tile test="storage" label="Storage used" value={bytes(o.storage.bytes)} sub="Files in VideoMind storage" />
              <Tile test="views" label="Views, 30 days" value={num(o.views.last30)} sub={`${num(o.views.last7)} in 7 days`} />
              <Tile test="live" label="Live now" value={num(o.live.liveNow)} sub={`${num(o.live.new30)} events in 30 days`} />
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
              <Panel title="Needs attention">
                {attention.length === 0
                  ? <p className="text-[13.5px] text-dim" data-ov-attention="none">Nothing needs attention.</p>
                  : <ul className="space-y-2" data-ov-attention="some">{attention.map((a) => <li key={a} className="flex gap-2.5 text-[13.5px] text-paper-2"><span className="dot dot-dead mt-[7px] shrink-0" aria-hidden />{a}</li>)}</ul>}
                <p className="text-[12.5px] text-dim mt-4">{num(o.jobs.queued)} queued and {num(o.jobs.running)} running processing jobs; {num(o.videos.working)} videos being processed.</p>
              </Panel>
              <Panel title={`Usage since ${new Date(o.monthStart).toLocaleDateString([], { day: "numeric", month: "long", timeZone: "UTC" })}`}>
                <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-[13.5px]">
                  <dt className="text-dim">Sound transcribed</dt><dd className="text-paper tabular-nums text-right">{duration(o.usageThisMonth.transcribedSeconds)}</dd>
                  <dt className="text-dim">AI tokens read</dt><dd className="text-paper tabular-nums text-right">{tokens(o.usageThisMonth.inputTokens)}</dd>
                  <dt className="text-dim">AI tokens written</dt><dd className="text-paper tabular-nums text-right">{tokens(o.usageThisMonth.outputTokens)}</dd>
                  <dt className="text-dim">Files uploaded</dt><dd className="text-paper tabular-nums text-right">{bytes(o.usageThisMonth.bytesUploaded)}</dd>
                  <dt className="text-dim">Watch time, 30 days</dt><dd className="text-paper tabular-nums text-right">{duration(o.views.watchSeconds30)}</dd>
                  <dt className="text-dim">Published to YouTube, 30 days</dt><dd className="text-paper tabular-nums text-right">{num(o.youtube.published30)}</dd>
                </dl>
              </Panel>
              <Panel title="Health">
                <ul className="divide-y divide-rule" data-ov-health>
                  {o.health.map((h) => (
                    <li key={h.name} className="flex items-center gap-3 py-2 text-[13.5px]">
                      <span className={clsx("dot shrink-0", h.ok ? "dot-live" : h.optional ? "dot-off" : "dot-dead")} aria-hidden />
                      <span className="text-paper-2">{h.name}</span>
                      <span className={clsx("ml-auto text-right", h.ok || h.optional ? "text-dim" : "text-error")}>{h.ok || h.optional ? h.note : `Problem: ${h.note}`}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Recent admin activity">
                {o.adminActivity.length === 0 ? <p className="text-[13.5px] text-dim">Nothing yet.</p> : (
                  <ul className="divide-y divide-rule" data-ov-activity>
                    {o.adminActivity.map((a) => (
                      <li key={a.id} className="py-2 text-[13.5px] flex flex-col sm:flex-row sm:items-baseline gap-x-3 gap-y-0.5 min-w-0">
                        <span className={clsx("shrink-0", /fail|lock/.test(a.action) ? "text-error" : "text-paper-2")}>{ACTIONS[a.action] ?? a.action}</span>
                        {a.email && <span className="text-dim truncate min-w-0">{a.email}</span>}
                        {a.target && a.action.startsWith("video_") && <a href={`/content/videos/${a.target}`} className="text-dim underline hover:text-paper truncate min-w-0">Open the video</a>}
                        {a.target && a.action.startsWith("user_") && <a href={`/users/${a.target}`} className="text-dim underline hover:text-paper tc truncate min-w-0">{a.target.slice(0, 8)}...{a.target.slice(-6)}</a>}
                        <span className="sm:ml-auto text-dim tabular-nums text-[12.5px] sm:text-[13.5px] shrink-0">{when(a.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
