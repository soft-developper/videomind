#!/usr/bin/env bash
# VideoMind — "Edit Bay" visual redesign
# New tokens · New type · Intelligence Strip · Reworked pages
# Run from your VideoMind project root

set -e
ROOT="$(pwd)"
FE="$ROOT/frontend"

if [ ! -d "$FE" ]; then
  echo "❌ Run from the project root (must contain frontend/)"
  exit 1
fi

mkdir -p "$FE/src/components/video"
mkdir -p "$FE/src/components/ui"

echo "🎨 Edit Bay redesign starting..."
echo ""

# ═════════════════════════════════════════════════════════════════════════════
# 1. TOKENS — globals.css
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/app/globals.css" << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ═══════════════════════════════════════════════════════════════════════════
   EDIT BAY — the colour of a colourist's monitor, not a crypto dashboard.
   Two accents, and each one MEANS something:
     signal (red)  = time. where you are. the playhead.
     marker (teal) = intelligence. what the AI found.
   ═══════════════════════════════════════════════════════════════════════════ */
:root {
  --void:    #0A0A0C;   /* warm-shifted near-black. not blue. */
  --slate:   #16171B;   /* panel */
  --slate-2: #1D1F24;   /* raised panel */
  --rule:    #26282F;   /* hairline */
  --rule-lit:#3A3D46;   /* hairline, hover */

  --paper:   #E8E6E1;   /* off-white. screens don't glow pure white. */
  --paper-2: #A8A6A1;   /* secondary text */
  --dim:     #6E7078;   /* metadata */
  --dim-2:   #45474E;   /* faintest */

  --signal:    #FF4D2E; /* scrub-head red — TIME */
  --signal-dim:#B33520;
  --signal-wash:rgba(255, 77, 46, 0.08);

  --marker:    #4DD8B0; /* teal — INTELLIGENCE */
  --marker-dim:#2E9C7D;
  --marker-wash:rgba(77, 216, 176, 0.08);

  --warn:    #E8B33D;
  --error:   #FF5A5A;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html { scroll-behavior: smooth; }

body {
  background: var(--void);
  color: var(--paper);
  font-family: var(--font-inter-tight), system-ui, sans-serif;
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}

/* ─── Scrollbar ──────────────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--rule-lit); }
::-webkit-scrollbar-thumb:hover { background: var(--dim); }

::selection { background: var(--signal); color: var(--void); }

/* ═══════════════════════════════════════════════════════════════════════════
   PANELS — flat, hairline-ruled. no glass, no blur.
   Blur is decoration. Rules are structure.
   ═══════════════════════════════════════════════════════════════════════════ */
.panel {
  background: var(--slate);
  border: 1px solid var(--rule);
}

.panel-raised {
  background: var(--slate-2);
  border: 1px solid var(--rule);
}

.panel-hover {
  background: var(--slate);
  border: 1px solid var(--rule);
  transition: border-color 140ms ease, background 140ms ease;
}
.panel-hover:hover {
  border-color: var(--rule-lit);
  background: var(--slate-2);
}

/* ═══════════════════════════════════════════════════════════════════════════
   TIMECODE — the most repeated element in the product.
   It should look designed, not incidental.
   ═══════════════════════════════════════════════════════════════════════════ */
.tc {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  font-size: 11px;
  color: var(--dim);
}
.tc-signal { color: var(--signal); }
.tc-marker { color: var(--marker); }

/* ─── Eyebrow label ──────────────────────────────────────────────────────── */
.eyebrow {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dim-2);
}

/* ═══════════════════════════════════════════════════════════════════════════
   INTELLIGENCE STRIP — the signature.
   Three lanes over one timeline: speech density, chapter cuts, AI highlights.
   ═══════════════════════════════════════════════════════════════════════════ */
.strip {
  background: var(--void);
  border: 1px solid var(--rule);
  position: relative;
  user-select: none;
}

.strip-lane-label {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--dim-2);
}

