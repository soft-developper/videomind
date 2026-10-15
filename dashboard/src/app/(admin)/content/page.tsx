"use client";
// vm_content: every video, live event and YouTube upload on VideoMind.
// Tabs are kept in the address (?tab=). Nothing scrolls by itself.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Search } from "lucide-react";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import {
  ApiError, getContentVideos, getContentLive, getContentYouTube, endLive,
  type AdminVideo, type AdminLive, type AdminPublication, type VideoFilter, type VideoSort,
} from "@/lib/api";
import { num, bytes, day, when, short, duration } from "@/lib/format";

type Tab = "videos" | "live" | "youtube";
const TABS: Array<[Tab, string]> = [["videos", "Videos"], ["live", "Live events"], ["youtube", "YouTube uploads"]];
const FILTERS: Array<[VideoFilter, string]> = [["all", "All"], ["public", "Public"], ["unlisted", "Unlisted"], ["private", "Private"], ["removed", "Taken down"]];
const SORTS: Array<[VideoSort, string]> = [["newest", "Newest"], ["views", "Most viewed, 30 days"], ["size", "Largest"]];
const PAGE = 50;
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");

function Owner({ wallet, name }: { wallet: string | null; name: string | null }) {
  if (!wallet) return <span className="text-dim">-</span>;
  return <Link href={`/users/${wallet}`} className="hover:text-signal"><span className="text-paper-2">{name ?? <span className="tc">{short(wallet)}</span>}</span></Link>;
}
function Visibility({ v, removed }: { v: string; removed: boolean }) {
  if (removed) return <span className="badge border-error/50 text-error">Taken down</span>;
  return <span className={clsx("badge", v === "public" && "badge-signal")}>{v === "public" ? "Public" : v === "unlisted" ? "Unlisted" : "Private"}</span>;
}

