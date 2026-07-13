"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideo, setVideoDuration } from "@/lib/api";
import { Navbar } from "@/components/layout/Navbar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { InsightsPanel } from "@/components/video/InsightsPanel";
import { TranscriptPanel } from "@/components/video/TranscriptPanel";
import { ProcessingStatus } from "@/components/video/ProcessingStatus";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video/VideoPlayer";
import { RenewButton } from "@/components/video/RenewButton";
import { ExportMenu } from "@/components/video/ExportMenu";
import { ShareButton } from "@/components/video/ShareButton";
import { SkeletonVideoPage } from "@/components/ui/SkeletonCard";
import {
  ArrowLeft, Zap, ExternalLink,
  AlertTriangle, MessageSquare, Brain, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState, useRef } from "react";
import { clsx } from "clsx";

export default function VideoPage({ params }: { params: { id: string } }) {
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const durationSaved = useRef(false);

  const { data: video, isLoading, refetch } = useQuery({
    queryKey: ["video", params.id],
    queryFn: () => getVideo(params.id),
    refetchInterval: (query) =>
      query.state.data?.status && ["ready", "error"].includes(query.state.data.status) ? false : 5000,
    retry: 2,
  });

  const onReady = useCallback(() => { refetch(); }, [refetch]);

  const handleSeek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds);
  }, []);

  // Persist the video duration to Turso once, the first time metadata loads
  const handleDuration = useCallback(async (seconds: number) => {
    if (durationSaved.current) return;
    if (video?.meta?.durationSeconds) return; // already stored
    durationSaved.current = true;
    try {
      await setVideoDuration(params.id, seconds);
      refetch();
    } catch { /* non-critical — ignore */ }
  }, [params.id, video?.meta?.durationSeconds, refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen gradient-mesh">
        <Navbar />
        <main className="pt-20 sm:pt-24 pb-16 px-4 sm:px-6 max-w-7xl mx-auto">
          <SkeletonVideoPage />
        </main>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen gradient-mesh flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-white/10 flex items-center justify-center mx-auto">
            <AlertTriangle size={20} className="text-white/20" />
          </div>
          <p className="text-white/40 font-dm">Video not found</p>
          <Link href="/" className="text-volt text-sm font-mono hover:underline">← Back to library</Link>
        </div>
      </div>
    );
  }

  const isReady      = video.status === "ready";
  const isError      = video.status === "error";
  const isProcessing = !["ready", "error"].includes(video.status);

  return (
    <div className="min-h-screen gradient-mesh">
      <Navbar />
      <main className="pt-16 sm:pt-20 pb-24 lg:pb-16 px-4 sm:px-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="py-5 border-b border-white/[0.06] mb-6">
          <div className="flex items-start gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-white/30 hover:text-white text-xs font-mono transition-colors mt-1 shrink-0"
            >
              <ArrowLeft size={12} /> Library
            </Link>

            <div className="flex-1 min-w-0">
              <h1 className="font-syne font-800 text-lg sm:text-xl text-white leading-tight line-clamp-2">
                {video.title}
              </h1>
              {video.description && (
                <p className="text-sm text-white/40 font-dm mt-1 line-clamp-1">{video.description}</p>
              )}
            </div>

            {video.shelby.accountAddress && (
              <a
                href={`https://explorer.shelby.xyz/testnet/accounts/${video.shelby.accountAddress}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-volt/20 bg-volt/5 hover:bg-volt/10 transition-all group shrink-0"
              >
                <Zap size={11} className="text-volt" />
                <span className="font-mono text-[10px] text-volt/70 group-hover:text-volt hidden sm:block">
                  {video.shelby.accountAddress.slice(0, 6)}...{video.shelby.accountAddress.slice(-4)}
                </span>
                <ExternalLink size={10} className="text-volt/40" />
              </a>
            )}
          </div>

          {/* Action row — share, export */}
          {isReady && (
            <div className="flex items-center gap-2 mt-4 flex-wrap">
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

        {/* Processing */}
        {isProcessing && (
          <div className="max-w-lg mx-auto py-8">
            <ProcessingStatus videoId={params.id} onReady={onReady} />
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="max-w-lg mx-auto py-8">
            <div className="glass-card rounded-2xl p-8 text-center space-y-4">
              <AlertTriangle size={32} className="text-red-400 mx-auto" />
              <div>
                <p className="font-syne font-semibold text-white">Processing failed</p>
                <p className="text-sm text-white/40 font-dm mt-1">
                  Something went wrong during AI processing.
                </p>
              </div>
              <Link
                href="/upload"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-volt text-black font-syne font-semibold text-sm hover:bg-volt-dim transition-all"
              >
                Try uploading again
              </Link>
            </div>
          </div>
        )}

        {/* Ready */}
        {isReady && (
          <div className="grid lg:grid-cols-[1fr_380px] gap-6">
            <div className="space-y-5">
              <VideoPlayer
                ref={playerRef}
                streamUrl={video.streamUrl ?? null}
                title={video.title}
                shelbyAddress={video.shelby.accountAddress}
                blobName={video.shelby.videoBlobName}
                onDuration={handleDuration}
                onTimeUpdate={setCurrentTime}
              />

              {video.ai?.tags && video.ai.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {video.ai.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 rounded-full bg-dark-800 border border-white/[0.06] text-xs font-mono text-white/35"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Clickable chapters + highlights */}
              <InsightsPanel video={video} onSeek={handleSeek} />

              {/* Clickable transcript with search + auto-scroll */}
              {video.ai?.transcript && video.ai.transcript.length > 0 && (
                <TranscriptPanel
                  transcript={video.ai.transcript}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                />
              )}
            </div>

            <div className="hidden lg:block lg:sticky lg:top-20 lg:h-[calc(100vh-5rem)]">
              <div className="glass-card rounded-2xl h-full flex flex-col overflow-hidden">
                <ChatPanel videoId={params.id} videoTitle={video.title} />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile chat */}
      {isReady && (
        <>
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
        </>
      )}
    </div>
  );
}
