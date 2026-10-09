"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideo, getCaptions, getTranscriptWords, momentFromUrl, ApiError } from "@/lib/api";
import { categoryLabel } from "@/lib/categories";
import { formatLabel } from "@/lib/media";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video/VideoPlayer";
import { IntelligenceStrip } from "@/components/video/IntelligenceStrip";
import { InsightsPanel } from "@/components/video/InsightsPanel";
import { OnChainProof } from "@/components/video/OnChainProof";
import { TranscriptPanel } from "@/components/video/TranscriptPanel";
import { NotesPanel } from "@/components/video/NotesPanel";
import { CourseStrip } from "@/components/video/CourseStrip";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ExportMenu } from "@/components/video/ExportMenu";
import { SkeletonVideoPage } from "@/components/ui/SkeletonCard";
import { ExternalLink, MessageSquare, X } from "lucide-react";
// vm_present
import { Presentation } from "lucide-react";
import { ShareButton } from "@/components/video/ShareButton";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LegalFooter } from "@/components/legal/LegalPage";
import { useWatchProgress } from "@/lib/useWatchProgress";
import { useRef, useState, useCallback } from "react";
import { clsx } from "clsx";

export default function PublicVideo({ params }: { params: { id: string } }) {
  const player = useRef<VideoPlayerHandle>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [chat, setChat] = useState(false);

  const { data: video, isLoading, error } = useQuery({
    queryKey: ["public-video", params.id],
    queryFn: () => getVideo(params.id),
    retry: (count, e) => !(e instanceof ApiError && (e.status === 403 || e.status === 404)) && count < 1,
  });
  // vm_captions: fetched once the video is ready and something was said
  const hasSpeech = video?.status === "ready" && (video.ai?.transcript?.length ?? 0) > 0;
  // vm_workspace: the words, for marking the one being said. The page works without them.
  const { data: words } = useQuery({
    queryKey: ["words", params.id],
    queryFn: () => getTranscriptWords(params.id),
    enabled: hasSpeech, staleTime: Infinity, retry: false,
  });
  // vm_workspace: a link to a moment (?t=90) opens the video there
  const searchParams = useSearchParams();
  const sessionWallet = useSessionWallet();
  const [startAt] = useState(() => momentFromUrl(searchParams.get("t")));
  // vm_progress: where this wallet stopped last time, unless the link names a moment
  const progress = useWatchProgress(params.id, sessionWallet, video?.status === "ready");
  const { data: captions } = useQuery({
    queryKey: ["captions", params.id],
    queryFn: () => getCaptions(params.id),
    enabled: hasSpeech, staleTime: Infinity, retry: false,
  });
  // vm_info: the owner has not shared this video
  const isPrivate = !video && error instanceof ApiError && error.code === "private";

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
            <p className="font-display text-[20px] text-paper">
              {isPrivate ? "This video is private" : !video ? "This video was not found" : "This video is still being processed"}
            </p>
            <p className="text-[13px] font-sans text-dim leading-relaxed">
              {isPrivate
                ? "Its owner has not shared it. If it is yours, open it from your library."
                : !video
                ? "This video may have been deleted, or the link is wrong."
                : "Check back in a few minutes."}
            </p>
            <Link href="/" className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-2">
              Open VideoMind
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
                <h1 className="font-display text-[22px] sm:text-[26px] leading-[1.2] text-paper">
                  {video.title}
                </h1>
                {/* vm_profile: who made it, linking to their public page */}
                {video.ownerWallet && (
                  <Link href={`/u/${video.ownerWallet}`} className="inline-block text-[13.5px] text-paper-2 hover:text-paper hover:underline underline-offset-2 mt-1.5">
                    By {video.ownerName ?? `${video.ownerWallet.slice(0, 6)}…${video.ownerWallet.slice(-4)}`}
                  </Link>
                )}
                {video.description && (
                  <p className="text-[13px] font-sans text-dim mt-2 max-w-2xl leading-relaxed whitespace-pre-line">
                    {video.description}
                  </p>
                )}
                {(video.category || video.collection || (video.tags?.length ?? 0) > 0) && (
                  <ul className="flex items-center gap-2 flex-wrap mt-3" aria-label="Details">
                    {categoryLabel(video.category) && <li className="badge">{categoryLabel(video.category)}</li>}
                    {video.collection && <li className="badge">{video.collection.name}</li>}
                    {(video.tags ?? []).map((t) => <li key={t.toLowerCase()} className="text-[12.5px] text-dim">#{t}</li>)}
                  </ul>
                )}
                {/* vm_courses: its place in its course */}
                {video.course && <div className="mt-4 max-w-[860px]"><CourseStrip course={video.course} base="/v" owner={false} /></div>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
              {/* vm_present: show it to a room, or share it (last, so its panel opens leftwards) */}
              <Link
                href={`/present/${params.id}${t >= 1 ? `?t=${Math.floor(t)}` : ""}`}
                className="flex items-center gap-1.5 h-8 px-3 btn-ghost text-[12px] no-min"
              >
                <Presentation size={11} /> Present
              </Link>
              <ExportMenu
                videoId={params.id}
                title={video.title}
                transcript={video.ai?.transcript}
                summary={video.ai?.summary}
                chapters={video.ai?.chapters}
                highlights={video.ai?.highlights}
                tags={video.ai?.tags}
              />
              <ShareButton videoId={params.id} title={video.title} currentTime={t} align="right" />
              </div>
            </div>

            {video.shelby.accountAddress && (
              <a
                href={`https://explorer.aptoslabs.com/account/${video.shelby.accountAddress}?network=shelbynet`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-4 group"
              >
                <span className="tc group-hover:text-paper transition-colors">
                  Stored on Shelby, owner {video.shelby.accountAddress.slice(0, 6)}…{video.shelby.accountAddress.slice(-4)}
                </span>
                <ExternalLink size={11} className="text-dim" />
              </a>
            )}
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-6">
          <div className="grid lg:grid-cols-[1fr_360px] gap-5">
            <div className="space-y-4 min-w-0">
              {/* vm_knowledge: on a phone held upright the player stays in view
                  under the bar while the transcript and notes scroll beneath it */}
              <div data-player-dock className="portrait:max-lg:sticky top-14 z-20 bg-void -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 portrait:max-lg:pb-2 portrait:max-lg:border-b portrait:max-lg:border-rule">
              <VideoPlayer
                ref={player}
                streamUrl={video.streamUrl ?? null}
                  source={video.source}
                poster={video.posterUrl}
                format={video.media && video.media.playable !== "yes" ? formatLabel(video.media) : null}
                title={video.title}
                shelbyAddress={video.shelby.accountAddress}
                captions={captions ?? null}
                chapters={video.ai?.chapters}
                startAt={startAt ?? progress.resumeAt}
                  resumed={startAt == null && progress.resumeAt != null}
                  onStartOver={progress.startOver}
                  onProgress={progress.report}
                  upNext={video.course?.next ? { title: video.course.next.title, href: `/v/${video.course.next.id}` } : null}
                onDuration={setDur}
                onTimeUpdate={setT}
              />
              </div>

              <IntelligenceStrip
                duration={duration}
                currentTime={t}
                transcript={video.ai?.transcript}
                chapters={video.ai?.chapters}
                highlights={video.ai?.highlights}
                onSeek={seek}
              />

              <InsightsPanel video={video} onSeek={seek} />

              <OnChainProof videoId={params.id} isOwner={!!video.isOwner} storeHref={video.isOwner ? `/upload?anchor=${params.id}` : undefined} />

              {video.ai?.transcript?.length ? (
                <TranscriptPanel
                  transcript={words?.length ? words : video.ai.transcript}
                  currentTime={t}
                  onSeek={seek}
                  chapters={video.ai?.chapters}
                />
              ) : null}

              {/* vm_notes: this wallet's own bookmarks and notes */}
              <NotesPanel videoId={params.id} title={video.title} currentTime={t} onSeek={seek} />
            </div>

            <aside className="hidden lg:block lg:sticky lg:top-[72px] lg:h-[calc(100vh-88px)]">
              <div className="panel h-full flex flex-col overflow-hidden">
                <ChatPanel videoId={params.id} videoTitle={video.title} onSeek={seek} />
              </div>
            </aside>
          </div>

          {/* CTA */}
          <div className="mt-16 py-10 border-t border-rule">
            <p className="font-display text-[18px] text-paper leading-tight">
              Made with VideoMind
            </p>
            <p className="text-[14px] font-sans text-dim mt-1.5 max-w-[52ch] leading-relaxed">
              Upload a lecture, a seminar or a talk and it comes back transcribed, chaptered and searchable like this one.
            </p>
            <Link href="/" className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-5">
              Open VideoMind
            </Link>
          </div>
        </div>
      </main>
      <LegalFooter className="pb-20 lg:pb-0" />

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
            <span className="text-[14px] font-medium text-paper">Ask about this video</span>
            <button onClick={() => setChat(false)} className="text-dim hover:text-paper no-min">
              <X size={15} />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ChatPanel videoId={params.id} videoTitle={video.title} onSeek={(s) => { setChat(false); seek(s); }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Bar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 h-14 bg-side border-b border-rule">
      <div className="section h-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
            <path d="M7 15.2 0.6 1.6A1 1 0 0 1 1.5 0.2h11a1 1 0 0 1 0.9 1.4L7 15.2z" className="fill-signal" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight leading-none text-paper">VideoMind</span>
        </Link>

        <Link href="/" className="btn btn-ghost h-9 px-3.5 flex items-center">
          Open VideoMind
        </Link>
      </div>
    </nav>
  );
}
