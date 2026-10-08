"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideo, getCaptions, getTranscriptWords, momentFromUrl, setVideoDuration, ApiError } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { InsightsPanel } from "@/components/video/InsightsPanel";
import { OnChainProof } from "@/components/video/OnChainProof";
import { TranscriptPanel } from "@/components/video/TranscriptPanel";
import { NotesPanel } from "@/components/video/NotesPanel";
import { IntelligenceStrip } from "@/components/video/IntelligenceStrip";
import { ProcessingStatus } from "@/components/video/ProcessingStatus";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video/VideoPlayer";
import { ExportMenu } from "@/components/video/ExportMenu";
import { ShareButton } from "@/components/video/ShareButton";
import { SkeletonVideoPage } from "@/components/ui/SkeletonCard";
import { ArrowLeft, MessageSquare, X, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState, useRef } from "react";
import { clsx } from "clsx";
import { useSessionWallet } from "@/components/layout/AuthProvider";
// vm_info: category, collection, tags and who can watch
import { VideoDetails } from "@/components/video/VideoDetails";
import { WalletButton } from "@/components/layout/WalletButton";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Lock } from "lucide-react";
// vm_media: the picture before playback, and what to say about a format browsers cannot all play
import { formatLabel, playbackNote } from "@/lib/media";

