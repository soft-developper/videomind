"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import type { Segment } from "@/lib/exports";
import { readableTime } from "@/lib/exports";

// vm_shell: following the video scrolls this list only, never the page.
// The moment the reader scrolls the list by hand, following stops, and a
// button brings it back. Nothing moves under someone who is reading.
export function TranscriptPanel({
  transcript, currentTime, onSeek,
}: {
  transcript: Segment[];
  currentTime: number;
  onSeek: (s: number) => void;
}) {
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const activeIdx = transcript.findIndex(
    (s) => currentTime >= s.start && currentTime < s.end
  );

  useEffect(() => {
    const list = listRef.current, row = activeRef.current;
    if (!follow || q || !list || !row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    const visible = top >= list.scrollTop && bottom <= list.scrollTop + list.clientHeight;
    if (!visible) {
      list.scrollTo({ top: top - (list.clientHeight - row.offsetHeight) / 2, behavior: "smooth" });
    }
  }, [activeIdx, follow, q]);

  // Wheel, touch and keys only come from a person. The list's own
  // scrolling above does not fire them.
  const handScroll = useCallback(() => setFollow(false), []);
  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) setFollow(false);
  }, []);

  const rows = q.trim()
    ? transcript.map((s, i) => ({ s, i })).filter(({ s }) =>
        s.text.toLowerCase().includes(q.toLowerCase()))
    : transcript.map((s, i) => ({ s, i }));

  return (
    <section className="panel overflow-hidden" aria-label="Transcript">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-rule">
        <h2 className="text-[14px] font-semibold text-paper">Transcript</h2>

        <label className="relative ml-auto w-48">
          <span className="sr-only">Find in transcript</span>
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find in transcript"
            className="w-full h-8 pl-8 pr-2 text-[13px] font-sans"
          />
        </label>

        <button
          onClick={() => setFollow((v) => !v)}
          aria-pressed={follow}
          className={clsx(
            "h-8 px-2.5 rounded text-[13px] border transition-colors no-min",
            follow ? "border-rule text-paper-2 hover:text-paper" : "border-rule-lit text-paper bg-slate-2 hover:bg-rule"
          )}
        >
          {follow ? "Following" : "Follow the video"}
        </button>
      </header>

      <div
        ref={listRef}
        onWheel={handScroll}
        onTouchMove={handScroll}
        onKeyDown={onKey}
        className="relative max-h-80 overflow-y-auto py-1.5"
      >
        {rows.length === 0 && (
          <p className="px-4 py-8 text-[13.5px] text-dim">Nothing in the transcript contains "{q}".</p>
        )}

        {rows.map(({ s, i }) => {
          const on = i === activeIdx && !q;
          return (
            <button
              key={i}
              ref={on ? activeRef : undefined}
              onClick={() => onSeek(s.start)}
              aria-current={on ? "true" : undefined}
              className={clsx(
                "w-full flex items-start gap-3 px-4 py-1.5 text-left transition-colors no-min group",
                on ? "bg-signal/[0.13] shadow-[inset_2px_0_0_var(--signal)]" : "hover:bg-slate-2"
              )}
            >
              <span className={clsx(
                "tc shrink-0 pt-[3px] w-11 transition-colors",
                on ? "text-paper" : "text-dim group-hover:text-paper-2"
              )}>
                {readableTime(s.start)}
              </span>
              <span className={clsx(
                "text-[14px] font-sans leading-[1.55] transition-colors",
                on ? "text-paper" : "text-paper-2 group-hover:text-paper"
              )}>
                {s.text}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
