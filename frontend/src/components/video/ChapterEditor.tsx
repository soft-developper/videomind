"use client";
// vm_chapters: the owner's editor for a video's chapters. Titles, start
// times and summaries can be changed, chapters added at the moment the
// video is at, and removed. Nothing is saved until Save.
import { useState } from "react";
import { Plus, Trash2, Clock } from "lucide-react";
import { clsx } from "clsx";
import { saveChapters, parseClock, ApiError } from "@/lib/api";
import { readableTime } from "@/lib/exports";

interface Chapter { title: string; startSeconds: number; summary: string }
interface Row { key: number; title: string; time: string; summary: string }

const MAX_TITLE = 120;
let nextKey = 1;

/** Seconds as the editor shows them: 1:30, or 1:02:03 past an hour. */
function clock(sec: number): string {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function ChapterEditor({
  videoId, chapters, currentTime, duration, onDone,
}: {
  videoId: string;
  chapters: Chapter[];
  currentTime: number;
  /** how long the video is, when known */
  duration?: number;
  /** called with the saved chapters, or with nothing when the edit is cancelled */
  onDone: (saved?: Chapter[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    chapters.map((c) => ({ key: nextKey++, title: c.title, time: clock(c.startSeconds), summary: c.summary ?? "" })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; key?: number } | null>(null);

  const set = (key: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); setError(null); };
  const remove = (key: number) => { setRows((rs) => rs.filter((r) => r.key !== key)); setError(null); };
  const add = () => {
    const at = Math.floor(currentTime);
    const row = { key: nextKey++, title: "", time: clock(at), summary: "" };
    // In order of time, so the new chapter sits where it belongs.
    setRows((rs) => {
      const i = rs.findIndex((r) => (parseClock(r.time) ?? 0) > at);
      return i === -1 ? [...rs, row] : [...rs.slice(0, i), row, ...rs.slice(i)];
    });
    setError(null);
  };

  // What is wrong with a row, before asking the server.
  const problem = (r: Row): string | null => {
    const t = parseClock(r.time);
    if (t === null) return "Write the time as 1:30 or 1:02:03.";
    if (duration && t >= duration) return `The video ends at ${readableTime(duration)}.`;
    if (!r.title.trim()) return "Give the chapter a title.";
    return null;
  };
  const firstProblem = rows.map((r) => ({ r, p: problem(r) })).find((x) => x.p);

  const save = async () => {
    if (firstProblem) { setError({ text: firstProblem.p!, key: firstProblem.r.key }); return; }
    setSaving(true); setError(null);
    try {
      const sent = rows.map((r) => ({ title: r.title, startSeconds: parseClock(r.time)!, summary: r.summary }));
      const { chapters: saved } = await saveChapters(videoId, sent);
      onDone(saved);
    } catch (e) {
      const i = e instanceof ApiError ? (e.data?.index as number | undefined) : undefined;
      setError({ text: e instanceof Error ? e.message : "The chapters could not be saved. Please try again.", key: i !== undefined ? rows[i]?.key : undefined });
    } finally { setSaving(false); }
  };

  return (
    <div className="-mx-5 -my-5" aria-label="Edit chapters" role="group">
      {rows.length === 0 && (
        <p className="px-5 pt-5 text-[13.5px] text-dim">No chapters. Add one at the moment the video is at, or save to remove them all.</p>
      )}
      <ol>
        {rows.map((r, i) => {
          const bad = error?.key === r.key;
          return (
            <li key={r.key} className={clsx("px-5 py-3 border-b border-rule space-y-2", bad && "bg-error/[0.06]")}>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`ch-time-${r.key}`}>Start of chapter {i + 1}</label>
                <input
                  id={`ch-time-${r.key}`}
                  value={r.time}
                  onChange={(e) => set(r.key, { time: e.target.value })}
                  inputMode="numeric"
                  className={clsx("tabular-nums text-[13px] text-paper w-[4.5rem] h-8 px-2 shrink-0", parseClock(r.time) === null && "border-error")}
                />
                <button
                  onClick={() => set(r.key, { time: clock(currentTime) })}
                  title="Start at the moment the video is at"
                  aria-label={`Start chapter ${i + 1} at ${clock(currentTime)}`}
                  className="h-8 w-8 flex items-center justify-center rounded border border-rule text-dim hover:text-paper hover:border-rule-lit no-min shrink-0"
                >
                  <Clock size={13} />
                </button>
                <label className="sr-only" htmlFor={`ch-title-${r.key}`}>Title of chapter {i + 1}</label>
                <input
                  id={`ch-title-${r.key}`}
                  value={r.title}
                  maxLength={MAX_TITLE}
                  onChange={(e) => set(r.key, { title: e.target.value })}
                  placeholder="Chapter title"
                  className="flex-1 min-w-0 h-8 px-2.5 text-[13.5px]"
                />
                <button
                  onClick={() => remove(r.key)}
                  aria-label={`Remove chapter ${i + 1}`}
                  title="Remove this chapter"
                  className="h-8 w-8 flex items-center justify-center rounded border border-rule text-dim hover:text-error hover:border-error no-min shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <label className="sr-only" htmlFor={`ch-sum-${r.key}`}>Summary of chapter {i + 1}</label>
              <textarea
                id={`ch-sum-${r.key}`}
                value={r.summary}
                maxLength={1000}
                rows={2}
                onChange={(e) => set(r.key, { summary: e.target.value })}
                placeholder="What the chapter covers (optional)"
                className="w-full px-2.5 py-1.5 text-[12.5px] leading-relaxed resize-y"
              />
              {bad && <p className="text-[12.5px] text-error" role="alert">{error!.text}</p>}
            </li>
          );
        })}
      </ol>

      {error && error.key === undefined && <p className="px-5 pt-3 text-[12.5px] text-error" role="alert">{error.text}</p>}

      <div className="flex items-center gap-2 px-5 py-3 flex-wrap">
        <button onClick={add} className="btn btn-ghost h-9 px-3 inline-flex items-center justify-center gap-1.5 text-[13px] w-full sm:w-auto">
          <Plus size={13} /> Add a chapter at {clock(currentTime)}
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => onDone()} disabled={saving} className="btn btn-ghost h-9 px-3.5 text-[13px]">Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-signal h-9 px-4 text-[13px]">
            {saving ? "Saving" : "Save chapters"}
          </button>
        </div>
      </div>
    </div>
  );
}
