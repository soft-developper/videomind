"use client";
import { useRef, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import type { Segment } from "@/lib/exports";
import { readableTime } from "@/lib/exports";

export function TranscriptPanel({
  transcript, currentTime, onSeek,
}: {
  transcript: Segment[];
  currentTime: number;
  onSeek: (s: number) => void;
}) {
  const [q, setQ] = useState("");
  const [follow, setFollow] = useState(true);
  const activeRef = useRef<HTMLButtonElement>(null);

  const activeIdx = transcript.findIndex(
    (s) => currentTime >= s.start && currentTime < s.end
  );

  useEffect(() => {
    if (!follow || q) return;
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIdx, follow, q]);

  const rows = q.trim()
    ? transcript.map((s, i) => ({ s, i })).filter(({ s }) =>
        s.text.toLowerCase().includes(q.toLowerCase()))
    : transcript.map((s, i) => ({ s, i }));

  return (
    <section className="panel">
      <header className="flex items-center gap-3 px-3 h-10 border-b border-rule">
        <span className="eyebrow">Transcript</span>

        <div className="relative ml-auto w-40">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim-2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find…"
            className="w-full h-6 pl-6 pr-2 text-[11px] font-sans bg-void border border-rule"
          />
        </div>

        <button
          onClick={() => setFollow((v) => !v)}
          className={clsx("tc transition-colors no-min", follow ? "tc-signal" : "text-dim-2 hover:text-dim")}
        >
          {follow ? "following" : "free"}
        </button>
      </header>

      <div className="max-h-72 overflow-y-auto">
        {rows.length === 0 && (
          <p className="px-3 py-8 text-center tc">No match for "{q}"</p>
        )}

        {rows.map(({ s, i }) => {
          const on = i === activeIdx && !q;
          return (
            <button
              key={i}
              ref={on ? activeRef : undefined}
              onClick={() => onSeek(s.start)}
              className={clsx(
                "w-full flex items-start gap-3 px-3 py-1.5 text-left transition-colors no-min group",
                on ? "bg-signal-wash" : "hover:bg-slate"
              )}
            >
              <span className={clsx(
                "tc tabular-nums shrink-0 pt-0.5 w-10 text-right transition-colors",
                on ? "tc-signal" : "text-dim-2 group-hover:text-dim"
              )}>
                {readableTime(s.start)}
              </span>
              <span className={clsx(
                "text-[13px] font-sans leading-[1.5] transition-colors",
                on ? "text-paper" : "text-paper-2/70 group-hover:text-paper-2"
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
