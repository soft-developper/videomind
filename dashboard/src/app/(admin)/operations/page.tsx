"use client";
// vm_ops: Operations, like Atlassian Administration's Data management.
// Processing jobs, unfinished uploads, stores on Shelby, housekeeping.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import {
  ApiError, getJobs, retryJob, getUploads, discardUpload, getAnchors, checkAnchor, runHousekeeping,
  type AdminJob, type AdminUpload, type AdminAnchor, type JobFilter,
} from "@/lib/api";
import { num, bytes, when, short } from "@/lib/format";

type Tab = "jobs" | "uploads" | "shelby" | "housekeeping";
const TABS: Array<[Tab, string]> = [["jobs", "Processing jobs"], ["uploads", "Unfinished uploads"], ["shelby", "Shelby stores"], ["housekeeping", "Housekeeping"]];
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");
const STATE: Record<string, string> = { checking: "Being checked", anchored: "Confirmed", lapsed: "Paid period ended", missing: "Not found on Shelby", unverified: "Could not be checked" };

function Owner({ wallet, name }: { wallet: string | null; name: string | null }) {
  if (!wallet) return <span className="text-dim">-</span>;
  return <Link href={`/users/${wallet}`} className="text-paper-2 hover:text-signal">{name ?? <span className="tc">{short(wallet)}</span>}</Link>;
}
function Radio<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md border border-rule p-0.5 bg-slate">
      {options.map(([v, l]) => <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={clsx("h-8 px-3 rounded text-[13px] no-min", value === v ? "bg-slate-2 text-paper" : "text-dim hover:text-paper")}>{l}</button>)}
    </div>
  );
}
function useNotes() {
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const notes = <>{done && <div className="mb-4"><Note kind="ok">{done}</Note></div>}{err && <div className="mb-4"><Note kind="error">{err}</Note></div>}</>;
  return { setDone, setErr, notes };
}

