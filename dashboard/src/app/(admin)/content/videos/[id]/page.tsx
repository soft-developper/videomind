"use client";
// vm_content: one video, to review it and take it down or restore it.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import { ApiError, apiUrl, getContentVideo, removeVideo, restoreVideo, type AdminVideoDetail } from "@/lib/api";
import { num, bytes, duration, when, day, short } from "@/lib/format";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");
const clock = (s: number) => { const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), r = t % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`; };

function Panel({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`panel panel-pad min-w-0 ${danger ? "border-error/40" : ""}`} aria-label={title}>
      <div className="panel-head"><h2 className={`panel-head-title ${danger ? "!text-error" : ""}`}>{title}</h2></div>
      {children}
    </section>
  );
}

export default function ContentVideoPage({ params }: { params: { id: string } }) {
  const { signedOut } = useAdmin();
  const [v, setV] = useState<AdminVideoDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setV(await getContentVideo(params.id)); setErr(null); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
  }, [params.id, signedOut]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setDone(null); setFailed(null);
    try { setDone(await fn()); await load(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setFailed(msg(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="section py-6 lg:py-8">
      <Link href="/content" className="inline-flex items-center gap-1 -ml-1 mb-3 text-[13px] text-dim hover:text-paper"><ChevronLeft size={14} /> Content</Link>
      {err && <Note kind="error">{err}</Note>}
      {!v && !err && <p className="text-[14px] text-dim">Loading</p>}
      {v && (
        <div className="space-y-5 max-w-[1100px]">
          <div>
            <h1 className="font-display text-[22px] text-paper break-words">{v.title}</h1>
            <p className="text-[13px] text-dim mt-1">
              {v.owner ? <>By <Link href={`/users/${v.owner}`} className="underline hover:text-paper">{v.ownerName ?? short(v.owner)}</Link>, </> : null}
              uploaded {day(v.createdAt)}. {v.visibility === "public" ? "Public" : v.visibility === "unlisted" ? "Unlisted" : "Private"}{v.removed ? ", taken down" : ""}.
            </p>
          </div>
          {v.removed && <Note kind="error">Taken down on {when(v.removed.at)}{v.removed.by ? ` by ${v.removed.by}` : ""}. Reason: {v.removed.reason}. Only its owner can open it.</Note>}

          <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
            <div className="space-y-5 min-w-0">
              <div className="aspect-video rounded-md bg-screen border border-rule overflow-hidden">
                {v.streamUrl
                  ? <video src={apiUrl(v.streamUrl)} controls preload="metadata" className="w-full h-full object-contain" data-review-player />
                  : <div className="w-full h-full flex items-center justify-center text-[13px] text-dim">This video has no file to play.</div>}
              </div>
              {(v.summary || v.description) && (
                <Panel title="About">
                  {v.summary && <p className="text-[13.5px] text-paper-2 leading-relaxed whitespace-pre-line">{v.summary}</p>}
                  {v.description && <p className="text-[13px] text-dim leading-relaxed whitespace-pre-line mt-3">{v.description}</p>}
                </Panel>
              )}
              {v.chapters.length > 0 && (
                <Panel title={`Chapters (${v.chapters.length})`}>
                  <ol className="space-y-1.5 text-[13.5px]">{v.chapters.map((c, i) => <li key={i} className="flex gap-3"><span className="tc text-dim w-14 shrink-0">{clock(c.startSeconds)}</span><span className="text-paper-2">{c.title}</span></li>)}</ol>
                </Panel>
              )}
            </div>
            <div className="space-y-5 min-w-0">
              <Panel title="Details">
                <dl className="grid grid-cols-[auto_1fr] gap-y-2 gap-x-4 text-[13.5px]">
                  <dt className="text-dim">Length</dt><dd className="text-paper-2 text-right">{v.durationSeconds ? duration(v.durationSeconds) : "-"}</dd>
                  <dt className="text-dim">Size</dt><dd className="text-paper-2 text-right">{v.sizeBytes ? bytes(v.sizeBytes) : "-"}</dd>
                  <dt className="text-dim">Views, 30 days</dt><dd className="text-paper-2 text-right">{num(v.views30)}</dd>
                  <dt className="text-dim">Clips</dt><dd className="text-paper-2 text-right">{num(v.clips)}</dd>
                  <dt className="text-dim">On Shelby</dt><dd className="text-paper-2 text-right">{v.onShelby ? "Yes" : "No"}</dd>
                  <dt className="text-dim">Video id</dt><dd className="tc text-paper-2 text-right break-all">{v.id}</dd>
                </dl>
                {v.publicUrl && v.visibleToOthers && <a href={v.publicUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-paper-2 underline hover:text-paper">Open the shared page <ExternalLink size={12} /></a>}
              </Panel>
              {v.youtube.length > 0 && (
                <Panel title="On YouTube">
                  <ul className="space-y-2 text-[13.5px]">{v.youtube.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3"><span className="text-paper-2 truncate">{p.title}</span>
                      {p.remoteId ? <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(p.remoteId)}`} target="_blank" rel="noreferrer" className="text-dim underline hover:text-paper shrink-0">Open</a> : <span className="text-dim shrink-0 capitalize">{p.status}</span>}
                    </li>))}</ul>
                </Panel>
              )}
              <Panel title={v.removed ? "Restore" : "Take down"} danger>
                {done && <div className="mb-3"><Note kind="ok">{done}</Note></div>}
                {failed && <div className="mb-3"><Note kind="error">{failed}</Note></div>}
                {v.removed ? (
                  <div className="space-y-3">
                    <p className="text-[13px] text-dim leading-relaxed">Everyone allowed by its owner&rsquo;s setting can open it again, and it can be published.</p>
                    <button disabled={busy} onClick={() => void act(async () => { await restoreVideo(v.id); return "The video was restored."; })} className="btn btn-ghost h-9 px-3.5">Restore the video</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[13px] text-dim leading-relaxed">Only its owner can open it after this, with your reason shown. It leaves shared links, the owner&rsquo;s public profile and previews, and cannot be published to YouTube. Copies already on Shelby or YouTube are outside VideoMind{v.onShelby || v.youtube.some((p) => p.remoteId) ? " (this video has some)" : ""}.</p>
                    <label className="block"><span className="block text-[13px] text-paper-2 mb-1.5">Reason (the owner sees it)</span>
                      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="w-full px-3 py-2 text-[13.5px]" />
                    </label>
                    <button disabled={busy || reason.trim().length < 3} onClick={() => void act(async () => { await removeVideo(v.id, reason); setReason(""); return "The video was taken down."; })} className="btn h-9 px-3.5 bg-error/90 text-void hover:bg-error disabled:opacity-40">Take the video down</button>
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
