"use client";
import { useRef, useEffect, useState, useCallback, useMemo, memo } from "react";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import { readableTime } from "@/lib/exports";

// vm_shell: following the video scrolls this list only, never the page.
// The moment the reader scrolls the list by hand, following stops, and a
// button brings it back. Nothing moves under someone who is reading.
//
// vm_workspace: the word being said is marked inside the sentence, and a
// word can be clicked to go to the moment it is said. Chapter titles sit
// in the list where each chapter starts. Find marks what it found.

export interface TranscriptWord { text: string; start: number; end: number }
export interface TranscriptLine { start: number; end: number; text: string; words?: TranscriptWord[] }
interface ChapterMark { title: string; startSeconds: number }

/** Split text around every match of `q`, case aside. */
function marked(text: string, q: string): Array<{ t: string; hit: boolean }> {
  if (!q) return [{ t: text, hit: false }];
  const out: Array<{ t: string; hit: boolean }> = [];
  const lower = text.toLowerCase(), needle = q.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + needle.length)) {
    if (i > at) out.push({ t: text.slice(at, i), hit: false });
    out.push({ t: text.slice(i, i + needle.length), hit: true });
    at = i + needle.length;
  }
  if (at < text.length) out.push({ t: text.slice(at), hit: false });
  return out;
}

/**
 * The sentence split into its words, each with a time, when Whisper's
 * words line up with the sentence one to one (they carry no punctuation,
 * the sentence does). Otherwise null, and the sentence is shown whole.
 */
function wordsOf(line: TranscriptLine): Array<{ t: string; start: number }> | null {
  const parts = line.text.trim().split(/\s+/).filter(Boolean);
  if (!line.words?.length || line.words.length !== parts.length) return null;
  return parts.map((t, i) => ({ t, start: line.words![i].start }));
}

const Row = memo(function Row({
  line, on, wordAt, q, onSeek, rowRef,
}: {
  line: TranscriptLine; on: boolean; wordAt: number; q: string;
  onSeek: (s: number) => void; rowRef?: React.Ref<HTMLDivElement>;
}) {
  const words = useMemo(() => (q ? null : wordsOf(line)), [line, q]);
  return (
    <div
      ref={rowRef}
      aria-current={on ? "true" : undefined}
      className={clsx(
        "w-full flex items-start gap-3 px-4 py-1.5 transition-colors group",
        on ? "bg-signal/[0.13] shadow-[inset_2px_0_0_var(--signal)]" : "hover:bg-slate-2"
      )}
    >
      <button
        onClick={() => onSeek(line.start)}
        aria-label={`Play from ${readableTime(line.start)}`}
        className={clsx("tc shrink-0 pt-[3px] w-11 text-left transition-colors no-min", on ? "text-paper" : "text-dim group-hover:text-paper-2")}
      >
        {readableTime(line.start)}
      </button>
      <p className={clsx("text-[14px] font-sans leading-[1.55] transition-colors", on ? "text-paper" : "text-paper-2 group-hover:text-paper")}>
        {words
          ? words.map((w, i) => (
              <span key={i}>
                <span
                  onClick={() => onSeek(w.start)}
                  className={clsx("cursor-pointer rounded-sm hover:text-paper", on && i === wordAt && "bg-signal/30 text-paper")}
                >
                  {w.t}
                </span>
                {i < words.length - 1 ? " " : ""}
              </span>
            ))
          : marked(line.text, q).map((p, i) =>
              p.hit
                ? <mark key={i} className="bg-signal/30 text-paper rounded-sm">{p.t}</mark>
                : <span key={i} onClick={() => onSeek(line.start)} className="cursor-pointer">{p.t}</span>)}
      </p>
    </div>
  );
});

