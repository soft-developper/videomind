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
import { CATEGORIES, LIBRARY_VIEWS, useLabels } from "@/lib/categories";
// vm_lang
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { intlLocale } from "@/i18n/config";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Sort = "recent" | "title" | "longest" | "order";
export type LibraryScope = { kind: "all" } | { kind: "view"; key: string } | { kind: "collection"; id: string };

const NONE = "__none__";

const totalSeconds = (videos: VideoRecord[]) => videos.reduce((n, v) => n + (v.meta.durationSeconds ?? 0), 0);

export function LibraryView({ scope }: { scope: LibraryScope }) {
  const t = useTranslations("library");
  const tc = useTranslations("common");
  const labels = useLabels();
  const fmt = useFormat();
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

  const viewText = scope.kind === "view" ? labels.view(scope.key) : null;
  const title = scope.kind === "all" ? t("title")
    : scope.kind === "view" ? (viewText?.label ?? t("title"))
    : (collection?.name ?? (missingCollection ? t("collectionNotFound") : t("collection")));
  const runtime = scope.kind === "collection" ? fmt.length(totalSeconds(videos)) : null;
  const facts = [
    t("videoCount", { count: videos.length }) + (runtime && totalSeconds(videos) >= 60 ? `, ${runtime}` : ""),
    working ? t("processingCount", { count: working }) : null,
  ].filter(Boolean).join(", ");
  const description = !loaded || unknownView || missingCollection ? undefined
    : videos.length === 0 ? viewText?.covers
    : viewText?.covers ? `${viewText.covers}. ${facts}.` : facts;
  // "Lecture or Seminar", joined the way each language joins a list.
  const orList = (items: string[]) => new Intl.ListFormat(intlLocale(fmt.locale), { type: "disjunction" }).format(items);

  return (
    <AppShell>
      <PageHeader
        title={title}
        description={description}
        back={scope.kind === "collection" ? { href: "/library/courses", label: t("coursesBack") } : undefined}
        actions={connected && wallet ? (
          // vm_courses: on a course, "Continue the course" is the one primary button
          <Link href="/upload" className={`btn ${scope.kind === "collection" ? "btn-ghost" : "btn-signal"} h-9 px-3.5 inline-flex items-center`}>{tc("uploadVideo")}</Link>
        ) : undefined}
      />

      <section className="section pb-16">
        {note && (
          <div role="status" className="flex items-center gap-3 px-3.5 py-2.5 mb-6 rounded-md border border-rule bg-slate">
            <span className="text-[13.5px] text-paper-2">{note}</span>
            <button onClick={() => setNote(null)} aria-label={tc("dismiss")} className="ms-auto text-dim hover:text-paper no-min">
              <X size={14} />
            </button>
          </div>
        )}

        {!connected && (
          <EmptyState title={t("connectTitle")} action={<WalletButton />}>
            {t("connectBody")}
          </EmptyState>
        )}

        {/* vm_signin: connected but not signed in. The library is not empty, it is not loaded. */}
        {connected && !wallet && (
          <EmptyState title={t("signInTitle")}>
            {t("signInBody")}
          </EmptyState>
        )}

        {connected && wallet && isLoading && (
          <div className={VIDEO_GRID}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {connected && wallet && isError && (
          <EmptyState
            title={t("loadFailed")}
            action={<button onClick={() => refetch()} className="btn btn-ghost h-9 px-3.5">{tc("tryAgain")}</button>}
          >
            {(error as Error)?.message}
          </EmptyState>
        )}

        {loaded && unknownView && (
          <EmptyState title={t("noPageTitle")} action={<Link href="/library" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("openLibrary")}</Link>}>
            {t("noPageBody")}
          </EmptyState>
        )}

        {missingCollection && (
          <EmptyState title={t("missingTitle")} action={<Link href="/library/courses" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("allCourses")}</Link>}>
            {t("missingBody")}
          </EmptyState>
        )}

        {loaded && scope.kind === "all" && videos.length === 0 && (
          <Link
            href="/upload"
            className="block max-w-xl rounded-lg border border-dashed border-rule-lit hover:border-dim hover:bg-slate/50 transition-colors px-6 py-10"
          >
            <p className="font-display text-[17px] text-paper">{t("firstTitle")}</p>
            <p className="text-[14px] text-dim mt-1.5 leading-relaxed max-w-[46ch]">
              {t("firstBody")}
            </p>
            <span className="btn btn-signal h-9 px-3.5 inline-flex items-center mt-5">{t("chooseVideo")}</span>
          </Link>
        )}

        {loaded && view && scope.kind === "view" && videos.length === 0 && (
          <EmptyState
            title={t(`views.${scope.key as "lectures"}.empty`)}
            action={<Link href="/upload" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{tc("uploadVideo")}</Link>}
          >
            {t("emptyViewBody", { categories: orList(view.categories.map((c) => labels.category(c) ?? c)) })}
          </EmptyState>
        )}

        {loaded && scope.kind === "collection" && collection && videos.length === 0 && (
          <EmptyState
            title={t("emptyCollectionTitle")}
            action={<Link href="/upload" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{tc("uploadVideo")}</Link>}
          >
            {t("emptyCollectionBody")}
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
                <span className="sr-only">{t("filterLabel")}</span>
                <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("filterLabel")}
                  className="h-9 w-[240px] max-w-full ps-9 pe-3 text-[13.5px]"
                />
              </label>
              {scope.kind === "all" && inUse.size > 1 && (
                <label>
                  <span className="sr-only">{t("categoryLabel")}</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="h-9 px-2.5 text-[13.5px] text-paper-2"
                  >
                    <option value="">{t("allCategories")}</option>
                    {CATEGORIES.filter((c) => inUse.has(c.id)).map((c) => (
                      <option key={c.id} value={c.id}>{labels.category(c.id)} ({fmt.number(inUse.get(c.id) ?? 0)})</option>
                    ))}
                    {inUse.has(NONE) && <option value={NONE}>{t("noCategory")} ({fmt.number(inUse.get(NONE) ?? 0)})</option>}
                  </select>
                </label>
              )}
              <label>
                <span className="sr-only">{t("sortLabel")}</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="h-9 px-2.5 text-[13.5px] text-paper-2"
                >

                  <option value="recent">{t("sortRecent")}</option>
                  <option value="title">{t("sortTitle")}</option>
                  <option value="longest">{t("sortLongest")}</option>
                </select>
              </label>
              {scope.kind === "all" && (
                <button
                  onClick={() => setWipe(true)}
                  className="ms-auto h-9 px-2 text-[13px] text-dim hover:text-error transition-colors"
                >
                  {t("deleteAll")}
                </button>
              )}
            </div>

            {wipe && scope.kind === "all" && (
              <div role="alertdialog" aria-label={t("deleteAllVideos")} className="rounded-md border border-error/50 bg-slate px-4 py-3.5 mb-6 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-[14px] font-medium text-paper">
                    {t("wipeTitle", { count: videos.length })}
                  </p>
                  <p className="text-[13px] text-dim mt-0.5">
                    {t("wipeBody")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={doWipe}
                    disabled={wiping}
                    className="h-9 px-3.5 rounded text-[13.5px] font-medium bg-error/15 border border-error/50 text-error hover:bg-error/25 transition-colors disabled:opacity-50"
                  >
                    {wiping ? tc("deleting") : t("deleteAll")}
                  </button>
                  <button onClick={() => setWipe(false)} className="h-9 px-3.5 btn-ghost text-[13.5px]">
                    {tc("cancel")}
                  </button>
                </div>
              </div>
            )}

            {shown.length === 0 ? (
              <EmptyState
                title={filter.trim() ? t("noMatchTitle", { filter: filter.trim() }) : t("noCategoryVideos")}
                action={<button onClick={() => { setFilter(""); setCategory(""); }} className="btn btn-ghost h-9 px-3.5">{t("clearFilters")}</button>}
              >
                {t("noMatchBody")}
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
