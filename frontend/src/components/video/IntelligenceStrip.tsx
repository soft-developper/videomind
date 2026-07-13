"use client";
/**
 * THE INTELLIGENCE STRIP
 *
 * Three lanes over one timeline. Not a progress bar — a map.
 *
 *   SPEECH   ░▓█▓░░░░▓███▓░░░░░▓█▓░░░░  ← density from transcript. gaps = silence.
 *   CUTS     ┃      ┃        ┃     ┃    ← chapter boundaries
 *   FOUND       ◆         ◆      ◆      ← what the AI thought mattered
 *              ▲                        ← playhead (red = time)
 *
 * You look at a 2-hour video and see its shape in one glance.
 */
import { useMemo, useRef, useState, useCallback } from "react";
import { clsx } from "clsx";

interface Segment { start: number; end: number; text: string; }
interface Chapter { title: string; startSeconds: number; summary: string; }
interface Highlight { startSeconds: number; endSeconds: number; reason: string; text: string; }

interface Props {
  duration: number;
  currentTime: number;
  transcript?: Segment[];
  chapters?: Chapter[];
  highlights?: Highlight[];
  onSeek: (seconds: number) => void;
}

const BUCKETS = 240;

function tc(sec: number) {
  if (!isFinite(sec)) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function IntelligenceStrip({
  duration, currentTime, transcript, chapters, highlights, onSeek,
}: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; label: string; kind: "cut" | "found" } | null>(null);

  // ── Speech density ────────────────────────────────────────────────────────
  // Characters-per-second per bucket. Silence stays at zero and reads as a gap.
  const density = useMemo(() => {
    if (!transcript?.length || !duration) return [];
    const lane = new Array(BUCKETS).fill(0);
    const bucketDur = duration / BUCKETS;

    for (const seg of transcript) {
      const segDur = Math.max(seg.end - seg.start, 0.1);
      const cps = seg.text.length / segDur;
      const a = Math.max(0, Math.floor(seg.start / bucketDur));
      const b = Math.min(BUCKETS, Math.ceil(seg.end / bucketDur));
      for (let i = a; i < b; i++) lane[i] = Math.max(lane[i], cps);
    }

    const max = Math.max(...lane, 1);
    return lane.map((v) => v / max);
  }, [transcript, duration]);

  const pct = (sec: number) => (duration ? Math.min(Math.max(sec / duration, 0), 1) * 100 : 0);

  const seekFromEvent = useCallback((clientX: number) => {
    const rail = railRef.current;
    if (!rail || !duration) return;
    const r = rail.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    onSeek(ratio * duration);
  }, [duration, onSeek]);

  const onMove = (e: React.MouseEvent) => {
    const rail = railRef.current;
    if (!rail) return;
    const r = rail.getBoundingClientRect();
    setHoverX(Math.min(Math.max(e.clientX - r.left, 0), r.width));
  };

  const hoverTime = hoverX !== null && railRef.current
    ? (hoverX / railRef.current.getBoundingClientRect().width) * duration
    : null;

  // Which highlight is playing right now?
  const activeHl = highlights?.findIndex(
    (h) => currentTime >= h.startSeconds && currentTime <= h.endSeconds
  ) ?? -1;

  if (!duration) return null;

  const hasData = density.length > 0 || (chapters?.length ?? 0) > 0 || (highlights?.length ?? 0) > 0;
  if (!hasData) return null;

  return (
    <div className="strip">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-rule">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Intelligence strip</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-[3px] bg-paper-2" />
              <span className="strip-lane-label">Speech</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-[1px] h-2.5 bg-paper-2" />
              <span className="strip-lane-label">Cuts</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-marker rotate-45" />
              <span className="strip-lane-label">Found</span>
            </span>
          </div>
        </div>
        <span className="tc tc-signal tabular-nums">{tc(currentTime)}</span>
      </div>

      {/* The rail */}
      <div
        ref={railRef}
        className="relative cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => { setHoverX(null); setTip(null); }}
        onClick={(e) => seekFromEvent(e.clientX)}
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(currentTime + 5, duration));
          if (e.key === "ArrowLeft")  onSeek(Math.max(currentTime - 5, 0));
        }}
      >
        {/* ── LANE 1: speech density ─────────────────────────────────────── */}
        <div className="flex items-end h-11 gap-px px-px pt-2">
          {density.map((v, i) => (
            <div
              key={i}
              className="flex-1 min-w-0 transition-colors"
              style={{
                height: v === 0 ? "1px" : `${Math.max(v * 100, 12)}%`,
                background: v === 0
                  ? "var(--dim-2)"
                  : `rgba(232, 230, 225, ${0.14 + v * 0.5})`,
              }}
            />
          ))}
        </div>

        {/* ── LANE 2: chapter cuts ───────────────────────────────────────── */}
        <div className="relative h-4 border-t border-rule">
          {(chapters ?? []).map((ch, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); onSeek(ch.startSeconds); }}
              onMouseEnter={(e) => {
                e.stopPropagation();
                setTip({ x: pct(ch.startSeconds), label: ch.title, kind: "cut" });
              }}
              onMouseLeave={() => setTip(null)}
              className="absolute top-0 bottom-0 w-3 -translate-x-1/2 flex justify-center group no-min"
              style={{ left: `${pct(ch.startSeconds)}%` }}
              aria-label={`Chapter: ${ch.title}`}
            >
              <span className="w-px h-full bg-dim group-hover:bg-paper transition-colors" />
            </button>
          ))}
        </div>

        {/* ── LANE 3: AI highlights ──────────────────────────────────────── */}
        <div className="relative h-6 border-t border-rule">
          {(highlights ?? []).map((hl, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); onSeek(hl.startSeconds); }}
              onMouseEnter={(e) => {
                e.stopPropagation();
                setTip({ x: pct(hl.startSeconds), label: hl.reason, kind: "found" });
              }}
              onMouseLeave={() => setTip(null)}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center no-min"
              style={{ left: `${pct(hl.startSeconds)}%` }}
              aria-label={`Highlight: ${hl.reason}`}
            >
              <span className={clsx("diamond", i === activeHl && "diamond-active")} />
            </button>
          ))}
        </div>

        {/* Playhead — the one thing that moves */}
        <div className="playhead" style={{ left: `${pct(currentTime)}%` }} />

        {/* Hover scrub line */}
        {hoverX !== null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-paper-2/30 pointer-events-none z-2"
            style={{ left: `${hoverX}px` }}
          />
        )}

        {/* Hover timecode */}
        {hoverTime !== null && hoverX !== null && !tip && (
          <div
            className="absolute -top-6 -translate-x-1/2 px-1.5 py-0.5 bg-void border border-rule pointer-events-none z-10"
            style={{ left: `${hoverX}px` }}
          >
            <span className="tc tabular-nums">{tc(hoverTime)}</span>
          </div>
        )}

        {/* Marker tooltip */}
        {tip && (
          <div
            className="absolute -top-8 -translate-x-1/2 px-2 py-1 bg-void border pointer-events-none z-10 max-w-[220px]"
            style={{
              left: `${tip.x}%`,
              borderColor: tip.kind === "found" ? "var(--marker-dim)" : "var(--rule-lit)",
            }}
          >
            <p className={clsx(
              "text-[11px] font-sans leading-tight truncate",
              tip.kind === "found" ? "text-marker" : "text-paper-2"
            )}>
              {tip.label}
            </p>
          </div>
        )}
      </div>

      {/* Footer — the ruler */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-rule">
        <span className="tc tabular-nums">0:00</span>
        <div className="flex items-center gap-4">
          {(chapters?.length ?? 0) > 0 && (
            <span className="tc">{chapters!.length} cuts</span>
          )}
          {(highlights?.length ?? 0) > 0 && (
            <span className="tc tc-marker">{highlights!.length} found</span>
          )}
        </div>
        <span className="tc tabular-nums">{tc(duration)}</span>
      </div>
    </div>
  );
}
