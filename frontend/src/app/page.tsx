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
