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

export default function Library() {
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
        <section className="section py-10">

          {note && (
            <div className="flex items-center gap-3 px-3 h-10 mb-6 border border-marker-dim bg-marker-wash">
              <span className="dot dot-live" />
              <span className="text-[12px] font-sans text-marker">{note}</span>
              <button onClick={() => setNote(null)} className="ml-auto text-dim hover:text-paper no-min">
                <X size={12} />
              </button>
            </div>
          )}

          <header className="panel-head">
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
