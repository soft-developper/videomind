"use client";
// vm_info: one list of the wallet's videos, used by every library page.
//   all         every video, with a category filter
//   view        the videos of one sidebar page (Lectures, Seminars, ...)
//   collection  the videos of one collection, in the order they were added
import { useQuery } from "@tanstack/react-query";
import { getVideos, getCollections, deleteAllVideos, getMyProgress, type VideoRecord } from "@/lib/api";
import { VideoCard, VIDEO_GRID } from "@/components/video/VideoCard";
import { CourseView } from "./CourseView";
import { SkeletonCard } from "@/components/ui/SkeletonCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { WalletButton } from "@/components/layout/WalletButton";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { CATEGORIES, LIBRARY_VIEWS, categoryLabel } from "@/lib/categories";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Sort = "recent" | "title" | "longest" | "order";
export type LibraryScope = { kind: "all" } | { kind: "view"; key: string } | { kind: "collection"; id: string };

const NONE = "__none__";

function total(videos: VideoRecord[]): string | null {
  const min = Math.round(videos.reduce((n, v) => n + (v.meta.durationSeconds ?? 0), 0) / 60);
  if (min < 1) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function LibraryView({ scope }: { scope: LibraryScope }) {
  const { connected } = useWallet();
  // vm_signin: data loads only once the wallet has signed in
  const wallet = useSessionWallet();

  const [wipe, setWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<Sort>(scope.kind === "collection" ? "order" : "recent");

  // vm_progress: the filter, category and order live in the address, so Back
  // from a video returns to the same list.
  const router = useRouter();
  const path = usePathname();
  // Set once the address has been read, so the address is not written over before that.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setFilter(p.get("q") ?? "");
    setCategory(p.get("category") ?? "");
    const so = p.get("sort");
    if (so && ["recent", "title", "longest", "order"].includes(so)) setSort(so as Sort);
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    const p = new URLSearchParams();
    if (filter.trim()) p.set("q", filter.trim());
    if (category) p.set("category", category);
    if (sort !== (scope.kind === "collection" ? "order" : "recent")) p.set("sort", sort);
    const next = p.toString() ? `${path}?${p.toString()}` : path;
    if (next !== window.location.pathname + window.location.search) router.replace(next, { scroll: false });
  }, [restored, filter, category, sort, path, router, scope.kind]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["videos", wallet],
    queryFn: () => getVideos(wallet),
    refetchInterval: 8000,
    enabled: !!wallet,
    retry: 2,
  });
  // vm_progress: how far this wallet got in each video, for the cards
  const { data: mine } = useQuery({ queryKey: ["my-progress", wallet ?? null], queryFn: getMyProgress, enabled: !!wallet, staleTime: 15_000 });
  const collections = useQuery({
    queryKey: ["collections", wallet],
    queryFn: getCollections,
    enabled: !!wallet && scope.kind === "collection",
  });

  const all = useMemo(() => data ?? [], [data]);
  const view = scope.kind === "view" ? LIBRARY_VIEWS[scope.key] : undefined;
  const collection = scope.kind === "collection" ? collections.data?.find((c) => c.id === scope.id) : undefined;

  // The videos this page is about, before the visitor's own filters.
  const videos = useMemo(() => {
    if (scope.kind === "view") return view ? all.filter((v) => !!v.category && view.categories.includes(v.category)) : [];
    if (scope.kind === "collection") return all.filter((v) => v.collection?.id === scope.id);
    return all;
  }, [all, scope, view]);
  const working = videos.filter((v) => !["ready", "error"].includes(v.status)).length;

  // Categories in use, for the filter on All videos.
  const inUse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of all) counts.set(v.category || NONE, (counts.get(v.category || NONE) ?? 0) + 1);
    return counts;
  }, [all]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = q ? videos.filter((v) => v.title.toLowerCase().includes(q) || (v.tags ?? []).some((t) => t.toLowerCase().includes(q))) : [...videos];
    if (scope.kind === "all" && category) list = list.filter((v) => (v.category || NONE) === category);
    if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "longest") list.sort((a, b) => (b.meta.durationSeconds ?? 0) - (a.meta.durationSeconds ?? 0));
    else if (sort === "order") list.sort((a, b) => (a.collection?.position ?? 0) - (b.collection?.position ?? 0) || a.createdAt - b.createdAt);
    else list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [videos, filter, category, sort, scope.kind]);

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
  const unknownView = scope.kind === "view" && !view;
  const missingCollection = scope.kind === "collection" && loaded && collections.isSuccess && !collection;

  const title = scope.kind === "all" ? "Library"
    : scope.kind === "view" ? (view?.label ?? "Library")
    : (collection?.name ?? (missingCollection ? "Collection not found" : "Collection"));
  const facts = [
    `${videos.length} video${videos.length === 1 ? "" : "s"}` + (scope.kind === "collection" && total(videos) ? `, ${total(videos)}` : ""),
    working ? `${working} being processed` : null,
  ].filter(Boolean).join(", ");
  const description = !loaded || unknownView || missingCollection ? undefined
    : videos.length === 0 ? view?.covers
    : view?.covers ? `${view.covers}. ${facts}.` : facts;

  return (
    <AppShell>
      <PageHeader
        title={title}
        description={description}
        back={scope.kind === "collection" ? { href: "/library/courses", label: "Courses" } : undefined}
        actions={connected && wallet ? (
          // vm_courses: on a course, "Continue the course" is the one primary button
          <Link href="/upload" className={`btn ${scope.kind === "collection" ? "btn-ghost" : "btn-signal"} h-9 px-3.5 inline-flex items-center`}>Upload video</Link>
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
            Your library belongs to your wallet. The wallet is how VideoMind knows which videos are yours.
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

        {loaded && unknownView && (
          <EmptyState title="This page does not exist" action={<Link href="/library" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Open the library</Link>}>
            There is no library page at this address.
          </EmptyState>
        )}

        {missingCollection && (
          <EmptyState title="This collection was not found" action={<Link href="/library/courses" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">All courses</Link>}>
            It may have been deleted, or it belongs to a different wallet.
          </EmptyState>
        )}

        {loaded && scope.kind === "all" && videos.length === 0 && (
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

        {loaded && view && videos.length === 0 && (
          <EmptyState
            title={`No ${view.label.toLowerCase()} yet`}
            action={<Link href="/upload" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Upload video</Link>}
          >
            Videos with the category {view.categories.map((c) => categoryLabel(c)).join(" or ")} are listed here. Choose the category when you upload, or with Edit details on a video's page.
          </EmptyState>
        )}

        {loaded && scope.kind === "collection" && collection && videos.length === 0 && (
          <EmptyState
            title="Nothing in this collection yet"
            action={<Link href="/upload" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Upload video</Link>}
          >
            Choose this collection when you upload, or with Edit details on a video's page.
          </EmptyState>
        )}

        {/* vm_courses: a collection is shown as a course, its videos as lessons in order */}
        {loaded && scope.kind === "collection" && collection && videos.length > 0 && (
          <CourseView
            collection={collection}
            videos={videos}
            watched={mine?.watched}
            onChanged={() => { refetch(); collections.refetch(); }}
          />
        )}

        {loaded && scope.kind !== "collection" && !unknownView && !missingCollection && videos.length > 0 && (
          <>
            <div className="flex items-center gap-2.5 flex-wrap mb-6">
              <label className="relative">
                <span className="sr-only">Filter by title or tag</span>
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by title or tag"
                  className="h-9 w-[240px] max-w-full pl-9 pr-3 text-[13.5px]"
                />
              </label>
              {scope.kind === "all" && inUse.size > 1 && (
                <label>
                  <span className="sr-only">Category</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-9 px-2.5 text-[13.5px] text-paper-2"
                  >
                    <option value="">All categories</option>
                    {CATEGORIES.filter((c) => inUse.has(c.id)).map((c) => (
                      <option key={c.id} value={c.id}>{c.label} ({inUse.get(c.id)})</option>
                    ))}
                    {inUse.has(NONE) && <option value={NONE}>No category ({inUse.get(NONE)})</option>}
                  </select>
                </label>
              )}
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
              {scope.kind === "all" && (
                <button
                  onClick={() => setWipe(true)}
                  className="ml-auto h-9 px-2 text-[13px] text-dim hover:text-error transition-colors"
                >
                  Delete all
                </button>
              )}
            </div>

            {wipe && scope.kind === "all" && (
              <div role="alertdialog" aria-label="Delete all videos" className="rounded-md border border-error/50 bg-slate px-4 py-3.5 mb-6 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-[14px] font-medium text-paper">
                    Delete all {videos.length} video{videos.length === 1 ? "" : "s"}?
                  </p>
                  <p className="text-[13px] text-dim mt-0.5">
                    They leave your library. Copies stored on Shelby stay there until their paid period ends.
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
                title={filter.trim() ? `Nothing matches "${filter.trim()}"` : "No videos in this category"}
                action={<button onClick={() => { setFilter(""); setCategory(""); }} className="btn btn-ghost h-9 px-3.5">Clear the filters</button>}
              >
                This box looks at titles and tags only. To find something that was said in a video, use Search.
              </EmptyState>
            ) : (
              <div className={VIDEO_GRID}>
                {shown.map((v) => <VideoCard key={v.id} video={v} watched={mine?.watched[v.id]} />)}
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
