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
                  href={`https://explorer.shelby.xyz/shelbynet/accounts/${video.shelby.accountAddress}`}
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
