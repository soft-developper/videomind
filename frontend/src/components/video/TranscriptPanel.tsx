"use client";
import { useRef, useEffect } from "react";
import { FileText, Search } from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";
import type { Segment } from "@/lib/exports";
import { readableTime } from "@/lib/exports";

interface TranscriptPanelProps {
  transcript: Segment[];
  currentTime: number;
  onSeek: (seconds: number) => void;
}

export function TranscriptPanel({ transcript, currentTime, onSeek }: TranscriptPanelProps) {
  const [query, setQuery] = useState("");
  const activeRef = useRef<HTMLButtonElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Index of the segment currently playing
  const activeIdx = transcript.findIndex(
    (seg) => currentTime >= seg.start && currentTime < seg.end
  );

  // Keep the active line in view (only when not searching, and if enabled)
  useEffect(() => {
    if (!autoScroll || query) return;
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeIdx, autoScroll, query]);

  const filtered = query.trim()
    ? transcript
        .map((seg, i) => ({ seg, i }))
        .filter(({ seg }) => seg.text.toLowerCase().includes(query.toLowerCase()))
    : transcript.map((seg, i) => ({ seg, i }));

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/[0.06]">
        <FileText size={14} className="text-white/40 shrink-0" />
        <p className="text-sm font-syne font-semibold text-white shrink-0">Transcript</p>

        {/* Inline search */}
        <div className="relative flex-1 max-w-[200px] ml-auto">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="w-full bg-dark-800 border border-white/[0.06] rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-white placeholder-white/20 font-dm focus:outline-none focus:border-volt/30 transition-all"
          />
        </div>

        <span className="font-mono text-[10px] text-white/20 shrink-0">
          {query ? `${filtered.length} found` : `${transcript.length} lines`}
        </span>
      </div>

      {/* Auto-scroll toggle */}
      {!query && (
        <div className="px-4 py-2 border-b border-white/[0.04] flex items-center justify-between">
          <p className="text-[10px] font-mono text-white/20">
            Click any line to jump to that moment
          </p>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={clsx(
              "text-[10px] font-mono transition-colors",
              autoScroll ? "text-volt/60 hover:text-volt" : "text-white/20 hover:text-white/40"
            )}
          >
            {autoScroll ? "● Auto-scroll on" : "○ Auto-scroll off"}
          </button>
        </div>
      )}

      {/* Segments */}
      <div className="max-h-80 overflow-y-auto p-2">
        {filtered.length === 0 && (
          <p className="text-center py-8 text-xs text-white/25 font-mono">
            No lines match "{query}"
          </p>
        )}

        {filtered.map(({ seg, i }) => {
          const active = i === activeIdx && !query;
          return (
            <button
              key={i}
              ref={active ? activeRef : undefined}
              onClick={() => onSeek(seg.start)}
              className={clsx(
                "w-full flex items-start gap-3 px-3 py-2 rounded-lg text-left transition-all group",
                active
                  ? "bg-volt/[0.08] border border-volt/20"
                  : "border border-transparent hover:bg-white/[0.03]"
              )}
            >
              <span className={clsx(
                "font-mono text-[10px] shrink-0 mt-0.5 w-11 text-right tabular-nums transition-colors",
                active ? "text-volt" : "text-volt/40 group-hover:text-volt/70"
              )}>
                {readableTime(seg.start)}
              </span>
              <p className={clsx(
                "text-sm font-dm leading-relaxed transition-colors",
                active ? "text-white" : "text-white/50 group-hover:text-white/80"
              )}>
                {seg.text}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
