"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideos, deleteAllVideos } from "@/lib/api";
import { VideoCard, VIDEO_GRID } from "@/components/video/VideoCard";
import { SkeletonCard } from "@/components/ui/SkeletonCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { WalletButton } from "@/components/layout/WalletButton";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type Sort = "recent" | "title" | "longest";

export default function Library() {
  const { connected } = useWallet();
  // vm_signin: data loads only once the wallet has signed in
  const wallet = useSessionWallet();

  const [wipe, setWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["videos", wallet],
    queryFn: () => getVideos(wallet),
    refetchInterval: 8000,
    enabled: !!wallet,
    retry: 2,
  });

  const videos = useMemo(() => data ?? [], [data]);
  const working = videos.filter((v) => !["ready", "error"].includes(v.status)).length;

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? videos.filter((v) => v.title.toLowerCase().includes(q)) : [...videos];
    if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "longest") list.sort((a, b) => (b.meta.durationSeconds ?? 0) - (a.meta.durationSeconds ?? 0));
    else list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [videos, filter, sort]);

  const doWipe = async () => {
    if (!wallet) return;
    setWiping(true);
    try {
      const r = await deleteAllVideos(wallet);
      setNote(r.message);
      refetch(); setWipe(false);
    } catch (e: any) { setNote(e.message); }
    finally { setWiping(false); }
  };

  const loaded = connected && !!wallet && !isLoading && !isError;

  return (
    <AppShell>
      <PageHeader
        title="Library"
        description={
          loaded && videos.length > 0
            ? `${videos.length} video${videos.length === 1 ? "" : "s"}${working ? `, ${working} being processed` : ""}`
            : undefined
        }
        actions={connected && wallet ? (
          <Link href="/upload" className="btn btn-signal h-9 px-3.5 inline-flex items-center">Upload video</Link>
        ) : undefined}
      />

      <section className="section pb-16">
        {note && (
          <div role="status" className="flex items-center gap-3 px-3.5 py-2.5 mb-6 rounded-md border border-rule bg-slate">
            <span className="text-[13.5px] text-paper-2">{note}</span>
            <button onClick={() => setNote(null)} aria-label="Dismiss" className="ml-auto text-dim hover:text-paper no-min">
              <X size={14} />
            </button>
          </div>
        )}

        {!connected && (
          <EmptyState title="Connect a wallet to open your library" action={<WalletButton />}>
            Your videos are stored on Shelby and signed by your wallet. The wallet is how VideoMind knows which library is yours.
          </EmptyState>
        )}

        {/* vm_signin: connected but not signed in. The library is not empty, it is not loaded. */}
        {connected && !wallet && (
          <EmptyState title="Sign in to open your library">
            Your wallet is connected. One signature proves it is yours, then your videos load.
            The prompt is at the bottom of the page.
          </EmptyState>
        )}

        {connected && wallet && isLoading && (
          <div className={VIDEO_GRID}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {connected && wallet && isError && (
          <EmptyState
            title="The library could not be loaded"
            action={<button onClick={() => refetch()} className="btn btn-ghost h-9 px-3.5">Try again</button>}
          >
            {(error as Error)?.message}
          </EmptyState>
        )}

        {loaded && videos.length === 0 && (
          <Link
            href="/upload"
            className="block max-w-xl rounded-lg border border-dashed border-rule-lit hover:border-dim hover:bg-slate/50 transition-colors px-6 py-10"
          >
            <p className="font-display text-[17px] text-paper">Upload your first video</p>
            <p className="text-[14px] text-dim mt-1.5 leading-relaxed max-w-[46ch]">
              A lecture, a seminar, a talk. It comes back transcribed and split into chapters, and every sentence becomes searchable.
            </p>
            <span className="btn btn-signal h-9 px-3.5 inline-flex items-center mt-5">Choose a video</span>
          </Link>
        )}

        {loaded && videos.length > 0 && (
          <>
            <div className="flex items-center gap-2.5 flex-wrap mb-6">
              <label className="relative">
                <span className="sr-only">Filter by title</span>
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by title"
                  className="h-9 w-[240px] max-w-full pl-9 pr-3 text-[13.5px]"
                />
              </label>
              <label>
                <span className="sr-only">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="h-9 px-2.5 text-[13.5px] text-paper-2"
                >
                  <option value="recent">Recently added</option>
                  <option value="title">Title</option>
                  <option value="longest">Longest first</option>
                </select>
              </label>
              <button
                onClick={() => setWipe(true)}
                className="ml-auto h-9 px-2 text-[13px] text-dim hover:text-error transition-colors"
              >
                Delete all
              </button>
            </div>

            {wipe && (
              <div role="alertdialog" aria-label="Delete all videos" className="rounded-md border border-error/50 bg-slate px-4 py-3.5 mb-6 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-[14px] font-medium text-paper">
                    Delete all {videos.length} video{videos.length === 1 ? "" : "s"}?
                  </p>
                  <p className="text-[13px] text-dim mt-0.5">
                    They leave your library. The copies on Shelby stay until their paid period ends.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={doWipe}
                    disabled={wiping}
                    className="h-9 px-3.5 rounded text-[13.5px] font-medium bg-error/15 border border-error/50 text-error hover:bg-error/25 transition-colors disabled:opacity-50"
                  >
                    {wiping ? "Deleting" : "Delete all"}
                  </button>
                  <button onClick={() => setWipe(false)} className="h-9 px-3.5 btn-ghost text-[13.5px]">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {shown.length === 0 ? (
              <EmptyState
                title={`No title contains "${filter.trim()}"`}
                action={<button onClick={() => setFilter("")} className="btn btn-ghost h-9 px-3.5">Clear the filter</button>}
              >
                This box looks at titles only. To find something that was said in a video, use Search.
              </EmptyState>
            ) : (
              <div className={VIDEO_GRID}>
                {shown.map((v) => <VideoCard key={v.id} video={v} />)}
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
