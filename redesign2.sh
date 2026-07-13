#!/usr/bin/env bash
# VideoMind — Edit Bay redesign, part 2
# Pages: video detail, library, upload
# Run AFTER redesign.sh, from the project root

set -e
FE="$(pwd)/frontend"
[ -d "$FE" ] || { echo "❌ Run from project root"; exit 1; }

echo "🎨 Part 2 — pages..."
echo ""

# ═════════════════════════════════════════════════════════════════════════════
# 1. VIDEO PLAYER — stripped chrome. the strip is the interface now.
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/video/VideoPlayer.tsx" << 'EOF'
"use client";
import {
  useState, useRef, useEffect, forwardRef, useImperativeHandle,
} from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, AlertTriangle } from "lucide-react";
import { clsx } from "clsx";

export interface VideoPlayerHandle {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
}

interface Props {
  streamUrl: string | null;
  title: string;
  shelbyAddress?: string;
  blobName?: string;
  onDuration?: (seconds: number) => void;
  onTimeUpdate?: (seconds: number) => void;
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(
  function VideoPlayer({ streamUrl, onDuration, onTimeUpdate }, ref) {
    const v = useRef<HTMLVideoElement>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [show, setShow] = useState(true);
    const hide = useRef<ReturnType<typeof setTimeout>>();
    const durSent = useRef(false);

    useImperativeHandle(ref, () => ({
      seekTo: (s: number) => {
        const el = v.current;
        if (!el) return;
        el.currentTime = s;
        el.play().catch(() => {});
        setPlaying(true);
      },
      getCurrentTime: () => v.current?.currentTime ?? 0,
    }));

    const bump = () => {
      if (hide.current) clearTimeout(hide.current);
      setShow(true);
      hide.current = setTimeout(() => { if (playing) setShow(false); }, 2600);
    };

    useEffect(() => () => { if (hide.current) clearTimeout(hide.current); }, []);

    const toggle = () => {
      const el = v.current;
      if (!el) return;
      el.paused ? (el.play(), setPlaying(true)) : (el.pause(), setPlaying(false));
      bump();
    };

    if (!streamUrl) {
      return (
        <div className="aspect-video bg-void border border-rule flex items-center justify-center">
          <span className="tc">No stream</span>
        </div>
      );
    }

    return (
      <div
        className="relative aspect-video bg-void border border-rule group overflow-hidden"
        onMouseMove={bump}
        onMouseLeave={() => playing && setShow(false)}
      >
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-void">
            <div className="flex items-center gap-2.5">
              <span className="dot dot-work" />
              <span className="tc">Loading from Shelby</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-void px-6 text-center">
            <AlertTriangle size={20} className="text-error" />
            <p className="font-display text-[17px] text-paper">Blob unavailable</p>
            <p className="text-[12px] font-sans text-dim max-w-xs leading-relaxed">
              This video may have expired on Shelby. Renew it to restore access.
            </p>
          </div>
        )}

        <video
          ref={v}
          src={streamUrl}
          className="w-full h-full object-contain"
          preload="metadata"
          onClick={toggle}
          onLoadStart={() => setLoading(true)}
          onCanPlay={() => setLoading(false)}
          onLoadedMetadata={() => {
            const el = v.current;
            if (!el || durSent.current || !isFinite(el.duration)) return;
            durSent.current = true;
            onDuration?.(el.duration);
          }}
          onTimeUpdate={() => onTimeUpdate?.(v.current?.currentTime ?? 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => { setError(true); setLoading(false); }}
          onEnded={() => setPlaying(false)}
        />

        {/* Minimal chrome — the Intelligence Strip below is the real interface */}
        <div className={clsx(
          "absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 h-10 bg-void/80 border-t border-rule transition-all duration-200 z-20",
          show || !playing ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full"
        )}>
          <button onClick={toggle} className="text-paper hover:text-signal transition-colors no-min">
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          <button
            onClick={() => {
              const el = v.current; if (!el) return;
              el.muted = !el.muted; setMuted(el.muted);
            }}
            className="text-dim hover:text-paper transition-colors no-min"
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <span className="tc ml-auto">Scrub on the strip below</span>
          <button
            onClick={() => {
              const el = v.current; if (!el) return;
              document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
            }}
            className="text-dim hover:text-paper transition-colors no-min"
          >
            <Maximize size={13} />
          </button>
        </div>

        {/* Big play */}
        {!playing && !loading && !error && (
          <button onClick={toggle} className="absolute inset-0 flex items-center justify-center z-10">
            <span className="w-14 h-14 bg-signal flex items-center justify-center">
              <Play size={20} className="text-void ml-1" fill="currentColor" />
            </span>
          </button>
        )}
      </div>
    );
  }
);
EOF
echo "✅ VideoPlayer.tsx"

