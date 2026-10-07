"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { getLearningPaths, regenerateLearningPaths, type LearningPath } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { RefreshCw, ArrowRight } from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

const LEVEL: Record<string, string> = {
  Beginner:     "text-dim",
  Intermediate: "text-dim",
  Advanced:     "text-dim",
};

export default function LearnPage() {
  const { connected } = useWallet();
  // vm_signin: data loads only once the wallet has signed in
  const wallet = useSessionWallet();
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
    <AppShell>
      <PageHeader
        title="Knowledge"
        description="Your videos arranged as learning paths: what to watch first, and why."
      />
      <div className="section pb-16">
        <div className="max-w-[860px]">

          {!connected && (
            <EmptyState title="Connect a wallet to see your paths" action={<WalletButton />}>
              Paths are built from your own library.
            </EmptyState>
          )}

          {/* vm_signin: connected but not signed in */}
          {connected && !wallet && (
            <EmptyState title="Sign in to see your paths">
              Your wallet is connected. One signature proves it is yours. The prompt is at the bottom of the page.
            </EmptyState>
          )}

          {connected && isLoading && (
            <div className="space-y-4" aria-busy="true">
              <p className="text-[13.5px] text-dim">Reading your library. This can take a minute.</p>
              {[0, 1].map((i) => <div key={i} className="h-44 scan rounded-md" />)}
            </div>
          )}

          {connected && isError && (
            <EmptyState title="The paths could not be built">
              {(error as Error)?.message}
            </EmptyState>
          )}

          {connected && data && data.paths.length === 0 && (data.minRequired ?? 0) > 0 && (
            <EmptyState
              title="Not enough videos yet"
              action={<Link href="/upload" className="btn btn-signal h-9 px-3.5 inline-flex items-center">Upload a video</Link>}
            >
              You have {data.videoCount} processed video{data.videoCount !== 1 ? "s" : ""}.
              A path needs at least {data.minRequired}, so there is an order to put them in.
            </EmptyState>
          )}

          {/* vm_shell: enough videos, but no path came back. Say so and offer another try. */}
          {connected && data && data.paths.length === 0 && !((data.minRequired ?? 0) > 0) && (
            <EmptyState
              title="No paths were built this time"
              action={
                <button onClick={() => regen.mutate()} disabled={regen.isPending} className="btn btn-signal h-9 px-3.5">
                  {regen.isPending ? "Building" : "Build paths again"}
                </button>
              }
            >
              Your {data.videoCount} videos were read, but nothing usable came back. Building again usually fixes it.
            </EmptyState>
          )}

          {connected && data && data.paths.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-rule">
                <span className="text-[13.5px] text-paper-2">
                  Built from {data.videoCount} videos
                </span>
                <button
                  onClick={() => regen.mutate()}
                  disabled={regen.isPending}
                  className="flex items-center gap-1.5 text-[13px] text-dim hover:text-paper transition-colors disabled:opacity-50 no-min"
                >
                  <RefreshCw size={12} className={clsx(regen.isPending && "animate-spin")} />
                  {regen.isPending ? "Building" : "Build again"}
                </button>
              </div>

              {data.paths.map((p, i) => <Path key={i} p={p} />)}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Path({ p }: { p: LearningPath }) {
  return (
    <section className="panel">
      <header className="px-4 py-4 border-b border-rule">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className={clsx("eyebrow mb-1.5", LEVEL[p.level] ?? "text-dim")}>
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
