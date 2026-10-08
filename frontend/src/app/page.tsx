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
import { VideoCard, VIDEO_GRID, when, clock } from "@/components/video/VideoCard";

const STEP: Record<string, string> = {
  uploading: "Upload not finished",
  processing: "Processing",
  transcribing: "Transcribing",
  analyzing: "Finding chapters",
  error: "Stopped",
};

const WHAT_YOU_GET: Array<[string, string]> = [
  ["Transcript", "Every sentence with its time. Click a sentence and the video jumps to it."],
  ["Chapters", "The recording is split where the topic changes, so a long video can be scanned like a document."],
  ["Search", "Look for something that was said and land on the moment it was said."],
  ["Questions", "Ask about a video and get an answer that points to the moments it came from."],
  ["Ownership", "The file is stored on Shelby and signed by your wallet, with a proof anyone can check."],
];

/**
 * What one lecture looks like once it is in the library: its chapters,
 * the ruler cut at each chapter, and the transcript with the sentence
 * being spoken marked. Shown to visitors as an example, and labelled so.
 */
function Example() {
  const chapters: Array<[string, string, number]> = [
    ["00:00", "Introduction", 8],
    ["07:54", "What is a distributed system?", 6],
    ["14:11", "Why distribution is hard", 8],
    ["22:27", "Replication", 7],
    ["29:40", "Fault tolerance", 7],
    ["36:22", "The CAP theorem", 9],
    ["45:10", "A real world example", 8],
    ["52:48", "Summary and reading", 5],
  ];
  const lines: Array<[string, string, boolean]> = [
    ["14:02", "So far we have assumed that messages always arrive.", false],
    ["14:11", "The network is not reliable, and that single fact shapes everything we do.", true],
    ["14:19", "A message can be late, it can be lost, and it can arrive twice.", false],
  ];
  return (
    <figure className="w-full max-w-[440px]">
      <div className="rounded-lg border border-rule bg-slate p-4">
        <p className="text-[14px] font-medium text-paper leading-snug">
          Introduction to Distributed Systems: Lecture 01
        </p>
        <p className="tc mt-0.5">8 chapters, 58 min</p>

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
                ? "flex gap-3 px-2 py-1.5 -mx-2 rounded bg-signal/[0.13] text-paper text-[13.5px] leading-snug shadow-[inset_2px_0_0_var(--signal)]"
                : "flex gap-3 px-2 py-1.5 -mx-2 text-dim text-[13.5px] leading-snug"}
            >
              <span className="tc w-[40px] shrink-0 text-inherit pt-px">{t}</span>
              <span>{text}</span>
            </p>
          ))}
        </div>
      </div>
      <figcaption className="text-[12.5px] text-dim mt-2.5">
        An example. The yellow marks follow the video as it plays.
      </figcaption>
    </figure>
  );
}

/** vm_progress: a video this viewer has started, with how far they got. */
function ContinueCard({ item }: { item: ContinueItem }) {
  const dur = item.durationSeconds ?? 0;
  const left = dur ? Math.max(0, Math.round((dur - item.positionSeconds) / 60)) : null;
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
      <h3 className="pt-2.5 text-[14px] font-medium leading-snug line-clamp-2 text-paper">{item.title}</h3>
      <p className="tc mt-1">
        Stopped at {clock(item.positionSeconds)}{left !== null ? `, ${left < 1 ? "under a minute" : `${left} min`} left` : ""}
      </p>
    </Link>
  );
}