/* Playhead — the one thing that moves */
.playhead {
  position: absolute;
  top: 0; bottom: 0;
  width: 1px;
  background: var(--signal);
  pointer-events: none;
  z-index: 3;
  box-shadow: 0 0 6px rgba(255, 77, 46, 0.6);
}
.playhead::before {
  content: "";
  position: absolute;
  top: -3px; left: 50%;
  transform: translateX(-50%);
  width: 7px; height: 7px;
  background: var(--signal);
  clip-path: polygon(50% 100%, 0 0, 100% 0);
}

/* Highlight diamond */
.diamond {
  width: 7px; height: 7px;
  background: var(--marker);
  transform: rotate(45deg);
  transition: transform 120ms ease, box-shadow 120ms ease;
  cursor: pointer;
}
.diamond:hover {
  transform: rotate(45deg) scale(1.5);
  box-shadow: 0 0 8px var(--marker);
}
/* Ticks as the playhead passes */
@keyframes diamond-tick {
  0%   { transform: rotate(45deg) scale(1); }
  40%  { transform: rotate(45deg) scale(1.7); }
  100% { transform: rotate(45deg) scale(1); }
}
.diamond-active { animation: diamond-tick 400ms ease-out; }

/* ─── Buttons ────────────────────────────────────────────────────────────── */
.btn {
  font-family: var(--font-inter-tight), sans-serif;
  font-weight: 500;
  font-size: 13px;
  letter-spacing: -0.01em;
  transition: all 140ms ease;
  border: 1px solid transparent;
}

.btn-signal {
  background: var(--signal);
  color: var(--void);
}
.btn-signal:hover { background: #FF6449; }

.btn-ghost {
  background: transparent;
  border-color: var(--rule);
  color: var(--paper-2);
}
.btn-ghost:hover {
  border-color: var(--rule-lit);
  color: var(--paper);
  background: var(--slate);
}

.btn-marker {
  background: transparent;
  border-color: var(--marker-dim);
  color: var(--marker);
}
.btn-marker:hover { background: var(--marker-wash); }

/* ─── Inputs ─────────────────────────────────────────────────────────────── */
input, textarea {
  font-family: var(--font-inter-tight), sans-serif;
  background: var(--void);
  border: 1px solid var(--rule);
  color: var(--paper);
  transition: border-color 140ms ease;
}
input:focus, textarea:focus {
  outline: none;
  border-color: var(--rule-lit);
}
input::placeholder, textarea::placeholder { color: var(--dim-2); }

/* ─── Loading: a scanning line, not a spinner ────────────────────────────── */
.scan {
  position: relative;
  overflow: hidden;
  background: var(--slate);
}
.scan::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(232, 230, 225, 0.04),
    transparent
  );
  animation: scan-sweep 1.4s ease-in-out infinite;
}
@keyframes scan-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* ─── Status dot ─────────────────────────────────────────────────────────── */
.dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-live { background: var(--marker); animation: dot-pulse 2s ease-in-out infinite; }
.dot-work { background: var(--warn);   animation: dot-pulse 1.2s ease-in-out infinite; }
.dot-dead { background: var(--error); }
@keyframes dot-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.25; }
}

/* ─── Chat bubbles ───────────────────────────────────────────────────────── */
.bubble-you {
  background: var(--signal-wash);
  border-left: 2px solid var(--signal);
}
.bubble-ai {
  background: var(--slate);
  border-left: 2px solid var(--rule-lit);
}

/* ─── Drop zone ──────────────────────────────────────────────────────────── */
.drop-live {
  border-color: var(--signal) !important;
  background: var(--signal-wash) !important;
}

/* ─── Utilities ──────────────────────────────────────────────────────────── */
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }

.rule-x { border-top: 1px solid var(--rule); }
.rule-y { border-left: 1px solid var(--rule); }