function Videos() {
  const { signedOut } = useAdmin();
  const [q, setQ] = useState(""); const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<VideoFilter>("all");
  const [sort, setSort] = useState<VideoSort>("newest");
  const [rows, setRows] = useState<AdminVideo[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const load = useCallback(async (offset: number) => {
    const my = ++seq.current; setBusy(true); setErr(null);
    try {
      const r = await getContentVideos({ q: query, filter, sort, offset, limit: PAGE });
      if (my !== seq.current) return;
      setRows((cur) => (offset === 0 ? r.videos : [...(cur ?? []), ...r.videos])); setTotal(r.total);
    } catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
    finally { if (my === seq.current) setBusy(false); }
  }, [query, filter, sort, signedOut]);
  useEffect(() => { void load(0); }, [load]);

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <label className="relative flex-1 min-w-[220px] max-w-[420px]">
          <span className="sr-only">Search by title, video id or owner address</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, video id or owner address" className="w-full h-9 pl-8 pr-3 text-[13.5px]" />
        </label>
        <div role="radiogroup" aria-label="Show" className="inline-flex flex-wrap rounded-md border border-rule p-0.5 bg-slate">
          {FILTERS.map(([f, l]) => (
            <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={clsx("h-8 px-3 rounded text-[13px] no-min", filter === f ? "bg-slate-2 text-paper" : "text-dim hover:text-paper")}>{l}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-dim">Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as VideoSort)} className="h-9 px-2.5 text-[13.5px]" aria-label="Sort">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <span className="text-[12.5px] text-dim ml-auto" data-videos-total>{rows ? `${num(total)} ${total === 1 ? "video" : "videos"}` : ""}</span>
      </div>
      {err && <div className="mb-4"><Note kind="error">{err}</Note></div>}
      {!rows && !err && <p className="text-[14px] text-dim">Loading</p>}
      {rows && rows.length === 0 && <p className="text-[14px] text-dim py-6">{query || filter !== "all" ? "No video matches." : "No videos yet."}</p>}
      {rows && rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[820px]">
            <thead><tr className="text-left text-dim border-b border-rule">
              <th className="font-normal py-2.5 px-4">Video</th><th className="font-normal py-2.5 pr-4">Owner</th><th className="font-normal py-2.5 pr-4">Who can see it</th>
              <th className="font-normal py-2.5 pr-4 text-right">Views, 30 days</th><th className="font-normal py-2.5 pr-4 text-right">Size</th><th className="font-normal py-2.5 pr-4">Uploaded</th>
            </tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-b border-rule last:border-0 hover:bg-slate-2" data-video-row={v.id}>
                  <td className="py-2 px-4">
                    <Link href={`/content/videos/${v.id}`} className="flex items-center gap-3 min-w-0 group">
                      <span className="w-16 h-9 rounded-sm bg-screen border border-rule shrink-0 overflow-hidden">{v.thumbUrl && <img src={v.thumbUrl} alt="" className="w-full h-full object-cover" />}</span>
                      <span className="min-w-0">
                        <span className="block text-paper group-hover:text-signal truncate max-w-[300px]">{v.title}</span>
                        <span className="block text-[12px] text-dim">{v.durationSeconds ? duration(v.durationSeconds) : v.status === "ready" ? "" : v.status === "error" ? "Failed" : "Processing"}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap"><Owner wallet={v.owner} name={v.ownerName} /></td>
                  <td className="py-2 pr-4"><Visibility v={v.visibility} removed={!!v.removed} /></td>
                  <td className="py-2 pr-4 text-right tabular-nums text-paper">{num(v.views30)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-paper-2">{bytes(v.sizeBytes)}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{day(v.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length < total && <button onClick={() => void load(rows.length)} disabled={busy} className="btn btn-ghost h-9 px-4 mt-4">{busy ? "Loading" : `Show ${Math.min(PAGE, total - rows.length)} more`}</button>}
    </>
  );
}

function Live() {
  const { signedOut } = useAdmin();
  const [filter, setFilter] = useState<"live" | "all">("all");
  const [rows, setRows] = useState<AdminLive[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows((await getContentLive(filter)).events); setErr(null); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
  }, [filter, signedOut]);
  useEffect(() => { void load(); }, [load]);
  const end = async (e: AdminLive) => {
    if (!window.confirm(`End "${e.title}" now? Viewers are disconnected and it cannot go live again.`)) return;
    setDone(null);
    try { await endLive(e.id); setDone(`"${e.title}" was ended.`); await load(); }
    catch (x) { setErr(msg(x)); }
  };
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-md border border-rule p-0.5 bg-slate">
          {(["all", "live"] as const).map((f) => <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={clsx("h-8 px-3 rounded text-[13px] no-min", filter === f ? "bg-slate-2 text-paper" : "text-dim hover:text-paper")}>{f === "all" ? "All" : "Live now"}</button>)}
        </div>
      </div>
      {done && <div className="mb-4"><Note kind="ok">{done}</Note></div>}
      {err && <div className="mb-4"><Note kind="error">{err}</Note></div>}
      {!rows && !err && <p className="text-[14px] text-dim">Loading</p>}
      {rows && rows.length === 0 && <p className="text-[14px] text-dim py-6">{filter === "live" ? "Nobody is live right now." : "No live events yet."}</p>}
      {rows && rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[760px]">
            <thead><tr className="text-left text-dim border-b border-rule">
              <th className="font-normal py-2.5 px-4">Event</th><th className="font-normal py-2.5 pr-4">Host</th><th className="font-normal py-2.5 pr-4">Status</th>
              <th className="font-normal py-2.5 pr-4">Started</th><th className="font-normal py-2.5 pr-4 text-right">Most viewers</th><th className="font-normal py-2.5 pr-4 text-right">Chat</th><th className="py-2.5 pr-4" />
            </tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-rule last:border-0" data-live-row={e.id}>
                  <td className="py-2 px-4 text-paper max-w-[260px] truncate">{e.title}</td>
                  <td className="py-2 pr-4 whitespace-nowrap"><Owner wallet={e.owner} name={e.ownerName} /></td>
                  <td className="py-2 pr-4">{e.status === "live" ? <span className="badge badge-marker">Live now</span> : e.status === "ended" ? <span className="text-dim">Ended</span> : <span className="text-dim">Not started</span>}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{e.startedAt ? when(e.startedAt) : "-"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{num(e.peakViewers)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{num(e.chatMessages)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-right">
                    <a href={e.watchUrl} target="_blank" rel="noreferrer" className="text-dim underline hover:text-paper mr-3">Watch</a>
                    {e.status !== "ended" && <button onClick={() => void end(e)} className="btn h-8 px-3 text-[13px] bg-error/90 text-void hover:bg-error no-min">End now</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function YouTube() {
  const { signedOut } = useAdmin();
  const [rows, setRows] = useState<AdminPublication[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getContentYouTube().then((r) => setRows(r.publications), (e) => { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); });
  }, [signedOut]);
  return (
    <>
      {err && <div className="mb-4"><Note kind="error">{err}</Note></div>}
      {!rows && !err && <p className="text-[14px] text-dim">Loading</p>}
      {rows && rows.length === 0 && <p className="text-[14px] text-dim py-6">Nothing has been published to YouTube yet.</p>}
      {rows && rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[760px]">
            <thead><tr className="text-left text-dim border-b border-rule">
              <th className="font-normal py-2.5 px-4">Title on YouTube</th><th className="font-normal py-2.5 pr-4">Owner</th><th className="font-normal py-2.5 pr-4">Privacy</th>
              <th className="font-normal py-2.5 pr-4">Status</th><th className="font-normal py-2.5 pr-4">Sent</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-rule last:border-0" data-yt-row={p.id}>
                  <td className="py-2 px-4 max-w-[300px]">
                    <Link href={`/content/videos/${p.videoId}`} className="text-paper hover:text-signal truncate block">{p.title}</Link>
                    {p.clip && <span className="text-[12px] text-dim">A clip</span>}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap"><Owner wallet={p.owner} name={p.ownerName} /></td>
                  <td className="py-2 pr-4 text-paper-2 capitalize">{p.privacy}</td>
                  <td className="py-2 pr-4">{p.status === "done" ? (p.youtubeUrl ? <a href={p.youtubeUrl} target="_blank" rel="noreferrer" className="text-marker underline">On YouTube</a> : <span className="text-marker">Done</span>) : p.status === "failed" ? <span className="text-error" title={p.error ?? undefined}>Failed</span> : <span className="text-dim">Uploading</span>}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{when(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function ContentPage() {
  const [tab, setTab] = useState<Tab>("videos");
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t === "live" || t === "youtube") setTab(t); }, []);
  const pick = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "videos") url.searchParams.delete("tab"); else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  return (
    <div className="section py-6 lg:py-8">
      <h1 className="font-display text-[22px] text-paper">Content</h1>
      <p className="text-[14px] text-dim mt-1 mb-5">Every video, live event and YouTube upload on VideoMind.</p>
      <div role="tablist" aria-label="Content" className="flex gap-1 border-b border-rule mb-5 overflow-x-auto">
        {TABS.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => pick(t)} className={clsx("h-10 px-3 text-[13.5px] border-b-2 -mb-px whitespace-nowrap no-min", tab === t ? "border-signal text-paper" : "border-transparent text-dim hover:text-paper")}>{l}</button>
        ))}
      </div>
      {tab === "videos" ? <Videos /> : tab === "live" ? <Live /> : <YouTube />}
    </div>
  );
}