export function TranscriptPanel({
  transcript, currentTime, onSeek, chapters,
}: {
  transcript: TranscriptLine[];
  currentTime: number;
  onSeek: (s: number) => void;
  /** vm_workspace: shown as headings where each chapter starts */
  chapters?: ChapterMark[];
}) {
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const needle = q.trim();

  const activeIdx = transcript.findIndex((s) => currentTime >= s.start && currentTime < s.end);
  const active = activeIdx >= 0 ? transcript[activeIdx] : null;
  // The last word that has started, inside the sentence being said.
  let wordAt = -1;
  if (active?.words) for (let i = 0; i < active.words.length && active.words[i].start <= currentTime; i++) wordAt = i;

  useEffect(() => {
    const list = listRef.current, row = activeRef.current;
    if (!follow || needle || !list || !row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    const visible = top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight;
    if (!visible) list.scrollTo({ top: top - (list.clientHeight - row.offsetHeight) / 2, behavior: "smooth" });
  }, [activeIdx, follow, needle]);

  // Wheel, touch and keys only come from a person. The list's own
  // scrolling above does not fire them.
  const handScroll = useCallback(() => setFollow(false), []);
  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) setFollow(false);
  }, []);

  // Which sentence each chapter heading goes before: the first one that starts at or after it.
  const headings = useMemo(() => {
    const at = new Map<number, ChapterMark>();
    for (const c of [...(chapters ?? [])].sort((a, b) => a.startSeconds - b.startSeconds)) {
      let i = transcript.findIndex((s) => s.start >= c.startSeconds - 0.5);
      if (i === -1) continue;
      while (at.has(i) && i < transcript.length - 1) i++;
      if (!at.has(i)) at.set(i, c);
    }
    return at;
  }, [chapters, transcript]);

  const rows = needle
    ? transcript.map((s, i) => ({ s, i })).filter(({ s }) => s.text.toLowerCase().includes(needle.toLowerCase()))
    : transcript.map((s, i) => ({ s, i }));
  const hits = needle ? rows.reduce((n, { s }) => n + marked(s.text, needle).filter((p) => p.hit).length, 0) : 0;

  return (
    <section className="panel overflow-hidden" aria-label="Transcript">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-rule">
        <h2 className="text-[14px] font-semibold text-paper">Transcript</h2>

        <label className="relative ml-auto w-48 min-w-0">
          <span className="sr-only">Find in transcript</span>
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
            placeholder="Find in transcript"
            className="w-full h-8 pl-8 pr-2 text-[13px] font-sans"
          />
        </label>

        <button
          onClick={() => setFollow((v) => !v)}
          aria-pressed={follow}
          className={clsx(
            "h-8 px-2.5 rounded text-[13px] border transition-colors no-min shrink-0",
            follow ? "border-rule text-paper-2 hover:text-paper" : "border-rule-lit text-paper bg-slate-2 hover:bg-rule"
          )}
        >
          {follow ? "Following" : "Follow the video"}
        </button>
      </header>

      {needle && rows.length > 0 && (
        <p className="px-4 pt-2 tc" aria-live="polite">
          {hits} {hits === 1 ? "match" : "matches"} in {rows.length} {rows.length === 1 ? "sentence" : "sentences"}
        </p>
      )}

      <div
        ref={listRef}
        onWheel={handScroll}
        onTouchMove={handScroll}
        onKeyDown={onKey}
        className="relative max-h-80 overflow-y-auto py-1.5"
      >
        {rows.length === 0 && (
          <p className="px-4 py-8 text-[13.5px] text-dim">Nothing in the transcript contains "{needle}".</p>
        )}

        {rows.map(({ s, i }) => {
          const on = i === activeIdx && !needle;
          const heading = needle ? undefined : headings.get(i);
          return (
            <div key={i}>
              {heading && (
                <button
                  onClick={() => onSeek(heading.startSeconds)}
                  className="w-full flex items-baseline gap-3 px-4 pt-3 pb-1 text-left no-min group/h"
                >
                  <span className="tc w-11 shrink-0 text-dim">{readableTime(heading.startSeconds)}</span>
                  <span className="text-[13px] font-semibold text-paper group-hover/h:underline">{heading.title}</span>
                </button>
              )}
              <Row line={s} on={on} wordAt={on ? wordAt : -1} q={needle} onSeek={onSeek} rowRef={on ? activeRef : undefined} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
