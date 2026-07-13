"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getLearningPaths, regenerateLearningPaths, type LearningPath } from "@/lib/api";
import { Navbar } from "@/components/layout/Navbar";
import { RefreshCw, ArrowRight } from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

const LEVEL: Record<string, string> = {
  Beginner:     "text-marker",
  Intermediate: "text-warn",
  Advanced:     "text-signal",
};

export default function LearnPage() {
  const { connected, account } = useWallet();
  const wallet = account?.address?.toString();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["learning-paths", wallet],
    queryFn: () => getLearningPaths(wallet!),
    enabled: !!wallet && connected,
    staleTime: 60_000,
  });

  const regen = useMutation({
    mutationFn: () => regenerateLearningPaths(wallet!),
    onSuccess: (d) => qc.setQueryData(["learning-paths", wallet], d),
  });

  return (
    <div className="min-h-screen bg-void">
      <Navbar />
      <main className="pt-14">
        <div className="border-b border-rule">
          <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-10">
            <p className="eyebrow mb-4">Curriculum</p>
            <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.05] text-paper max-w-lg">
              Your library,
              <br />
              <span className="italic text-signal">in the right order.</span>
            </h1>
            <p className="text-[14px] font-sans text-dim mt-4 max-w-md leading-relaxed">
              Claude reads everything you've uploaded and works out what to watch first —
              and why.
            </p>
          </div>
        </div>

        <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-8">

          {!connected && (
            <div className="py-20 text-center">
              <p className="font-display text-[24px] text-paper mb-3">Connect a wallet</p>
              <p className="text-[13px] font-sans text-dim">
                Paths are built from your own library.
              </p>
            </div>
          )}

          {connected && isLoading && (
            <div className="space-y-4">
              {[0, 1].map((i) => (
                <div key={i} className="panel">
                  <div className="h-16 scan border-b border-rule" />
                  <div className="h-40 scan" />
                </div>
              ))}
              <p className="tc text-center pt-4">Claude is reading your library…</p>
            </div>
          )}

          {connected && isError && (
            <div className="py-16 text-center space-y-3">
              <p className="font-display text-[22px] text-paper">Couldn't build paths</p>
              <p className="text-[13px] font-sans text-dim">{(error as Error)?.message}</p>
            </div>
          )}

          {connected && data && data.paths.length === 0 && (data.minRequired ?? 0) > 0 && (
            <div className="py-20 text-center space-y-4">
              <p className="font-display text-[24px] text-paper">
                Not enough to work with yet
              </p>
              <p className="text-[13px] font-sans text-dim max-w-sm mx-auto leading-relaxed">
                You have {data.videoCount} processed video{data.videoCount !== 1 ? "s" : ""}.
                Paths need at least {data.minRequired} so there's an actual sequence to build.
              </p>
              <Link href="/upload" className="btn btn-signal h-10 px-5 inline-flex items-center gap-2 mt-2">
                Upload another <ArrowRight size={13} />
              </Link>
            </div>
          )}

          {connected && data && data.paths.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-rule">
                <span className="tc">
                  From {data.videoCount} videos{data.cached && " · cached"}
                </span>
                <button
                  onClick={() => regen.mutate()}
                  disabled={regen.isPending}
                  className="flex items-center gap-1.5 tc hover:text-paper transition-colors disabled:opacity-50 no-min"
                >
                  <RefreshCw size={10} className={clsx(regen.isPending && "animate-spin")} />
                  {regen.isPending ? "Rebuilding…" : "Rebuild"}
                </button>
              </div>

              {data.paths.map((p, i) => <Path key={i} p={p} />)}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Path({ p }: { p: LearningPath }) {
  return (
    <section className="panel">
      <header className="px-4 py-4 border-b border-rule">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className={clsx("eyebrow mb-1.5", LEVEL[p.level] ?? "text-marker")}>
              {p.level}
            </p>
            <h2 className="font-display text-[22px] text-paper leading-tight">
              {p.title}
            </h2>
            <p className="text-[13px] font-sans text-dim mt-1.5 leading-relaxed">
              {p.description}
            </p>
          </div>
          <span className="tc tabular-nums shrink-0">
            {p.steps.length} step{p.steps.length !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      <div>
        {p.steps.map((s, i) => (
          <Link
            key={`${s.videoId}-${i}`}
            href={`/video/${s.videoId}`}
            className="flex items-start gap-4 px-4 py-3.5 border-b border-rule last:border-0 hover:bg-slate transition-colors group"
          >
            <span className="tc tabular-nums shrink-0 pt-1 group-hover:tc-signal transition-colors">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="w-px self-stretch bg-rule group-hover:bg-signal transition-colors shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block font-display text-[17px] text-paper leading-tight group-hover:text-signal transition-colors">
                {s.title}
              </span>
              <span className="block text-[12px] font-sans text-dim mt-1 leading-relaxed">
                {s.reason}
              </span>
            </span>
            <ArrowRight size={12} className="text-dim-2 group-hover:text-signal shrink-0 mt-1 transition-colors" />
          </Link>
        ))}
      </div>
    </section>
  );
}