function useGreeting(): string {
  // Set after mount, so the server and the browser never disagree on the hour.
  const [text, setText] = useState("Welcome back");
  useEffect(() => {
    const h = new Date().getHours();
    setText(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);
  return text;
}

export default function Home() {
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
              A library for long videos
            </h1>
            <p className="text-[16px] text-paper-2 mt-4 leading-[1.6] max-w-[56ch]">
              Upload a lecture, a seminar or a talk. It comes back transcribed and split into
              chapters, and every sentence in it becomes something you can search for and jump to.
            </p>
            <div className="flex items-center gap-3 mt-7 flex-wrap">
              <WalletButton />
              <Link href="/about" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">How it works</Link>
            </div>

          <dl className="mt-12 border-t border-rule">
            {WHAT_YOU_GET.map(([term, text]) => (
              <div key={term} className="grid sm:grid-cols-[160px_1fr] gap-x-6 gap-y-1 py-4 border-b border-rule">
                <dt className="text-[14px] font-medium text-paper">{term}</dt>
                <dd className="text-[14px] text-dim leading-relaxed">{text}</dd>
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
            ? `${videos.length} video${videos.length === 1 ? "" : "s"} in your library${working ? `, ${working} being processed` : ""}`
            : undefined
        }
        actions={wallet ? (
          <Link href="/upload" className="btn btn-signal h-9 px-3.5 inline-flex items-center">Upload video</Link>
        ) : undefined}
      />

      <div className="section pb-16">
        {!wallet && (
          <EmptyState title="Sign in to open your library">
            Your wallet is connected. One signature proves it is yours, then your videos load.
            The prompt is at the bottom of the page.
          </EmptyState>
        )}

        {wallet && isLoading && (
          <div className={VIDEO_GRID}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {wallet && isError && (
          <EmptyState
            title="Your videos could not be loaded"
            action={<button onClick={() => refetch()} className="btn btn-ghost h-9 px-3.5">Try again</button>}
          >
            {(error as Error)?.message}
          </EmptyState>
        )}

        {wallet && data && videos.length === 0 && (
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

        {/* vm_progress: search, and picking up where you stopped */}
        {wallet && data && videos.length > 0 && (
          <form
            role="search"
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}
            className="flex items-center max-w-[560px] mb-10 rounded-md border border-rule bg-side focus-within:border-dim transition-colors"
          >
            <Search size={14} className="text-dim ml-3 shrink-0" />
            <label htmlFor="home-search" className="sr-only">Search your library</label>
            <input
              id="home-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search everything that was said in your videos"
              className="flex-1 min-w-0 h-10 px-3 text-[14px] bg-transparent border-0 rounded-none focus:border-0"
            />
          </form>
        )}

        {wallet && (mine?.continue.length ?? 0) > 0 && (
          <section aria-labelledby="continue" className="mb-12">
            <h2 id="continue" className="font-display text-[15px] text-paper mb-4">Continue watching</h2>
            <div className={VIDEO_GRID}>
              {mine!.continue.slice(0, 4).map((c) => <ContinueCard key={c.videoId} item={c} />)}
            </div>
          </section>
        )}

        {wallet && inProgress.length > 0 && (
          <section aria-labelledby="in-progress" className="mb-12">
            <h2 id="in-progress" className="font-display text-[15px] text-paper mb-3">In progress</h2>
            <ul className="rounded-md border border-rule divide-y divide-rule overflow-hidden">
              {inProgress.map((v) => {
                const failed = v.status === "error";
                return (
                  <li key={v.id}>
                    <Link href={`/video/${v.id}`} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-slate transition-colors">
                      <span className={failed ? "dot dot-dead" : "dot dot-work"} />
                      <span className="text-[14px] text-paper truncate">{v.title}</span>
                      <span className={failed ? "ml-auto shrink-0 text-[13px] text-error" : "ml-auto shrink-0 text-[13px] text-paper-2"}>
                        {STEP[v.status] ?? "Processing"}
                      </span>
                      <span className="tc w-[92px] shrink-0 text-right hidden sm:block">{when(v.createdAt)}</span>
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
              <h2 id="recent" className="font-display text-[15px] text-paper">Recent videos</h2>
              <Link href="/library" className="text-[13px] text-dim hover:text-paper transition-colors">
                Open the library
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
