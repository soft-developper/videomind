"use client";
// vm_courses: a collection as a course. Its videos are lessons in order,
// with how far this viewer got in each, a button to carry on with the
// next unfinished lesson, and for the owner a description and the order.
import Link from "next/link";
import { useState } from "react";
import { ArrowUp, ArrowDown, Check, Pencil } from "lucide-react";
import { clsx } from "clsx";
import { reorderCourse, updateCollection, type Collection, type VideoRecord, type MyProgress } from "@/lib/api";
import { clock } from "@/components/video/VideoCard";

export function CourseView({
  collection, videos, watched, onChanged,
}: {
  collection: Collection;
  videos: VideoRecord[];
  watched?: MyProgress["watched"];
  onChanged: () => void;
}) {
  const ordered = [...videos].sort((a, b) => (a.collection?.position ?? 0) - (b.collection?.position ?? 0) || a.createdAt - b.createdAt);
  const [order, setOrder] = useState<string[] | null>(null);
  const lessons = order ? order.map((id) => ordered.find((v) => v.id === id)!).filter(Boolean) : ordered;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(collection.description ?? "");

  const done = lessons.filter((v) => watched?.[v.id]?.finished).length;
  const ready = lessons.filter((v) => v.status === "ready");
  const nextUp = ready.find((v) => !watched?.[v.id]?.finished);
  const started = lessons.some((v) => watched?.[v.id]);

  const move = async (i: number, by: -1 | 1) => {
    const ids = lessons.map((v) => v.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids); setBusy(true); setErr(null);
    try { await reorderCourse(collection.id, ids); onChanged(); }
    catch (e: any) { setOrder(null); setErr(e?.message ?? "The new order could not be saved. Please try again."); }
    finally { setBusy(false); }
  };

  const saveDescription = async () => {
    setBusy(true); setErr(null);
    try { await updateCollection(collection.id, { description: text.trim() || null }); setEditing(false); onChanged(); }
    catch (e: any) { setErr(e?.message ?? "The description could not be saved."); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-[860px] space-y-6">
      {/* About the course */}
      <div className="space-y-3">
        {editing ? (
          <div className="space-y-2">
            <label htmlFor="course-description" className="sr-only">What the course is about</label>
            <textarea
              id="course-description"
              value={text}
              rows={3}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              placeholder="What the course covers, and who it is for"
              className="w-full px-3 py-2 text-[14px] leading-relaxed resize-y"
            />
            <div className="flex gap-2">
              <button onClick={saveDescription} disabled={busy} className="btn btn-signal h-9 px-3.5 text-[13px]">Save</button>
              <button onClick={() => { setEditing(false); setText(collection.description ?? ""); }} className="btn btn-ghost h-9 px-3.5 text-[13px]">Cancel</button>
            </div>
          </div>
        ) : collection.description ? (
          <p className="text-[14px] text-paper-2 leading-relaxed whitespace-pre-line max-w-[70ch]">
            {collection.description}{" "}
            <button onClick={() => setEditing(true)} aria-label="Edit the description" className="inline-flex align-middle text-dim hover:text-paper no-min"><Pencil size={12} /></button>
          </p>
        ) : (
          <button onClick={() => setEditing(true)} className="text-[13.5px] text-dim hover:text-paper underline underline-offset-2 no-min">Add a description</button>
        )}

        <div className="flex items-center gap-4 flex-wrap">
          {nextUp && (
            <Link href={`/video/${nextUp.id}`} className="btn btn-signal h-9 px-3.5 inline-flex items-center">
              {started ? "Continue the course" : "Start the course"}
            </Link>
          )}
          <span className="text-[13.5px] text-dim" aria-live="polite">
            {done === lessons.length && lessons.length > 0 ? "All lessons watched" : `${done} of ${lessons.length} lesson${lessons.length === 1 ? "" : "s"} watched`}
            {nextUp ? `. Next: ${nextUp.title}` : ""}
          </span>
        </div>
        {/* How far through the course */}
        <div className="flex gap-[3px] h-[4px] max-w-[420px]" aria-hidden>
          {lessons.map((v) => (
            <span key={v.id} className={clsx("flex-1 rounded-full", watched?.[v.id]?.finished ? "bg-signal" : watched?.[v.id] ? "bg-signal/40" : "bg-rule-lit")} />
          ))}
        </div>
        {err && <p className="text-[13px] text-error" role="alert">{err}</p>}
      </div>

      {/* The lessons */}
      <ol className="rounded-md border border-rule divide-y divide-rule overflow-hidden" aria-label="Lessons">
        {lessons.map((v, i) => {
          const w = watched?.[v.id];
          const dur = w?.durationSeconds ?? v.meta.durationSeconds ?? 0;
          const pct = w ? (w.finished ? 100 : dur ? Math.min(100, (w.positionSeconds / dur) * 100) : 0) : 0;
          const isNext = nextUp?.id === v.id;
          return (
            <li key={v.id} className={clsx("flex items-center gap-3 pr-2", isNext && "bg-signal/[0.06]")}>
              <Link href={`/video/${v.id}`} className="flex-1 min-w-0 flex items-center gap-3.5 pl-3.5 py-3 group">
                <span className={clsx("w-7 h-7 shrink-0 rounded-full border flex items-center justify-center tc", w?.finished ? "border-signal text-paper" : "border-rule-lit")}>
                  {w?.finished ? <Check size={13} aria-label="Watched" /> : i + 1}
                </span>
                <span className="relative w-24 aspect-video rounded-sm overflow-hidden bg-screen shrink-0 hidden sm:block">
                  {v.thumbUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  )}
                  {pct > 0 && (
                    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-rule-lit/60"><span className="block h-full bg-signal" style={{ width: `${pct}%` }} /></span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-paper truncate group-hover:underline">{v.title}</span>
                  <span className="tc block mt-0.5">
                    Lesson {i + 1}{clock(v.meta.durationSeconds) ? `, ${clock(v.meta.durationSeconds)}` : ""}
                    {v.status !== "ready" ? ", being processed" : w?.finished ? ", watched" : w ? `, stopped at ${clock(w.positionSeconds)}` : ""}
                  </span>
                </span>
              </Link>
              <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                <button
                  onClick={() => move(i, -1)} disabled={busy || i === 0}
                  aria-label={`Move ${v.title} up`}
                  className="w-8 h-8 flex items-center justify-center rounded text-dim hover:text-paper hover:bg-slate-2 disabled:opacity-30 no-min"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => move(i, 1)} disabled={busy || i === lessons.length - 1}
                  aria-label={`Move ${v.title} down`}
                  className="w-8 h-8 flex items-center justify-center rounded text-dim hover:text-paper hover:bg-slate-2 disabled:opacity-30 no-min"
                >
                  <ArrowDown size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
