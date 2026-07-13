"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideo } from "@/lib/api";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video/VideoPlayer";
import { InsightsPanel } from "@/components/video/InsightsPanel";
import { TranscriptPanel } from "@/components/video/TranscriptPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ExportMenu } from "@/components/video/ExportMenu";
import { SkeletonVideoPage } from "@/components/ui/SkeletonCard";
import {
  Brain, Zap, AlertTriangle, ExternalLink,
  MessageSquare, X, ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState, useCallback } from "react";
import { clsx } from "clsx";

export default function PublicVideoPage({ params }: { params: { id: string } }) {
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const { data: video, isLoading } = useQuery({
    queryKey: ["public-video", params.id],
    queryFn: () => getVideo(params.id),
    retry: 1,
  });

  const handleSeek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds);
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen gradient-mesh">
        <PublicNav />
        <main className="pt-20 pb-16 px-4 sm:px-6 max-w-7xl mx-auto">
          <SkeletonVideoPage />
        </main>
      </div>
    );
  }

  // ── Not found / not ready ──────────────────────────────────────────────
  if (!video || video.status !== "ready") {
    return (
      <div className="min-h-screen gradient-mesh">
        <PublicNav />
        <div className="flex items-center justify-center min-h-[70vh] px-4">
          <div className="text-center space-y-4 max-w-sm">
            <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-white/10 flex items-center justify-center mx-auto">
              <AlertTriangle size={20} className="text-white/20" />
            </div>
            <div>
              <p className="font-syne font-semibold text-white">
                {!video ? "Video not found" : "Video still processing"}
              </p>
              <p className="text-sm text-white/30 font-dm mt-2 leading-relaxed">
                {!video
                  ? "This video may have been deleted or the link is incorrect."
                  : "The AI pipeline is still running. Check back in a few minutes."}
              </p>
            </div>
            <Link href="/" className="inline-flex items-center gap-2 text-volt text-sm font-mono hover:underline">
              Go to VideoMind <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-mesh">
      <PublicNav />

      <main className="pt-20 pb-24 lg:pb-16 px-4 sm:px-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="py-5 border-b border-white/[0.06] mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="font-syne font-800 text-lg sm:text-2xl text-white leading-tight">
                {video.title}
              </h1>
              {video.description && (
                <p className="text-sm text-white/40 font-dm mt-1.5">{video.description}</p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <ExportMenu
                title={video.title}
                transcript={video.ai?.transcript}
                summary={video.ai?.summary}
                chapters={video.ai?.chapters}
                highlights={video.ai?.highlights}
                tags={video.ai?.tags}
              />
            </div>
          </div>

          {/* Shelby proof */}
          {video.shelby.accountAddress && (
            <a
              href={`https://explorer.shelby.xyz/testnet/accounts/${video.shelby.accountAddress}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full border border-volt/20 bg-volt/5 hover:bg-volt/10 transition-all group"
            >
              <Zap size={11} className="text-volt" />
              <span className="font-mono text-[10px] text-volt/70 group-hover:text-volt">
                Stored on Shelby · {video.shelby.accountAddress.slice(0, 6)}...{video.shelby.accountAddress.slice(-4)}
              </span>
              <ExternalLink size={9} className="text-volt/40" />
            </a>
          )}
        </div>

        {/* Content grid */}
        <div className="grid lg:grid-cols-[1fr_380px] gap-6">
          <div className="space-y-5">
            <VideoPlayer
              ref={playerRef}
              streamUrl={video.streamUrl ?? null}
              title={video.title}
              shelbyAddress={video.shelby.accountAddress}
              blobName={video.shelby.videoBlobName}
              onTimeUpdate={setCurrentTime}
            />

            {video.ai?.tags && video.ai.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {video.ai.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-dark-800 border border-white/[0.06] text-xs font-mono text-white/35">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <InsightsPanel video={video} onSeek={handleSeek} />

            {video.ai?.transcript && video.ai.transcript.length > 0 && (
              <TranscriptPanel
                transcript={video.ai.transcript}
                currentTime={currentTime}
                onSeek={handleSeek}
              />
            )}
          </div>

          {/* Desktop chat */}
          <div className="hidden lg:block lg:sticky lg:top-20 lg:h-[calc(100vh-5rem)]">
            <div className="glass-card rounded-2xl h-full flex flex-col overflow-hidden">
              <ChatPanel videoId={params.id} videoTitle={video.title} />
            </div>
          </div>
        </div>

        {/* CTA footer */}
        <div className="mt-16 p-6 sm:p-8 glass-card rounded-2xl border border-volt/10 bg-volt/[0.02] text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-volt/10 border border-volt/20 flex items-center justify-center mx-auto">
            <Brain size={20} className="text-volt" />
          </div>
          <div>
            <p className="font-syne font-800 text-white text-xl">
              Turn your videos into AI knowledge bases
            </p>
            <p className="text-white/40 font-dm text-sm mt-2 max-w-md mx-auto leading-relaxed">
              VideoMind transcribes, analyses and makes any video searchable — all stored
              on Shelby Protocol, owned by your wallet.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-volt text-black font-syne font-semibold text-sm hover:bg-volt-dim volt-glow transition-all"
          >
            Try VideoMind free <ArrowRight size={14} />
          </Link>
        </div>
      </main>

      {/* Mobile chat */}
      <button
        onClick={() => setMobileChatOpen(true)}
        className="lg:hidden fixed bottom-6 right-4 z-30 flex items-center gap-2 px-4 py-3 rounded-2xl bg-volt text-black font-syne font-semibold text-sm shadow-lg shadow-volt/20 volt-glow"
      >
        <MessageSquare size={16} /> Ask AI
      </button>

      <div className={clsx(
        "lg:hidden fixed inset-0 z-40 transition-all duration-300",
        mobileChatOpen ? "pointer-events-auto" : "pointer-events-none"
      )}>
        <div
          className={clsx(
            "absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300",
            mobileChatOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setMobileChatOpen(false)}
        />
        <div className={clsx(
          "absolute bottom-0 left-0 right-0 glass-card rounded-t-3xl border-t border-white/[0.08] transition-transform duration-300 flex flex-col h-[85vh]",
          mobileChatOpen ? "translate-y-0" : "translate-y-full"
        )}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <Brain size={14} className="text-volt" />
              <span className="text-sm font-syne font-semibold text-white">Ask the Video</span>
            </div>
            <button
              onClick={() => setMobileChatOpen(false)}
              className="w-8 h-8 rounded-lg bg-dark-700 border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <ChatPanel videoId={params.id} videoTitle={video.title} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Minimal nav for public pages (no wallet button) ───────────────────────
function PublicNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/[0.06] glass-card">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-lg bg-volt/20 group-hover:bg-volt/30 transition-colors" />
            <Brain className="relative w-8 h-8 p-1.5 text-volt" strokeWidth={1.5} />
          </div>
          <span className="font-syne font-800 text-lg tracking-tight text-white">
            Video<span className="text-volt">Mind</span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-volt/20 bg-volt/5">
            <Zap size={12} className="text-volt" />
            <span className="font-mono text-xs text-volt/80">Shelby Testnet</span>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-volt text-black font-syne font-semibold text-xs hover:bg-volt-dim transition-all"
          >
            Try free <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </nav>
  );
}