/* Keyboard focus — visible, never removed */
:focus-visible {
  outline: 2px solid var(--signal);
  outline-offset: 2px;
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Touch targets */
@media (pointer: coarse) {
  button, a { min-height: 44px; }
  .no-min { min-height: unset; }
}
EOF
echo "✅ globals.css  — Edit Bay tokens"

# ═════════════════════════════════════════════════════════════════════════════
# 2. TAILWIND CONFIG
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/tailwind.config.ts" << 'EOF'
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-instrument)", "Georgia", "serif"],
        sans:    ["var(--font-inter-tight)", "system-ui", "sans-serif"],
        mono:    ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        void:    "#0A0A0C",
        slate:   { DEFAULT: "#16171B", 2: "#1D1F24" },
        rule:    { DEFAULT: "#26282F", lit: "#3A3D46" },
        paper:   { DEFAULT: "#E8E6E1", 2: "#A8A6A1" },
        dim:     { DEFAULT: "#6E7078", 2: "#45474E" },
        signal:  { DEFAULT: "#FF4D2E", dim: "#B33520" },
        marker:  { DEFAULT: "#4DD8B0", dim: "#2E9C7D" },
        warn:    "#E8B33D",
        error:   "#FF5A5A",
      },
      letterSpacing: {
        tightest: "-0.03em",
        tc: "0.06em",
      },
      borderRadius: {
        // Edit bays are rectilinear. Almost no radius.
        none: "0",
        xs: "2px",
        sm: "3px",
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};

export default config;
EOF
echo "✅ tailwind.config.ts"

# ═════════════════════════════════════════════════════════════════════════════
# 3. LAYOUT — new typefaces
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/app/layout.tsx" << 'EOF'
import type { Metadata } from "next";
import { Instrument_Serif, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/layout/AppProviders";

// Display — editorial serif. Video is media; media has an editorial voice.
const instrument = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument",
  weight: ["400"],
  style: ["normal", "italic"],
});

// Body — narrow, dense, gets out of the way.
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  weight: ["400", "500", "600"],
});

// Data — timecodes, durations, blob names.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "VideoMind — see the shape of any video",
  description:
    "Upload a video. AI reads it, maps it, and answers questions about it. Stored on Shelby Protocol, owned by your wallet.",
  keywords: [
    "Shelby Protocol", "AI video", "video intelligence", "Aptos",
    "decentralized storage", "transcript", "video search",
  ],
  openGraph: {
    title: "VideoMind — see the shape of any video",
    description:
      "AI reads your video, maps its structure, and answers questions about it. Stored on Shelby Protocol.",
    type: "website",
    siteName: "VideoMind",
  },
  twitter: {
    card: "summary_large_image",
    title: "VideoMind — see the shape of any video",
    description: "AI reads your video, maps its structure, and answers questions about it.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${instrument.variable} ${interTight.variable} ${mono.variable}`}
    >
      <body className="bg-void text-paper antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
EOF
echo "✅ layout.tsx  — Instrument Serif / Inter Tight / IBM Plex Mono"

# ═════════════════════════════════════════════════════════════════════════════
# 4. THE SIGNATURE — Intelligence Strip
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/video/IntelligenceStrip.tsx" << 'EOF'
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
EOF
echo "✅ IntelligenceStrip.tsx  — THE SIGNATURE"

# ═════════════════════════════════════════════════════════════════════════════
# 5. NAVBAR
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/layout/Navbar.tsx" << 'EOF'
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { clsx } from "clsx";
import { WalletButton } from "./WalletButton";
import { ExpiryBanner } from "./ExpiryBanner";
import { useState, useEffect } from "react";

const NAV = [
  { href: "/",          label: "Library" },
  { href: "/upload",    label: "Upload" },
  { href: "/search",    label: "Search" },
  { href: "/assistant", label: "Assistant" },
  { href: "/learn",     label: "Learn" },
  { href: "/about",     label: "About" },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <nav className="fixed top-0 inset-x-0 z-50 h-14 bg-void border-b border-rule">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-4">

          {/* Mark — a playhead triangle. the product IS a playhead. */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
              <path
                d="M7 16L0 0h14L7 16z"
                className="fill-signal group-hover:fill-[#FF6449] transition-colors"
              />
            </svg>
            <span className="font-display text-[19px] leading-none text-paper tracking-tight">
              VideoMind
            </span>
          </Link>

          {/* Links — text only. no icons. */}
          <div className="hidden md:flex items-center">
            {NAV.map(({ href, label }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "px-3 py-1.5 text-[13px] font-sans transition-colors relative",
                    active ? "text-paper" : "text-dim hover:text-paper-2"
                  )}
                >
                  {label}
                  {active && (
                    <span className="absolute bottom-0 left-3 right-3 h-px bg-signal" />
                  )}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <span className="dot dot-live" />
              <span className="tc">Shelby testnet</span>
            </div>
            <WalletButton />
            <button
              onClick={() => setOpen((v) => !v)}
              className="md:hidden w-8 h-8 flex items-center justify-center text-dim hover:text-paper transition-colors"
              aria-label="Menu"
            >
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
      </nav>

      <ExpiryBanner />

      {/* Mobile drawer */}
      <div className={clsx(
        "fixed inset-0 z-40 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}>
        <div
          className={clsx(
            "absolute inset-0 bg-void/90 transition-opacity duration-200",
            open ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setOpen(false)}
        />
        <div className={clsx(
          "absolute top-14 inset-x-0 bg-void border-b border-rule transition-transform duration-200",
          open ? "translate-y-0" : "-translate-y-full"
        )}>
          {NAV.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center px-6 py-3.5 text-sm font-sans border-b border-rule/50 transition-colors",
                  active ? "text-paper bg-slate" : "text-dim"
                )}
              >
                {active && <span className="w-0.5 h-4 bg-signal mr-3 -ml-3" />}
                {label}
              </Link>
            );
          })}
          <div className="flex items-center gap-2 px-6 py-3">
            <span className="dot dot-live" />
            <span className="tc">Shelby testnet</span>
          </div>
        </div>
      </div>
    </>
  );
}
EOF
echo "✅ Navbar.tsx  — playhead mark, text-only links"

