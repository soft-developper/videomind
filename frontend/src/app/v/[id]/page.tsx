"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideo } from "@/lib/api";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video/VideoPlayer";
import { IntelligenceStrip } from "@/components/video/IntelligenceStrip";
import { InsightsPanel } from "@/components/video/InsightsPanel";
import { TranscriptPanel } from "@/components/video/TranscriptPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ExportMenu } from "@/components/video/ExportMenu";
import { SkeletonVideoPage } from "@/components/ui/SkeletonCard";
import { ArrowRight, ExternalLink, MessageSquare, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useCallback } from "react";
import { clsx } from "clsx";

export default function PublicVideo({ params }: { params: { id: string } }) {
  const player = useRef<VideoPlayerHandle>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [chat, setChat] = useState(false);

  const { data: video, isLoading } = useQuery({
    queryKey: ["public-video", params.id],
    queryFn: () => getVideo(params.id),
    retry: 1,
  });

  const seek = useCallback((s: number) => player.current?.seekTo(s), []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-void">
        <Bar />
        <main className="pt-20 px-4 sm:px-6 max-w-[1400px] mx-auto">
          <SkeletonVideoPage />
        </main>
      </div>
    );
  }

  if (!video || video.status !== "ready") {
    return (
      <div className="min-h-screen bg-void">
        <Bar />
        <div className="flex items-center justify-center min-h-[70vh] px-4">
          <div className="text-center space-y-3 max-w-sm">
            <p className="font-display text-[24px] text-paper">
              {!video ? "Not found" : "Still processing"}
            </p>
            <p className="text-[13px] font-sans text-dim leading-relaxed">
              {!video
                ? "This video may have been deleted, or the link is wrong."
                : "The AI is still reading it. Check back shortly."}
            </p>
            <Link href="/" className="inline-flex items-center gap-1.5 tc tc-signal hover:underline pt-2">
              Go to VideoMind <ArrowRight size={10} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const duration = video.meta.durationSeconds ?? dur;

  return (
    <div className="min-h-screen bg-void">
      <Bar />

      <main className="pt-14 pb-20 lg:pb-10">
        <div className="border-b border-rule">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
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
              <ExportMenu
                title={video.title}
                transcript={video.ai?.transcript}
                summary={video.ai?.summary}
                chapters={video.ai?.chapters}
                highlights={video.ai?.highlights}
                tags={video.ai?.tags}
              />
            </div>

            {video.shelby.accountAddress && (
              <a
                href={`https://explorer.shelby.xyz/shelbynet/accounts/${video.shelby.accountAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-4 group"
              >
                <span className="dot dot-live" />
                <span className="tc group-hover:text-paper transition-colors">
                  Stored on Shelby · {video.shelby.accountAddress.slice(0, 6)}…{video.shelby.accountAddress.slice(-4)}
                </span>
                <ExternalLink size={9} className="text-dim-2" />
              </a>
            )}
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-6">
          <div className="grid lg:grid-cols-[1fr_360px] gap-5">
            <div className="space-y-4">
              <VideoPlayer
                ref={player}
                streamUrl={video.streamUrl ?? null}
                title={video.title}
                shelbyAddress={video.shelby.accountAddress}
                onDuration={setDur}
                onTimeUpdate={setT}
              />

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

          {/* CTA */}
          <div className="mt-16 py-12 border-t border-rule text-center">
            <p className="font-display text-[28px] text-paper leading-tight max-w-md mx-auto">
              Your videos could work this hard too.
            </p>
            <p className="text-[13px] font-sans text-dim mt-3 max-w-sm mx-auto leading-relaxed">
              Upload a recording, get a map. Stored on Shelby, signed by your wallet.
            </p>
            <Link href="/" className="btn btn-signal h-10 px-5 inline-flex items-center gap-2 mt-6">
              Try VideoMind <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </main>

      {/* Mobile chat */}
      <button
        onClick={() => setChat(true)}
        className="lg:hidden fixed bottom-5 right-4 z-30 flex items-center gap-2 h-11 px-4 btn btn-signal"
      >
        <MessageSquare size={14} /> Ask
      </button>

      <div className={clsx("lg:hidden fixed inset-0 z-40", chat ? "pointer-events-auto" : "pointer-events-none")}>
        <div
          className={clsx("absolute inset-0 bg-void/90 transition-opacity duration-200", chat ? "opacity-100" : "opacity-0")}
          onClick={() => setChat(false)}
        />
        <div className={clsx(
          "absolute bottom-0 inset-x-0 h-[85vh] bg-void border-t border-rule flex flex-col transition-transform duration-200",
          chat ? "translate-y-0" : "translate-y-full"
        )}>
          <div className="flex items-center justify-between px-4 h-12 border-b border-rule shrink-0">
            <span className="eyebrow">Ask the video</span>
            <button onClick={() => setChat(false)} className="text-dim hover:text-paper no-min">
              <X size={15} />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ChatPanel videoId={params.id} videoTitle={video.title} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Bar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 h-14 bg-void border-b border-rule">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
            <path d="M7 16L0 0h14L7 16z" className="fill-signal" />
          </svg>
          <span className="font-display text-[19px] leading-none text-paper">VideoMind</span>
        </Link>

        <div className="flex items-center gap-4">
          <span className="hidden sm:flex items-center gap-2">
            <span className="dot dot-live" />
            <span className="tc">Shelbynet</span>
          </span>
          <Link href="/" className="btn btn-signal h-8 px-3.5 flex items-center gap-1.5">
            Try free <ArrowRight size={11} />
          </Link>
        </div>
      </div>
    </nav>
  );
}