function Jobs() {
  const { signedOut } = useAdmin();
  const [filter, setFilter] = useState<JobFilter>("failed");
  const [d, setD] = useState<{ counts: Record<string, number>; jobs: AdminJob[] } | null>(null);
  const { setDone, setErr, notes } = useNotes();
  const load = useCallback(async () => {
    try { setD(await getJobs(filter)); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
  }, [filter, signedOut, setErr]);
  useEffect(() => { void load(); }, [load]);
  const c = d?.counts ?? {};
  return (
    <>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <Radio label="Show" value={filter} onChange={setFilter} options={[["failed", `Failed (${num(c.failed ?? 0)})`], ["queued", `Waiting (${num(c.queued ?? 0)})`], ["running", `Running (${num(c.running ?? 0)})`], ["all", "Recent"]]} />
      </div>
      {notes}
      {!d && <p className="text-[14px] text-dim">Loading</p>}
      {d && d.jobs.length === 0 && <p className="text-[14px] text-dim py-6">{filter === "failed" ? "No failed jobs." : "Nothing here."}</p>}
      {d && d.jobs.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[860px]">
            <thead><tr className="text-left text-dim border-b border-rule">
              <th className="font-normal py-2.5 px-4">Video</th><th className="font-normal py-2.5 pr-4">Step</th><th className="font-normal py-2.5 pr-4">Owner</th>
              <th className="font-normal py-2.5 pr-4">What happened</th><th className="font-normal py-2.5 pr-4 text-right">Tries</th><th className="font-normal py-2.5 pr-4">Updated</th><th className="py-2.5 pr-4" />
            </tr></thead>
            <tbody>
              {d.jobs.map((j) => (
                <tr key={j.id} className="border-b border-rule last:border-0" data-job-row={j.id}>
                  <td className="py-2 px-4 max-w-[220px]">{j.title ? <Link href={`/content/videos/${j.videoId}`} className="text-paper hover:text-signal truncate block">{j.title}</Link> : <span className="text-dim">Deleted video</span>}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{j.label}</td>
                  <td className="py-2 pr-4 whitespace-nowrap"><Owner wallet={j.owner} name={j.ownerName} /></td>
                  <td className="py-2 pr-4 max-w-[300px]">{j.status === "failed" ? <span className="text-error text-[13px] break-words">{j.error ?? "Failed"}</span> : <span className="text-dim capitalize">{j.status === "queued" ? "Waiting" : j.status === "succeeded" ? "Done" : j.status}</span>}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-paper-2">{j.attempts}/{j.maxAttempts}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{when(j.updatedAt)}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">
                    {j.status === "failed" && (j.retryable
                      ? <button onClick={() => void retryJob(j.id).then(() => { setDone(`${j.label} will run again.`); return load(); }, (e) => setErr(msg(e)))} className="btn btn-ghost h-8 px-3 text-[13px] no-min">Run again</button>
                      : <span className="text-[12.5px] text-dim">Cannot be retried</span>)}
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

function Uploads() {
  const { signedOut } = useAdmin();
  const [rows, setRows] = useState<AdminUpload[] | null>(null);
  const { setDone, setErr, notes } = useNotes();
  const load = useCallback(async () => {
    try { setRows((await getUploads()).uploads); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
  }, [signedOut, setErr]);
  useEffect(() => { void load(); }, [load]);
  const discard = (u: AdminUpload) => {
    if (!window.confirm(`Discard "${u.title ?? u.filename}"? The parts sent so far are deleted.`)) return;
    void discardUpload(u.videoId).then(() => { setDone("The upload was discarded."); return load(); }, (e) => setErr(msg(e)));
  };
  return (
    <>
      <p className="text-[13px] text-dim mb-4 max-w-[80ch]">Uploads started and not finished. They are discarded by themselves after 7 days; the owner can resume until then.</p>
      {notes}
      {!rows && <p className="text-[14px] text-dim">Loading</p>}
      {rows && rows.length === 0 && <p className="text-[14px] text-dim py-6">No unfinished uploads.</p>}
      {rows && rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[680px]">
            <thead><tr className="text-left text-dim border-b border-rule"><th className="font-normal py-2.5 px-4">Upload</th><th className="font-normal py-2.5 pr-4">Owner</th><th className="font-normal py-2.5 pr-4 text-right">Size</th><th className="font-normal py-2.5 pr-4">Started</th><th className="py-2.5 pr-4" /></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.videoId} className="border-b border-rule last:border-0" data-upload-row={u.videoId}>
                  <td className="py-2 px-4 text-paper max-w-[260px] truncate">{u.title ?? u.filename}</td>
                  <td className="py-2 pr-4 whitespace-nowrap"><Owner wallet={u.owner} name={u.ownerName} /></td>
                  <td className="py-2 pr-4 text-right tabular-nums text-paper-2">{bytes(u.sizeBytes)}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{when(u.createdAt)}</td>
                  <td className="py-2 pr-4 text-right"><button onClick={() => discard(u)} className="btn btn-ghost h-8 px-3 text-[13px] no-min">Discard</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Shelby() {
  const { signedOut } = useAdmin();
  const [state, setState] = useState("problems");
  const [d, setD] = useState<{ counts: Record<string, number>; anchors: AdminAnchor[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { setDone, setErr, notes } = useNotes();
  const load = useCallback(async () => {
    try { setD(await getAnchors(state)); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
  }, [state, signedOut, setErr]);
  useEffect(() => { void load(); }, [load]);
  const c = d?.counts ?? {};
  const problems = Object.entries(c).filter(([k]) => k !== "anchored").reduce((a, [, v]) => a + v, 0);
  const check = async (a: AdminAnchor) => {
    setBusy(a.id); setErr(null); setDone(null);
    try { const r = await checkAnchor(a.id); setDone(`Checked: ${STATE[r.state] ?? r.state}.`); await load(); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(null); }
  };
  return (
    <>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <Radio label="Show" value={state} onChange={setState} options={[["problems", `Not confirmed (${num(problems)})`], ["anchored", `Confirmed (${num(c.anchored ?? 0)})`]]} />
      </div>
      {notes}
      {!d && <p className="text-[14px] text-dim">Loading</p>}
      {d && d.anchors.length === 0 && <p className="text-[14px] text-dim py-6">{state === "problems" ? "Every store on Shelby is confirmed." : "No confirmed stores yet."}</p>}
      {d && d.anchors.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[760px]">
            <thead><tr className="text-left text-dim border-b border-rule"><th className="font-normal py-2.5 px-4">Video</th><th className="font-normal py-2.5 pr-4">Owner</th><th className="font-normal py-2.5 pr-4">State</th><th className="font-normal py-2.5 pr-4">Paid until</th><th className="font-normal py-2.5 pr-4">Last checked</th><th className="py-2.5 pr-4" /></tr></thead>
            <tbody>
              {d.anchors.map((a) => (
                <tr key={a.id} className="border-b border-rule last:border-0" data-anchor-row={a.id}>
                  <td className="py-2 px-4 max-w-[240px]">{a.title ? <Link href={`/content/videos/${a.videoId}`} className="text-paper hover:text-signal truncate block">{a.title}</Link> : <span className="text-dim">Deleted video</span>}</td>
                  <td className="py-2 pr-4 whitespace-nowrap"><Owner wallet={a.owner} name={a.ownerName} /></td>
                  <td className={clsx("py-2 pr-4 whitespace-nowrap", a.state === "anchored" ? "text-marker" : a.state === "checking" ? "text-paper-2" : "text-error")}>{STATE[a.state] ?? a.state}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{a.paidUntil ? when(a.paidUntil) : "-"}</td>
                  <td className="py-2 pr-4 text-paper-2 whitespace-nowrap">{a.checkedAt ? when(a.checkedAt) : "-"}</td>
                  <td className="py-2 pr-4 text-right"><button onClick={() => void check(a)} disabled={busy === a.id} className="btn btn-ghost h-8 px-3 text-[13px] no-min">{busy === a.id ? "Checking" : "Check now"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Housekeeping() {
  const [busy, setBusy] = useState(false);
  const { setDone, setErr, notes } = useNotes();
  const run = async () => {
    setBusy(true); setDone(null); setErr(null);
    try { const r = await runHousekeeping(); setDone(`Done: the files of ${num(r.videosCleaned)} deleted or abandoned ${r.videosCleaned === 1 ? "video were" : "videos were"} removed, and ${num(r.uploadsDiscarded)} expired ${r.uploadsDiscarded === 1 ? "upload was" : "uploads were"} discarded.`); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel panel-pad max-w-[720px] space-y-3">
      <p className="text-[13.5px] text-paper-2 leading-relaxed">The server tidies up by itself every hour: it removes the files of deleted videos that storage could not delete at the time, files of uploads abandoned for a day, and uploads not finished in 7 days. It also looks again at stores on Shelby.</p>
      <p className="text-[13px] text-dim">Run it now after a storage outage, or to free space at once.</p>
      {notes}
      <button onClick={() => void run()} disabled={busy} className="btn btn-ghost h-9 px-3.5">{busy ? "Running" : "Run the housekeeping now"}</button>
    </div>
  );
}

export default function OperationsPage() {
  const [tab, setTab] = useState<Tab>("jobs");
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t === "uploads" || t === "shelby" || t === "housekeeping") setTab(t); }, []);
  const pick = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "jobs") url.searchParams.delete("tab"); else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  return (
    <div className="section py-6 lg:py-8">
      <h1 className="font-display text-[22px] text-paper">Operations</h1>
      <p className="text-[14px] text-dim mt-1 mb-5">Processing, uploads, Shelby stores and housekeeping.</p>
      <div role="tablist" aria-label="Operations" className="flex gap-1 border-b border-rule mb-5 overflow-x-auto">
        {TABS.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => pick(t)} className={clsx("h-10 px-3 text-[13.5px] border-b-2 -mb-px whitespace-nowrap no-min", tab === t ? "border-signal text-paper" : "border-transparent text-dim hover:text-paper")}>{l}</button>)}
      </div>
      {tab === "jobs" ? <Jobs /> : tab === "uploads" ? <Uploads /> : tab === "shelby" ? <Shelby /> : <Housekeeping />}
    </div>
  );
}