export default function VideoPage({ params }: { params: { id: string } }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const player = useRef<VideoPlayerHandle>(null);
  const me = useSessionWallet();
  const saved = useRef(false);

  const { connected } = useWallet();
  // vm_info: the signed in wallet is part of the key, so a private video
  // loads the moment its owner signs in.
  const { data: video, isLoading, error, refetch } = useQuery({
    queryKey: ["video", params.id, me ?? null],
    queryFn: () => getVideo(params.id),
    refetchInterval: (q) =>
      q.state.data?.status && ["ready", "error"].includes(q.state.data.status) ? false : 5000,
    // "private" and "not found" are answers, not failures to try again
    retry: (count, e) => !(e instanceof ApiError && (e.status === 403 || e.status === 404)) && count < 2,
  });

  // vm_captions: fetched once the video is ready and something was said
  const hasSpeech = video?.status === "ready" && (video.ai?.transcript?.length ?? 0) > 0;
  // vm_workspace: the words, for marking the one being said. The page works without them.
  const { data: words } = useQuery({
    queryKey: ["words", params.id, me ?? null],
    queryFn: () => getTranscriptWords(params.id),
    enabled: hasSpeech, staleTime: Infinity, retry: false,
  });
  // vm_workspace: a link to a moment (?t=90) opens the video there
  const searchParams = useSearchParams();
  const [startAt] = useState(() => momentFromUrl(searchParams.get("t")));
  const { data: captions } = useQuery({
    queryKey: ["captions", params.id, me ?? null],
    queryFn: () => getCaptions(params.id),
    enabled: hasSpeech, staleTime: Infinity, retry: false,
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
      <AppShell>
        <div className="section pt-8 pb-16">
          <SkeletonVideoPage />
        </div>
      </AppShell>
    );
  }

  // vm_info: a private video, and the caller is not its owner (or has not signed in yet)
  if (!video && error instanceof ApiError && error.code === "private") {
    return (
      <AppShell>
        <div className="section pt-10 max-w-[52ch]">
          <h1 className="font-display text-[20px] text-paper flex items-center gap-2"><Lock size={16} className="text-paper-2" /> This video is private</h1>
          <p className="text-[14px] text-dim mt-1.5 leading-relaxed">
            {me
              ? "It belongs to a different wallet, and its owner has not shared it."
              : connected
                ? "Only its owner can open it. If it is yours, sign in with your wallet. The prompt is at the bottom of the page."
                : "Only its owner can open it. If it is yours, connect the wallet you uploaded it with."}
          </p>
          <div className="flex items-center gap-2.5 mt-5 flex-wrap">
            {!connected && <WalletButton />}
            <Link href="/library" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Back to the library</Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!video) {
    return (
      <AppShell>
        <div className="section pt-10">
          <h1 className="font-display text-[20px] text-paper">This video was not found</h1>
          <p className="text-[14px] text-dim mt-1.5">It may have been deleted.</p>
          <Link href="/library" className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-5">
            Back to the library
          </Link>
        </div>
      </AppShell>
    );
  }

  const ready   = video.status === "ready";
  const failed  = video.status === "error";
  const working = !ready && !failed;
  // vm_upload: the upload itself is not finished yet
  const unfinished = video.status === "uploading";
  const mine = video.isOwner ?? (!!me && !!video.ownerWallet && me.toLowerCase() === video.ownerWallet.toLowerCase());
  const isPrivate = video.visibility === "private";
  const note = playbackNote(video.media);
  // vm_transcribe: transcribed, and nothing was said. There is nothing to analyze or to ask about.
  const speechless = ready && Array.isArray(video.ai?.transcript) && video.ai!.transcript!.length === 0;
  const source = video.source;
  const shelbyOwner = video.onShelby === false ? undefined : video.shelby.accountAddress;

  // Prefer stored duration, fall back to what the player reports
  const duration = video.meta.durationSeconds ?? dur;

  return (
    <AppShell>
      <div className="pb-20 lg:pb-10">

        <div>
          <div className="section pt-6 lg:pt-8 pb-1">
            <Link
              href="/library"
              className="inline-flex items-center gap-1 -ml-1 mb-3 text-[13px] text-dim hover:text-paper transition-colors"
            >
              <ArrowLeft size={13} /> Library
            </Link>

            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-[22px] sm:text-[24px] leading-[1.2] text-paper">
                  {video.title}
                </h1>
                {video.description && (
                  <p className="text-[13px] font-sans text-dim mt-2 max-w-2xl leading-relaxed whitespace-pre-line">
                    {video.description}
                  </p>
                )}
                <VideoDetails video={video} owner={mine} />
                {/* vm_media: only the owner can do something about the format, so only the owner is told */}
                {mine && source === "storage" && note && (
                  <p className={clsx("text-[13px] mt-3 max-w-[70ch] leading-relaxed", note.tone === "warn" ? "text-warn" : "text-dim")}>{note.text}</p>
                )}
              </div>

              {shelbyOwner && (
                <a
                  href={`https://explorer.aptoslabs.com/account/${video.shelby.accountAddress}?network=shelbynet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 shrink-0 group"
                >
                  <span className="tc group-hover:text-paper transition-colors">
                    Owner {video.shelby.accountAddress.slice(0, 6)}…{video.shelby.accountAddress.slice(-4)}
                  </span>
                  <ExternalLink size={11} className="text-dim" />
                </a>
              )}
            </div>

            {ready && (
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {isPrivate
                  ? <span className="text-[13px] text-dim">Private videos have no share link. Use Edit details to change who can watch.</span>
                  : <ShareButton videoId={params.id} />}
                <ExportMenu
                  videoId={params.id}
                  title={video.title}
                  transcript={video.ai?.transcript}
                  summary={video.ai?.summary}
                  chapters={video.ai?.chapters}
                  highlights={video.ai?.highlights}
                  tags={video.ai?.tags}
                />
              </div>
            )}
          </div>
        </div>

        <div className="section pt-6">

          {/* vm_jobs: one panel for both states. When a step fails it shows
              which step, why, and a retry for the owner. */}
          {unfinished && (
            <div className="max-w-[46ch] py-6">
              <h2 className="font-display text-[17px] text-paper">This upload is not finished</h2>
              <p className="text-[14px] text-dim mt-1.5 leading-relaxed">
                {mine
                  ? "Part of the file has arrived. Open Upload and choose the same file to continue from where it stopped."
                  : "The owner has not finished uploading this video yet."}
              </p>
              {mine && <Link href="/upload" className="btn btn-signal h-9 px-3.5 inline-flex items-center mt-5">Continue the upload</Link>}
            </div>
          )}

          {/* vm_upload: the video plays as soon as it is uploaded, even while
              it is being processed or after a step has failed. */}
          {(working || failed) && !unfinished && (
            <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
              <div className="min-w-0 space-y-5">
                {video.streamUrl && (
                  <VideoPlayer
                    ref={player}
                    streamUrl={video.streamUrl}
                    source={video.source}
                    poster={video.posterUrl}
                    format={video.media && video.media.playable !== "yes" ? formatLabel(video.media) : null}
                    title={video.title}
                    onDuration={onDuration}
                    onTimeUpdate={setT}
                  />
                )}
                <OnChainProof
                  owner={shelbyOwner}
                  blobName={video.shelby.videoBlobName}
                  storeHref={mine ? `/upload?anchor=${video.id}` : undefined}
                />
              </div>
              <ProcessingStatus videoId={params.id} onReady={() => refetch()} />
            </div>
          )}

          {ready && (
            <div className="grid lg:grid-cols-[1fr_380px] gap-6">
              <div className="space-y-5 min-w-0">

                <VideoPlayer
                  ref={player}
                  streamUrl={video.streamUrl ?? null}
                  source={video.source}
                  poster={video.posterUrl}
                  format={video.media && video.media.playable !== "yes" ? formatLabel(video.media) : null}
                  title={video.title}
                  shelbyAddress={video.shelby.accountAddress}
                  blobName={video.shelby.videoBlobName}
                  captions={captions ?? null}
                  chapters={video.ai?.chapters}
                  startAt={startAt}
                  onDuration={onDuration}
                  onTimeUpdate={setT}
                />

                {/* ★ THE SIGNATURE - sits directly under the frame ★ */}
                <IntelligenceStrip
                  duration={duration}
                  currentTime={t}
                  transcript={video.ai?.transcript}
                  chapters={video.ai?.chapters}
                  highlights={video.ai?.highlights}
                  onSeek={seek}
                />

                {speechless ? (
                  <div className="panel p-5">
                    <p className="text-[14.5px] font-medium text-paper">No speech was found in this video</p>
                    <p className="text-[13.5px] text-dim mt-1 leading-relaxed max-w-[62ch]">
                      {video.media && !video.media.hasAudio
                        ? "It has no sound, so there is nothing to transcribe."
                        : "Its sound was transcribed and no words came back."}{" "}
                      Chapters, the summary and questions all come from what is said, so this video has none.
                    </p>
                  </div>
                ) : (
                  <InsightsPanel video={video} onSeek={seek} owner={mine} currentTime={t} duration={duration || undefined} onChaptersSaved={() => refetch()} />
                )}

                <OnChainProof
                  owner={shelbyOwner}
                  blobName={video.shelby.videoBlobName}
                  storeHref={mine ? `/upload?anchor=${video.id}` : undefined}
                />

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

              <aside className="hidden lg:block lg:sticky lg:top-6 lg:h-[calc(100vh-48px)]">
                <div className={clsx("panel flex flex-col overflow-hidden", !speechless && "h-full")}>
                  {speechless
                    ? <p className="p-5 text-[13.5px] text-dim leading-relaxed">Questions are answered from what is said in a video. This one has no speech.</p>
                    : <ChatPanel videoId={params.id} videoTitle={video.title} onSeek={seek} />}
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>

      {/* Mobile chat */}
      {ready && !speechless && (
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
                <span className="text-[14px] font-medium text-paper">Ask about this video</span>
                <button onClick={() => setChatOpen(false)} className="text-dim hover:text-paper no-min">
                  <X size={15} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <ChatPanel videoId={params.id} videoTitle={video.title} onSeek={(s) => { setChatOpen(false); seek(s); }} />
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