# ═════════════════════════════════════════════════════════════════════════════
# 2. TRANSCRIPT PANEL
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/video/TranscriptPanel.tsx" << 'EOF'
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
EOF
echo "✅ TranscriptPanel.tsx"

# ═════════════════════════════════════════════════════════════════════════════
# 3. INSIGHTS PANEL
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/components/video/InsightsPanel.tsx" << 'EOF'
"use client";
import { useState } from "react";
import { Copy, Check, Play } from "lucide-react";
import { clsx } from "clsx";
import type { VideoRecord } from "@/lib/api";
import { readableTime } from "@/lib/exports";

type Tab = "summary" | "cuts" | "found" | "blog" | "thread";

const TABS: Array<{ k: Tab; label: string }> = [
  { k: "summary", label: "Summary" },
  { k: "cuts",    label: "Cuts" },
  { k: "found",   label: "Found" },
  { k: "blog",    label: "Blog" },
  { k: "thread",  label: "Thread" },
];

function Copyable({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="flex items-center gap-1.5 h-7 px-2.5 btn-ghost text-[11px] no-min"
    >
      {done ? <Check size={10} className="text-marker" /> : <Copy size={10} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function InsightsPanel({
  video, onSeek,
}: {
  video: VideoRecord;
  onSeek?: (s: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const ai = video.ai;
  if (!ai) return null;
  const canSeek = typeof onSeek === "function";

  return (
    <section className="panel">
      {/* Tabs */}
      <div className="flex border-b border-rule overflow-x-auto scrollbar-hide">
        {TABS.map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx(
              "px-4 h-10 text-[12px] font-sans whitespace-nowrap relative transition-colors shrink-0 no-min",
              tab === k ? "text-paper" : "text-dim hover:text-paper-2"
            )}
          >
            {label}
            {tab === k && <span className="absolute bottom-0 inset-x-0 h-px bg-signal" />}
          </button>
        ))}
      </div>

      <div className="p-4">
        {/* Summary */}
        {tab === "summary" && (
          <div className="space-y-4">
            <p className="text-[14px] font-sans text-paper-2 leading-[1.65]">
              {ai.summary ?? "No summary."}
            </p>
            {ai.summary && <Copyable text={ai.summary} label="Copy" />}
            {ai.tags?.length ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-3 border-t border-rule">
                {ai.tags.map((t) => (
                  <span key={t} className="tc lowercase">{t}</span>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Cuts */}
        {tab === "cuts" && (
          <div className="-mx-4 -my-4">
            {(ai.chapters ?? []).length === 0 && (
              <p className="p-4 tc text-center">No cuts detected.</p>
            )}
            {(ai.chapters ?? []).map((c, i) => (
              <button
                key={i}
                onClick={() => canSeek && onSeek!(c.startSeconds)}
                disabled={!canSeek}
                className="w-full flex items-start gap-4 px-4 py-3 text-left border-b border-rule last:border-0 hover:bg-slate transition-colors group no-min"
              >
                <span className="tc tabular-nums shrink-0 pt-0.5 group-hover:tc-signal transition-colors">
                  {readableTime(c.startSeconds)}
                </span>
                <span className="w-px self-stretch bg-rule group-hover:bg-signal transition-colors shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-display text-[16px] text-paper leading-tight group-hover:text-signal transition-colors">
                    {c.title}
                  </span>
                  <span className="block text-[12px] font-sans text-dim mt-1 leading-relaxed">
                    {c.summary}
                  </span>
                </span>
                {canSeek && (
                  <Play size={11} className="text-dim-2 group-hover:text-signal shrink-0 mt-1 transition-colors" fill="currentColor" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Found — teal. this is what the AI thought mattered. */}
        {tab === "found" && (
          <div className="space-y-3">
            {(ai.highlights ?? []).length === 0 && (
              <p className="tc text-center py-4">Nothing flagged.</p>
            )}
            {(ai.highlights ?? []).map((h, i) => (
              <article
                key={i}
                className="border-l-2 border-marker pl-4 py-1 space-y-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-mono text-marker uppercase tracking-wider">
                    {h.reason}
                  </span>
                  <span className="tc tabular-nums shrink-0">
                    {readableTime(h.startSeconds)}–{readableTime(h.endSeconds)}
                  </span>
                </div>
                <p className="font-display text-[17px] text-paper leading-[1.4] italic">
                  “{h.text}”
                </p>
                <div className="flex gap-2 pt-1">
                  {canSeek && (
                    <button
                      onClick={() => onSeek!(h.startSeconds)}
                      className="flex items-center gap-1.5 h-7 px-2.5 btn-marker text-[11px] no-min"
                    >
                      <Play size={9} fill="currentColor" /> Jump
                    </button>
                  )}
                  <Copyable text={h.text} label="Copy quote" />
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Blog */}
        {tab === "blog" && (
          ai.blogPost ? (
            <div className="space-y-3">
              <div className="max-h-80 overflow-y-auto text-[14px] font-sans text-paper-2 leading-[1.7] whitespace-pre-wrap pr-2">
                {ai.blogPost}
              </div>
              <div className="flex items-center gap-3 pt-3 border-t border-rule">
                <Copyable text={ai.blogPost} label="Copy post" />
                <span className="tc">
                  {ai.blogPost.split(/\s+/).length} words
                </span>
              </div>
            </div>
          ) : <p className="tc text-center py-4">Not generated.</p>
        )}

        {/* Thread */}
        {tab === "thread" && (
          ai.tweetThread ? (
            <div className="space-y-3">
              <div className="space-y-px">
                {ai.tweetThread.split(/\n(?=\d+\/)/).filter(Boolean).map((t, i) => (
                  <div key={i} className="group relative bg-void border border-rule p-3">
                    <p className="text-[13px] font-sans text-paper-2 leading-[1.6] pr-6">
                      {t.trim()}
                    </p>
                    <button
                      onClick={() => navigator.clipboard.writeText(t.trim())}
                      className="absolute top-2.5 right-2.5 text-dim-2 hover:text-paper opacity-0 group-hover:opacity-100 transition-all no-min"
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Copyable text={ai.tweetThread} label="Copy thread" />
                <span className="tc">
                  {ai.tweetThread.split(/\n(?=\d+\/)/).filter(Boolean).length} posts
                </span>
              </div>
            </div>
          ) : <p className="tc text-center py-4">Not generated.</p>
        )}
      </div>
    </section>
  );
}
EOF
echo "✅ InsightsPanel.tsx"

# ═════════════════════════════════════════════════════════════════════════════
# 4. VIDEO DETAIL PAGE — built around the strip
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/app/video/[id]/page.tsx" << 'EOF'
"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideo, setVideoDuration } from "@/lib/api";
import { Navbar } from "@/components/layout/Navbar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { InsightsPanel } from "@/components/video/InsightsPanel";
import { TranscriptPanel } from "@/components/video/TranscriptPanel";
import { IntelligenceStrip } from "@/components/video/IntelligenceStrip";
import { ProcessingStatus } from "@/components/video/ProcessingStatus";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video/VideoPlayer";
import { RenewButton } from "@/components/video/RenewButton";
import { ExportMenu } from "@/components/video/ExportMenu";
import { ShareButton } from "@/components/video/ShareButton";
import { SkeletonVideoPage } from "@/components/ui/SkeletonCard";
import { ArrowLeft, MessageSquare, X, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, useRef } from "react";
import { clsx } from "clsx";

export default function VideoPage({ params }: { params: { id: string } }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const player = useRef<VideoPlayerHandle>(null);
  const saved = useRef(false);

  const { data: video, isLoading, refetch } = useQuery({
    queryKey: ["video", params.id],
    queryFn: () => getVideo(params.id),
    refetchInterval: (q) =>
      q.state.data?.status && ["ready", "error"].includes(q.state.data.status) ? false : 5000,
    retry: 2,
  });

  const seek = useCallback((s: number) => player.current?.seekTo(s), []);

  const onDuration = useCallback(async (s: number) => {
    setDur(s);
    if (saved.current || video?.meta?.durationSeconds) return;
    saved.current = true;
    try { await setVideoDuration(params.id, s); refetch(); } catch {}
  }, [params.id, video?.meta?.durationSeconds, refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-void">
        <Navbar />
        <main className="pt-20 pb-16 px-4 sm:px-6 max-w-[1400px] mx-auto">
          <SkeletonVideoPage />
        </main>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-void">
        <Navbar />
        <div className="flex items-center justify-center min-h-[70vh] px-4">
          <div className="text-center space-y-3">
            <p className="font-display text-[22px] text-paper">Not found</p>
            <p className="text-[13px] font-sans text-dim">
              This video may have been deleted.
            </p>
            <Link href="/" className="inline-block tc tc-signal hover:underline">
              ← Library
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const ready   = video.status === "ready";
  const failed  = video.status === "error";
  const working = !ready && !failed;

  // Prefer stored duration, fall back to what the player reports
  const duration = video.meta.durationSeconds ?? dur;

  return (
    <div className="min-h-screen bg-void">
      <Navbar />

      <main className="pt-14 pb-20 lg:pb-10">

        {/* ── Slate: the header reads like a film slate ─────────────────── */}
        <div className="border-b border-rule">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 tc hover:text-paper transition-colors mb-4"
            >
              <ArrowLeft size={10} /> Library
            </Link>

            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-[26px] sm:text-[34px] leading-[1.1] text-paper">
                  {video.title}
                </h1>
                {video.description && (
                  <p className="text-[13px] font-sans text-dim mt-2 max-w-2xl leading-relaxed">
                    {video.description}
                  </p>
                )}
              </div>

              {video.shelby.accountAddress && (
                <a
                  href={`https://explorer.shelby.xyz/testnet/accounts/${video.shelby.accountAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 shrink-0 group"
                >
                  <span className="dot dot-live" />
                  <span className="tc group-hover:text-paper transition-colors">
                    Shelby · {video.shelby.accountAddress.slice(0, 6)}…{video.shelby.accountAddress.slice(-4)}
                  </span>
                  <ExternalLink size={9} className="text-dim-2" />
                </a>
              )}
            </div>

            {ready && (
              <div className="flex items-center gap-2 mt-5 flex-wrap">
                <ShareButton videoId={params.id} />
                <ExportMenu
                  title={video.title}
                  transcript={video.ai?.transcript}
                  summary={video.ai?.summary}
                  chapters={video.ai?.chapters}
                  highlights={video.ai?.highlights}
                  tags={video.ai?.tags}
                />
                {video.streamUrl && (
                  <div className="ml-auto">
                    <RenewButton
                      streamUrl={video.streamUrl}
                      videoBlobName={video.shelby.videoBlobName}
                      onRenewed={() => refetch()}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-6">

          {working && (
            <div className="max-w-md mx-auto py-10">
              <ProcessingStatus videoId={params.id} onReady={() => refetch()} />
            </div>
          )}

          {failed && (
            <div className="max-w-md mx-auto py-16 text-center space-y-4">
              <p className="font-display text-[22px] text-paper">Processing failed</p>
              <p className="text-[13px] font-sans text-dim leading-relaxed">
                The AI pipeline couldn't read this file. This usually means an
                unsupported audio track.
              </p>
              <Link href="/upload" className="inline-flex items-center h-9 px-4 btn btn-signal">
                Upload again
              </Link>
            </div>
          )}

          {ready && (
            <div className="grid lg:grid-cols-[1fr_360px] gap-5">
              <div className="space-y-4">

                <VideoPlayer
                  ref={player}
                  streamUrl={video.streamUrl ?? null}
                  title={video.title}
                  shelbyAddress={video.shelby.accountAddress}
                  blobName={video.shelby.videoBlobName}
                  onDuration={onDuration}
                  onTimeUpdate={setT}
                />

                {/* ★ THE SIGNATURE — sits directly under the frame ★ */}
                <IntelligenceStrip
                  duration={duration}
                  currentTime={t}
                  transcript={video.ai?.transcript}
                  chapters={video.ai?.chapters}
                  highlights={video.ai?.highlights}
                  onSeek={seek}
                />

                <InsightsPanel video={video} onSeek={seek} />

                {video.ai?.transcript?.length ? (
                  <TranscriptPanel
                    transcript={video.ai.transcript}
                    currentTime={t}
                    onSeek={seek}
                  />
                ) : null}
              </div>

              <aside className="hidden lg:block lg:sticky lg:top-[72px] lg:h-[calc(100vh-88px)]">
                <div className="panel h-full flex flex-col overflow-hidden">
                  <ChatPanel videoId={params.id} videoTitle={video.title} />
                </div>
              </aside>
            </div>
          )}
        </div>
      </main>

      {/* Mobile chat */}
      {ready && (
        <>
          <button
            onClick={() => setChatOpen(true)}
            className="lg:hidden fixed bottom-5 right-4 z-30 flex items-center gap-2 h-11 px-4 btn btn-signal"
          >
            <MessageSquare size={14} /> Ask
          </button>

          <div className={clsx(
            "lg:hidden fixed inset-0 z-40",
            chatOpen ? "pointer-events-auto" : "pointer-events-none"
          )}>
            <div
              className={clsx(
                "absolute inset-0 bg-void/90 transition-opacity duration-200",
                chatOpen ? "opacity-100" : "opacity-0"
              )}
              onClick={() => setChatOpen(false)}
            />
            <div className={clsx(
              "absolute bottom-0 inset-x-0 h-[85vh] bg-void border-t border-rule flex flex-col transition-transform duration-200",
              chatOpen ? "translate-y-0" : "translate-y-full"
            )}>
              <div className="flex items-center justify-between px-4 h-12 border-b border-rule shrink-0">
                <span className="eyebrow">Ask the video</span>
                <button onClick={() => setChatOpen(false)} className="text-dim hover:text-paper no-min">
                  <X size={15} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <ChatPanel videoId={params.id} videoTitle={video.title} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
EOF
echo "✅ video/[id]/page.tsx  — built around the strip"

# ═════════════════════════════════════════════════════════════════════════════
# 5. LIBRARY / HOME — hero is a thesis, not a stat block
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/app/page.tsx" << 'EOF'
"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideos, deleteAllVideos, api } from "@/lib/api";
import { VideoCard } from "@/components/video/VideoCard";
import { SkeletonCard } from "@/components/ui/SkeletonCard";
import { Navbar } from "@/components/layout/Navbar";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ArrowRight, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function Home() {
  const { connected, account } = useWallet();
  const wallet = account?.address?.toString();

  const [wipe, setWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["videos", wallet],
    queryFn: () => getVideos(wallet),
    refetchInterval: 8000,
    enabled: !!wallet,
    retry: 2,
  });

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["shelby-stats", wallet],
    queryFn: async () => {
      const r = await api.get("/api/shelby/stats", { params: { wallet } });
      return r.data as { totalVideos: number; readyVideos: number; blobCount: number; processing: number };
    },
    refetchInterval: 15_000,
    enabled: !!wallet,
  });

  const videos = data ?? [];

  const doWipe = async () => {
    if (!wallet) return;
    setWiping(true);
    try {
      const r = await deleteAllVideos(wallet);
      setNote(r.message);
      refetch(); refetchStats(); setWipe(false);
    } catch (e: any) { setNote(e.message); }
    finally { setWiping(false); }
  };

  return (
    <div className="min-h-screen bg-void">
      <Navbar />

      <main className="pt-14">

        {/* ═══ HERO — the thesis ═══════════════════════════════════════════
            Not a stat block with a gradient. A claim, and the strip that
            proves it. The most characteristic thing in this product's world
            is the shape of a video — so lead with it.
        ═════════════════════════════════════════════════════════════════ */}
        <section className="border-b border-rule">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-16 sm:py-24">
            <div className="max-w-3xl">
              <p className="eyebrow mb-6">Video intelligence · Shelby Protocol</p>

              <h1 className="font-display text-[40px] sm:text-[58px] lg:text-[68px] leading-[0.98] text-paper tracking-tightest">
                See the{" "}
                <span className="italic text-signal">shape</span>
                <br />
                of any video.
              </h1>

              <p className="text-[15px] sm:text-[17px] font-sans text-paper-2/80 mt-6 max-w-xl leading-[1.6]">
                Upload a recording. VideoMind reads every word, marks every cut,
                flags what matters, and answers your questions about it — with
                the timecode to prove it.
              </p>

              <div className="flex items-center gap-3 mt-9 flex-wrap">
                <Link href="/upload" className="btn btn-signal h-10 px-5 flex items-center gap-2">
                  Upload a video <ArrowRight size={13} />
                </Link>
                <Link href="/about" className="btn btn-ghost h-10 px-5 flex items-center">
                  How it works
                </Link>
              </div>
            </div>

            {/* Legend — teaches the strip's vocabulary before you meet it */}
            <div className="flex items-center gap-6 sm:gap-8 mt-14 pt-6 border-t border-rule flex-wrap">
              <span className="flex items-center gap-2">
                <span className="flex items-end gap-px h-3">
                  <span className="w-0.5 h-1.5 bg-paper-2/40" />
                  <span className="w-0.5 h-3 bg-paper-2/70" />
                  <span className="w-0.5 h-2 bg-paper-2/50" />
                  <span className="w-0.5 h-px bg-dim-2" />
                  <span className="w-0.5 h-2.5 bg-paper-2/60" />
                </span>
                <span className="tc">Speech density — gaps are silence</span>
              </span>

              <span className="flex items-center gap-2">
                <span className="w-px h-3 bg-paper-2" />
                <span className="tc">Cuts — where the topic turns</span>
              </span>

              <span className="flex items-center gap-2">
                <span className="w-2 h-2 bg-marker rotate-45" />
                <span className="tc">Found — what the AI flagged</span>
              </span>

              <span className="flex items-center gap-2">
                <span className="w-px h-3 bg-signal" />
                <span className="tc">Playhead — where you are</span>
              </span>
            </div>
          </div>
        </section>

        {/* ═══ LIBRARY ════════════════════════════════════════════════════ */}
        <section className="max-w-[1400px] mx-auto px-4 sm:px-6 py-10">

          {note && (
            <div className="flex items-center gap-3 px-3 h-10 mb-6 border border-marker-dim bg-marker-wash">
              <span className="dot dot-live" />
              <span className="text-[12px] font-sans text-marker">{note}</span>
              <button onClick={() => setNote(null)} className="ml-auto text-dim hover:text-paper no-min">
                <X size={12} />
              </button>
            </div>
          )}

          <header className="flex items-end justify-between gap-4 mb-6 pb-4 border-b border-rule">
            <div>
              <p className="eyebrow mb-1.5">
                {connected ? "Your library" : "Library"}
              </p>
              {connected && stats && (
                <p className="font-display text-[22px] text-paper leading-none">
                  {stats.totalVideos} video{stats.totalVideos !== 1 ? "s" : ""}
                  {stats.processing > 0 && (
                    <span className="text-dim"> · {stats.processing} processing</span>
                  )}
                </p>
              )}
            </div>

            {connected && videos.length > 0 && (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setWipe(true)}
                  className="tc hover:text-error transition-colors no-min"
                >
                  Clear all
                </button>
                <Link href="/upload" className="tc tc-signal hover:underline">
                  + Upload
                </Link>
              </div>
            )}
          </header>

          {/* Wipe confirm */}
          {wipe && (
            <div className="panel p-4 mb-6 border-error/40 flex items-center gap-4 flex-wrap">
              <Trash2 size={15} className="text-error shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-sans text-paper">
                  Delete all {videos.length} videos?
                </p>
                <p className="tc mt-0.5">
                  Blobs stay on Shelby until they expire.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={doWipe}
                  disabled={wiping}
                  className="h-8 px-3 text-[12px] font-sans bg-error/15 border border-error/40 text-error hover:bg-error/25 transition-colors disabled:opacity-50"
                >
                  {wiping ? "Deleting…" : "Delete all"}
                </button>
                <button onClick={() => setWipe(false)} className="h-8 px-3 btn-ghost text-[12px]">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Disconnected */}
          {!connected && (
            <div className="py-24 text-center">
              <p className="font-display text-[24px] text-paper mb-3">
                Connect a wallet to begin
              </p>
              <p className="text-[13px] font-sans text-dim max-w-sm mx-auto leading-relaxed">
                Your videos are stored on Shelby Protocol and signed by your wallet.
                Nobody else can read or delete them.
              </p>
            </div>
          )}

          {connected && isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {connected && isError && (
            <div className="py-20 text-center space-y-3">
              <p className="font-display text-[22px] text-paper">Can't reach the server</p>
              <p className="text-[13px] font-sans text-dim">{(error as Error)?.message}</p>
              <button onClick={() => refetch()} className="btn btn-ghost h-9 px-4 mt-2">
                Try again
              </button>
            </div>
          )}

          {connected && !isLoading && !isError && videos.length === 0 && (
            <div className="py-24 text-center">
              <p className="font-display text-[24px] text-paper mb-3">
                Nothing here yet
              </p>
              <p className="text-[13px] font-sans text-dim mb-6">
                Upload a video and watch the AI map it.
              </p>
              <Link href="/upload" className="btn btn-signal h-10 px-5 inline-flex items-center gap-2">
                Upload a video <ArrowRight size={13} />
              </Link>
            </div>
          )}

          {connected && videos.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {videos.map((v) => <VideoCard key={v.id} video={v} />)}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
EOF
echo "✅ page.tsx  — hero is a thesis"

# ═════════════════════════════════════════════════════════════════════════════
# 6. UPLOAD PAGE
# ═════════════════════════════════════════════════════════════════════════════
cat > "$FE/src/app/upload/page.tsx" << 'EOF'
import { Navbar } from "@/components/layout/Navbar";
import { UploadZone } from "@/components/upload/UploadZone";

const STEPS = [
  { n: "Store",      d: "Your wallet signs the blob. It lands on Shelby Protocol, owned by you." },
  { n: "Read",       d: "Whisper transcribes every word with a timecode attached." },
  { n: "Map",        d: "Claude finds the cuts, flags what matters, and writes the summary." },
  { n: "Ask",        d: "Question the video in plain language. Every answer cites a timecode." },
];

export default function UploadPage() {
  return (
    <div className="min-h-screen bg-void">
      <Navbar />
      <main className="pt-14">
        <div className="border-b border-rule">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-10">
            <p className="eyebrow mb-4">Upload</p>
            <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.05] text-paper max-w-xl">
              Hand it a recording.
              <br />
              <span className="italic text-signal">Get back a map.</span>
            </h1>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
          <div className="grid lg:grid-cols-[1fr_320px] gap-10 items-start">
            <UploadZone />

            <aside className="space-y-0">
              <p className="eyebrow mb-4">What happens next</p>

              {/* This IS a sequence — order carries real information here. */}
              {STEPS.map((s, i) => (
                <div key={s.n} className="flex gap-4 py-4 border-t border-rule last:border-b">
                  <span className="tc tabular-nums shrink-0 pt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-[17px] text-paper leading-none">
                      {s.n}
                    </p>
                    <p className="text-[12px] font-sans text-dim mt-1.5 leading-relaxed">
                      {s.d}
                    </p>
                  </div>
                </div>
              ))}

              <div className="mt-6 pt-4 border-t border-rule">
                <p className="tc leading-relaxed">
                  Shelby testnet expires blobs after 48 hours. VideoMind flags
                  expiring videos when you connect — one signature renews them all.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
EOF
echo "✅ upload/page.tsx"

echo ""
echo "════════════════════════════════════════════"
echo "✅ EDIT BAY REDESIGN COMPLETE"
echo "════════════════════════════════════════════"
echo ""
echo "  Palette   void / paper / signal(red=time) / marker(teal=AI)"
echo "  Type      Instrument Serif · Inter Tight · IBM Plex Mono"
echo "  Signature Intelligence Strip — see the shape of a video"
echo ""
echo "  Cut: glass, blur, gradient mesh, Syne, pulsing dots"
echo ""
echo "  git add . && git commit -m 'design: Edit Bay' && git push"
