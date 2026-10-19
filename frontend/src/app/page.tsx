"use client";
// vm_shell: Home. For someone signed in it answers "what is happening
// with my videos". For a visitor it says what VideoMind is, plainly.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getVideos, getMyProgress, type ContinueItem } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { WalletButton } from "@/components/layout/WalletButton";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/SkeletonCard";
import { VideoCard, VIDEO_GRID, clock, stepKey } from "@/components/video/VideoCard";
// vm_lang
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

// vm_lang: the five things a visitor gets, as message keys under "home.what".
const WHAT_YOU_GET = ["transcript", "chapters", "search", "questions", "ownership"] as const;

/**
 * What one lecture looks like once it is in the library: its chapters,
 * the ruler cut at each chapter, and the transcript with the sentence
 * being spoken marked. Shown to visitors as an example, and labelled so.
 */
function Example() {
  const t = useTranslations("home.example");
  const chapters: Array<[string, string, number]> = [
    ["00:00", t("c1"), 8],
    ["07:54", t("c2"), 6],
    ["14:11", t("c3"), 8],
    ["22:27", t("c4"), 7],
    ["29:40", t("c5"), 7],
    ["36:22", t("c6"), 9],
    ["45:10", t("c7"), 8],
    ["52:48", t("c8"), 5],
  ];
  const lines: Array<[string, string, boolean]> = [
    ["14:02", t("l1"), false],
    ["14:11", t("l2"), true],
    ["14:19", t("l3"), false],
  ];
  return (
    <figure className="w-full max-w-[440px]">
      <div className="rounded-lg border border-rule bg-slate p-4">
        <p className="text-[14px] font-medium text-paper leading-snug">
          {t("title")}
        </p>
        <p className="tc mt-0.5">{t("facts")}</p>

        <div className="flex gap-[3px] h-[4px] mt-4" aria-hidden>
          {chapters.map(([, , w], i) => (
            <span key={i} style={{ flexGrow: w, flexBasis: 0 }} className={i === 2 ? "rounded-full bg-signal" : "rounded-full bg-rule-lit"} />
          ))}
        </div>

        <ol className="mt-3 text-[13px]">
          {chapters.slice(1, 5).map(([t, title], i) => (
            <li key={t} className={i === 1 ? "flex gap-3 py-[5px] text-paper" : "flex gap-3 py-[5px] text-dim"}>
              <span className="tc w-[40px] shrink-0 text-inherit">{t}</span>
              <span className="truncate">{title}</span>
            </li>
          ))}
        </ol>

        <div className="mt-3 pt-3 border-t border-rule space-y-1">
          {lines.map(([t, text, now]) => (
            <p
              key={t}
              className={now
                ? "flex gap-3 px-2 py-1.5 -mx-2 rounded bg-signal/[0.13] text-paper text-[13.5px] leading-snug shadow-[inset_2px_0_0_var(--signal)] rtl:shadow-[inset_-2px_0_0_var(--signal)]"
                : "flex gap-3 px-2 py-1.5 -mx-2 text-dim text-[13.5px] leading-snug"}
            >
              <span className="tc w-[40px] shrink-0 text-inherit pt-px">{t}</span>
              <span>{text}</span>
            </p>
          ))}
        </div>
      </div>
      <figcaption className="text-[12.5px] text-dim mt-2.5">
        {t("caption")}
      </figcaption>
    </figure>
  );
}

/** vm_progress: a video this viewer has started, with how far they got. */
function ContinueCard({ item }: { item: ContinueItem }) {
  const t = useTranslations("home");
  const fmt = useFormat();
  const dur = item.durationSeconds ?? 0;
  const left = dur ? Math.max(0, dur - item.positionSeconds) : null;
  return (
    <Link href={`/video/${item.videoId}`} className="block group rounded-md focus-visible:outline-offset-4">
      <div className="relative aspect-video overflow-hidden rounded-md bg-screen border border-rule group-hover:border-rule-lit transition-colors">
        {item.thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        )}
        {dur > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-rule-lit/60" aria-hidden>
            <span className="block h-full bg-signal" style={{ width: `${Math.min(100, (item.positionSeconds / dur) * 100)}%` }} />
          </span>
        )}
      </div>
      <h3 dir="auto" className="pt-2.5 text-[14px] font-medium leading-snug line-clamp-2 text-paper">{item.title}</h3>
      <p className="tc mt-1">
        {t("stoppedAt", { time: clock(item.positionSeconds) ?? "" })}{left !== null ? `, ${t("left", { time: fmt.left(left) })}` : ""}
      </p>
    </Link>
  );
}

function useGreeting(): string {
  const t = useTranslations("home.greeting");
  // Set after mount, so the server and the browser never disagree on the hour.
  const [key, setKey] = useState<"welcome" | "morning" | "afternoon" | "evening">("welcome");
  useEffect(() => {
    const h = new Date().getHours();
    setKey(h < 12 ? "morning" : h < 18 ? "afternoon" : "evening");
  }, []);
  return t(key);
}