# ═════════════════════════════════════════════════════════════════════════════
# 6. WALLET BUTTON
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/layout/WalletButton.tsx" << 'EOF'
"use client";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown, LogOut, Copy, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

export function WalletButton() {
  const { connect, disconnect, connected, isLoading, account, wallets = [] } = useWallet();
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenu(false); setPicker(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => { if (connected) setPicker(false); }, [connected]);

  const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 h-8 border border-rule">
        <span className="dot dot-work" />
        <span className="tc">Connecting</span>
      </div>
    );
  }

  if (connected && account) {
    const addr = account.address.toString();
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setMenu((v) => !v)}
          className="flex items-center gap-2 px-3 h-8 border border-rule hover:border-rule-lit transition-colors"
        >
          <span className="dot dot-live" />
          <span className="tc text-paper-2">{short(addr)}</span>
          <ChevronDown size={11} className={clsx("text-dim transition-transform", menu && "rotate-180")} />
        </button>

        {menu && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-void border border-rule z-50">
            <div className="px-3 py-2.5 border-b border-rule">
              <p className="eyebrow mb-1">Wallet</p>
              <p className="tc text-paper-2">{short(addr)}</p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(addr);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-paper-2 hover:text-paper hover:bg-slate transition-colors"
            >
              {copied ? <Check size={12} className="text-marker" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <button
              onClick={() => { disconnect(); setMenu(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-dim hover:text-error hover:bg-slate transition-colors border-t border-rule"
            >
              <LogOut size={12} />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setPicker((v) => !v)}
        className="btn btn-signal px-3.5 h-8 flex items-center gap-1.5"
      >
        Connect wallet
        <ChevronDown size={11} className={clsx("transition-transform", picker && "rotate-180")} />
      </button>

      {picker && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-void border border-rule z-50">
          <div className="px-3 py-2 border-b border-rule">
            <p className="eyebrow">Select wallet</p>
          </div>

          {wallets.length === 0 && (
            <p className="px-3 py-3 text-[12px] font-sans text-dim leading-relaxed">
              No Aptos wallet found. Install{" "}
              <a
                href="https://petra.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal underline"
              >
                Petra
              </a>{" "}
              to continue.
            </p>
          )}

          {wallets.map((w) => (
            <button
              key={w.name}
              onClick={() => { connect(w.name); setPicker(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-paper-2 hover:text-paper hover:bg-slate transition-colors"
            >
              {w.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.icon} alt="" className="w-4 h-4" />
              )}
              {w.name}
              {w.readyState === "Installed" && (
                <span className="ml-auto tc tc-marker">ready</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
EOF
echo "✅ WalletButton.tsx"

# ═════════════════════════════════════════════════════════════════════════════
# 7. VIDEO CARD
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/video/VideoCard.tsx" << 'EOF'
"use client";
import Link from "next/link";
import { Trash2, X, Play } from "lucide-react";
import { clsx } from "clsx";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { api } from "@/lib/api";
import type { VideoRecord } from "@/lib/api";

const STATUS: Record<string, { label: string; dot: string }> = {
  uploading:    { label: "Uploading",    dot: "dot-work" },
  processing:   { label: "Processing",   dot: "dot-work" },
  transcribing: { label: "Transcribing", dot: "dot-work" },
  analyzing:    { label: "Analyzing",    dot: "dot-work" },
  ready:        { label: "Ready",        dot: "dot-live" },
  error:        { label: "Failed",       dot: "dot-dead" },
};

function tc(sec?: number) {
  if (!sec || !isFinite(sec)) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function when(ms: number) {
  const d = Date.now() - ms;
  const min = Math.floor(d / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(ms));
}

/** Mini density preview — the card carries a fingerprint of the video's shape. */
function MiniStrip({ transcript, duration }: { transcript?: any[]; duration?: number }) {
  const bars = useMemo(() => {
    if (!transcript?.length || !duration) return [];
    const N = 48;
    const lane = new Array(N).fill(0);
    const bd = duration / N;
    for (const seg of transcript) {
      const dur = Math.max(seg.end - seg.start, 0.1);
      const cps = seg.text.length / dur;
      const a = Math.max(0, Math.floor(seg.start / bd));
      const b = Math.min(N, Math.ceil(seg.end / bd));
      for (let i = a; i < b; i++) lane[i] = Math.max(lane[i], cps);
    }
    const max = Math.max(...lane, 1);
    return lane.map((v) => v / max);
  }, [transcript, duration]);

  if (!bars.length) return null;

  return (
    <div className="flex items-end gap-px h-5 px-3 pb-2">
      {bars.map((v, i) => (
        <div
          key={i}
          className="flex-1 min-w-0"
          style={{
            height: v === 0 ? "1px" : `${Math.max(v * 100, 15)}%`,
            background: v === 0 ? "var(--dim-2)" : `rgba(232,230,225,${0.1 + v * 0.35})`,
          }}
        />
      ))}
    </div>
  );
}

export function VideoCard({ video }: { video: VideoRecord }) {
  const st = STATUS[video.status] ?? STATUS.ready;
  const isError = video.status === "error";
  const isWorking = !["ready", "error"].includes(video.status);
  const dur = tc(video.meta.durationSeconds);

  const { account } = useWallet();
  const qc = useQueryClient();
  const wallet = account?.address?.toString();

  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [gone, setGone] = useState(false);

  const del = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm) { setConfirm(true); return; }
    setDeleting(true);
    try {
      await api.delete(`/api/videos/${video.id}`);
      setGone(true);
      qc.invalidateQueries({ queryKey: ["videos", wallet] });
      qc.invalidateQueries({ queryKey: ["shelby-stats", wallet] });
      qc.invalidateQueries({ queryKey: ["shelby-badge", wallet] });
    } catch { setDeleting(false); setConfirm(false); }
  };

  if (gone) return null;

  return (
    <div className="relative group">
      <Link href={`/video/${video.id}`} className="block">
        <article className={clsx(
          "panel-hover",
          isError && "border-error/25",
          confirm && "border-error"
        )}>
          {/* Frame */}
          <div className="relative aspect-video bg-void overflow-hidden border-b border-rule">
            {isWorking && <div className="absolute inset-0 scan" />}

            {/* Slate — like a film clapper board */}
            <div className="absolute inset-0 flex flex-col justify-between p-3">
              <div className="flex items-start justify-between">
                <span className="eyebrow">{video.id.slice(0, 8)}</span>
                <span className="flex items-center gap-1.5">
                  <span className={clsx("dot", st.dot)} />
                  <span className="tc">{st.label}</span>
                </span>
              </div>

              {video.status === "ready" && (
                <div className="flex items-end justify-between">
                  <span className="tc">Shelby</span>
                  {dur && <span className="tc tabular-nums text-paper-2">{dur}</span>}
                </div>
              )}
            </div>

            {/* Play on hover */}
            {video.status === "ready" && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="w-9 h-9 bg-signal flex items-center justify-center">
                  <Play size={13} className="text-void ml-0.5" fill="currentColor" />
                </span>
              </div>
            )}

            {/* Delete */}
            {!confirm && (
              <button
                onClick={del}
                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-dim-2 hover:text-error opacity-0 group-hover:opacity-100 transition-all no-min"
                aria-label="Delete"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>

          {/* Density fingerprint */}
          {video.status === "ready" && (
            <MiniStrip
              transcript={video.ai?.transcript}
              duration={video.meta.durationSeconds}
            />
          )}

          {/* Meta */}
          <div className="px-3 pb-3 pt-1 space-y-2">
            <h3 className={clsx(
              "font-display text-[17px] leading-[1.2] line-clamp-2 transition-colors",
              isError ? "text-dim" : "text-paper group-hover:text-signal"
            )}>
              {video.title}
            </h3>

            {!isError && video.ai?.tags && video.ai.tags.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {video.ai.tags.slice(0, 3).map((t) => (
                  <span key={t} className="tc lowercase">{t}</span>
                ))}
              </div>
            )}

            {isError && (
              <p className="text-[12px] font-sans text-error/60">
                Processing failed — open to retry
              </p>
            )}

            <p className="tc">{when(video.createdAt)}</p>
          </div>
        </article>
      </Link>

      {/* Confirm */}
      {confirm && (
        <div
          className="absolute inset-0 bg-void/95 flex flex-col items-center justify-center gap-4 p-4 z-10 border border-error"
          onClick={(e) => e.preventDefault()}
        >
          <p className="font-display text-[16px] text-paper text-center leading-tight">
            Delete this video?
          </p>
          <p className="text-[12px] font-sans text-dim text-center leading-relaxed">
            Removed from your library. The blob expires on Shelby naturally.
          </p>
          <div className="flex gap-2 w-full">
            <button
              onClick={del}
              disabled={deleting}
              className="flex-1 h-8 text-[12px] font-sans bg-error/15 border border-error/40 text-error hover:bg-error/25 transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirm(false); }}
              className="flex-1 h-8 text-[12px] font-sans btn-ghost flex items-center justify-center gap-1"
            >
              <X size={11} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
EOF
echo "✅ VideoCard.tsx  — density fingerprint on every card"

# ═════════════════════════════════════════════════════════════════════════════
# 8. SKELETON
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/ui/SkeletonCard.tsx" << 'EOF'
export function SkeletonCard() {
  return (
    <div className="panel">
      <div className="aspect-video scan border-b border-rule" />
      <div className="h-5 scan m-3" />
      <div className="px-3 pb-3 space-y-2">
        <div className="h-4 scan w-3/4" />
        <div className="h-3 scan w-1/3" />
      </div>
    </div>
  );
}

export function SkeletonVideoPage() {
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5">
      <div className="space-y-4">
        <div className="aspect-video scan border border-rule" />
        <div className="h-24 scan border border-rule" />
        <div className="h-64 scan border border-rule" />
      </div>
      <div className="h-96 scan border border-rule" />
    </div>
  );
}
EOF
echo "✅ SkeletonCard.tsx"

echo ""
echo "──────────────────────────────────────────"
echo "Part 1 of 2 done. Run redesign2.sh next."
echo "──────────────────────────────────────────"