export default function Home() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const tcard = useTranslations("card");
  const tl = useTranslations("library");
  const fmt = useFormat();
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const greeting = useGreeting();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["videos", wallet],
    queryFn: () => getVideos(wallet),
    refetchInterval: 8000,
    enabled: !!wallet,
    retry: 2,
  });

  // vm_progress: where this wallet stopped in each video
  const { data: mine } = useQuery({ queryKey: ["my-progress", wallet ?? null], queryFn: getMyProgress, enabled: !!wallet, staleTime: 15_000 });
  const router = useRouter();
  const [q, setQ] = useState("");

  const videos = useMemo(() => [...(data ?? [])].sort((a, b) => b.createdAt - a.createdAt), [data]);
  const inProgress = videos.filter((v) => v.status !== "ready");
  const recent = videos.filter((v) => v.status === "ready").slice(0, 8);
  const working = inProgress.filter((v) => v.status !== "error").length;

  // ── Visitor ───────────────────────────────────────────────────────────────
  if (!connected) {
    return (
      <AppShell>
        <div className="section pt-10 lg:pt-16 pb-20">
          <div className="grid xl:grid-cols-[minmax(0,640px)_1fr] gap-x-16 gap-y-12 items-start">
          <div>
            <h1 className="font-display text-[30px] sm:text-[38px] leading-[1.12] text-paper">
              {t("heroTitle")}
            </h1>
            <p className="text-[16px] text-paper-2 mt-4 leading-[1.6] max-w-[56ch]">
              {t("heroBody")}
            </p>
            <div className="flex items-center gap-3 mt-7 flex-wrap">
              <WalletButton />
              <Link href="/about" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("howItWorks")}</Link>
            </div>

          <dl className="mt-12 border-t border-rule">
            {WHAT_YOU_GET.map((k) => (
              <div key={k} className="grid sm:grid-cols-[160px_1fr] gap-x-6 gap-y-1 py-4 border-b border-rule">
                <dt className="text-[14px] font-medium text-paper">{t(`what.${k}.term`)}</dt>
                <dd className="text-[14px] text-dim leading-relaxed">{t(`what.${k}.text`)}</dd>
              </div>
            ))}
          </dl>
          </div>
          <div className="xl:justify-self-end xl:pt-2">
            <Example />
          </div>
          </div>

        </div>
      </AppShell>
    );
  }

  // ── Connected ─────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <PageHeader
        title={greeting}
        description={
          wallet && data && videos.length > 0
            ? t("inLibrary", { count: videos.length }) + (working ? `, ${tl("processingCount", { count: working })}` : "")
            : undefined
        }
        actions={wallet ? (
          <Link href="/upload" className="btn btn-signal h-9 px-3.5 inline-flex items-center">{tc("uploadVideo")}</Link>
        ) : undefined}
      />

      <div className="section pb-16">
        {!wallet && (
          <EmptyState title={tl("signInTitle")}>
            {tl("signInBody")}
          </EmptyState>
        )}

        {wallet && isLoading && (
          <div className={VIDEO_GRID}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {wallet && isError && (
          <EmptyState
            title={t("loadFailed")}
            action={<button onClick={() => refetch()} className="btn btn-ghost h-9 px-3.5">{tc("tryAgain")}</button>}
          >
            {(error as Error)?.message}
          </EmptyState>
        )}

        {wallet && data && videos.length === 0 && (
          <Link
            href="/upload"
            className="block max-w-xl rounded-lg border border-dashed border-rule-lit hover:border-dim hover:bg-slate/50 transition-colors px-6 py-10"
          >
            <p className="font-display text-[17px] text-paper">{tl("firstTitle")}</p>
            <p className="text-[14px] text-dim mt-1.5 leading-relaxed max-w-[46ch]">
              {tl("firstBody")}
            </p>
            <span className="btn btn-signal h-9 px-3.5 inline-flex items-center mt-5">{tl("chooseVideo")}</span>
          </Link>
        )}

        {/* vm_progress: search, and picking up where you stopped */}
        {wallet && data && videos.length > 0 && (
          <form
            role="search"
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}
            className="flex items-center max-w-[560px] mb-10 rounded-md border border-rule bg-side focus-within:border-dim transition-colors"
          >
            <Search size={14} className="text-dim ms-3 shrink-0" />
            <label htmlFor="home-search" className="sr-only">{t("searchLabel")}</label>
            <input
              id="home-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="flex-1 min-w-0 h-10 px-3 text-[14px] bg-transparent border-0 rounded-none focus:border-0"
            />
          </form>
        )}

        {wallet && (mine?.continue.length ?? 0) > 0 && (
          <section aria-labelledby="continue" className="mb-12">
            <h2 id="continue" className="font-display text-[15px] text-paper mb-4">{t("continueWatching")}</h2>
            <div className={VIDEO_GRID}>
              {mine!.continue.slice(0, 4).map((c) => <ContinueCard key={c.videoId} item={c} />)}
            </div>
          </section>
        )}

        {wallet && inProgress.length > 0 && (
          <section aria-labelledby="in-progress" className="mb-12">
            <h2 id="in-progress" className="font-display text-[15px] text-paper mb-3">{t("inProgress")}</h2>
            <ul className="rounded-md border border-rule divide-y divide-rule overflow-hidden">
              {inProgress.map((v) => {
                const failed = v.status === "error";
                return (
                  <li key={v.id}>
                    <Link href={`/video/${v.id}`} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate transition-colors">
                      <span className={failed ? "dot dot-dead" : "dot dot-work"} />
                      <span dir="auto" className="text-[14px] text-paper truncate">{v.title}</span>
                      <span className={failed ? "ms-auto shrink-0 text-[13px] text-error" : "ms-auto shrink-0 text-[13px] text-paper-2"}>
                        {tcard(`step.${stepKey(v.status)}`)}
                      </span>
                      <span className="tc w-[110px] shrink-0 text-end hidden sm:block">{fmt.ago(v.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {wallet && recent.length > 0 && (
          <section aria-labelledby="recent">
            <div className="flex items-baseline justify-between gap-4 mb-4">
              <h2 id="recent" className="font-display text-[15px] text-paper">{t("recent")}</h2>
              <Link href="/library" className="text-[13px] text-dim hover:text-paper transition-colors">
                {tl("openLibrary")}
              </Link>
            </div>
            <div className={VIDEO_GRID}>
              {recent.map((v) => <VideoCard key={v.id} video={v} watched={mine?.watched[v.id]} />)}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
