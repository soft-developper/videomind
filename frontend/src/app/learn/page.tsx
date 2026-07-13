"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getLearningPaths, regenerateLearningPaths, type LearningPath } from "@/lib/api";
import { Navbar } from "@/components/layout/Navbar";
import {
  GraduationCap, Wallet, Loader2, RefreshCw, AlertTriangle,
  Play, ArrowRight, Sparkles, Upload, Clock,
} from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

const LEVEL_STYLES: Record<string, { dot: string; badge: string; label: string }> = {
  Beginner:     { dot: "bg-green-400",  badge: "border-green-400/20 bg-green-400/5 text-green-400",   label: "Start here" },
  Intermediate: { dot: "bg-yellow-400", badge: "border-yellow-400/20 bg-yellow-400/5 text-yellow-400", label: "Build on basics" },
  Advanced:     { dot: "bg-volt",        badge: "border-volt/20 bg-volt/5 text-volt",                   label: "Go deep" },
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
    onSuccess: (fresh) => {
      qc.setQueryData(["learning-paths", wallet], fresh);
    },
  });

  return (
    <div className="min-h-screen gradient-mesh">
      <Navbar />
      <main className="pt-20 sm:pt-24 pb-16 px-4 sm:px-6 max-w-4xl mx-auto">

        {/* Header */}
        <div className="pt-4 mb-10">
          <span className="px-3 py-1 rounded-full border border-volt/20 bg-volt/5 text-xs font-mono text-volt">
            AI Curriculum
          </span>
          <h1 className="font-syne text-2xl sm:text-3xl font-800 text-white mt-3 leading-tight">
            Learning <span className="text-volt">Paths</span>
          </h1>
          <p className="text-white/40 font-dm text-sm mt-3 max-w-lg leading-relaxed">
            Claude analyses your entire library and builds ordered paths — so you
            know exactly what to watch, and in what order.
          </p>
        </div>

        {/* Not connected */}
        {!connected && (
          <div className="text-center py-16 space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-white/10 flex items-center justify-center mx-auto">
              <Wallet size={20} className="text-white/20" strokeWidth={1.5} />
            </div>
            <div>
              <p className="font-syne font-semibold text-white">Connect your wallet</p>
              <p className="text-white/30 text-sm font-dm mt-2 max-w-sm mx-auto leading-relaxed">
                Learning paths are built from your personal video library.
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {connected && isLoading && (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="glass-card rounded-2xl p-6 space-y-4">
                <div className="h-5 bg-dark-700 rounded shimmer w-1/3" />
                <div className="h-3 bg-dark-700 rounded shimmer w-2/3" />
                <div className="space-y-2 pt-2">
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="h-14 bg-dark-700 rounded-xl shimmer" />
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-center gap-2 pt-4 text-white/25">
              <Sparkles size={12} className="text-volt animate-pulse" />
              <span className="text-xs font-mono">Claude is designing your curriculum...</span>
            </div>
          </div>
        )}

        {/* Error */}
        {connected && isError && (
          <div className="max-w-md mx-auto py-12 text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
            <div>
              <p className="font-syne font-semibold text-white">Could not build learning paths</p>
              <p className="text-sm text-white/40 font-dm mt-2">{(error as Error)?.message}</p>
            </div>
          </div>
        )}

        {/* Not enough videos */}
        {connected && data && data.paths.length === 0 && (data.minRequired ?? 0) > 0 && (
          <div className="text-center py-16 space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-white/10 flex items-center justify-center mx-auto">
              <GraduationCap size={20} className="text-white/20" strokeWidth={1.5} />
            </div>
            <div>
              <p className="font-syne font-semibold text-white">Not enough videos yet</p>
              <p className="text-white/30 text-sm font-dm mt-2 max-w-sm mx-auto leading-relaxed">
                You have <span className="text-volt">{data.videoCount}</span> processed
                video{data.videoCount !== 1 ? "s" : ""}. Learning paths need at
                least <span className="text-volt">{data.minRequired}</span> so
                Claude has enough material to build a meaningful curriculum.
              </p>
            </div>
            <Link
              href="/upload"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-volt text-black font-syne font-semibold text-sm hover:bg-volt-dim transition-all"
            >
              <Upload size={14} /> Upload another video
            </Link>
          </div>
        )}

        {/* Paths */}
        {connected && data && data.paths.length > 0 && (
          <div className="space-y-6">
            {/* Meta row */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2 text-[11px] font-mono text-white/25">
                <Clock size={10} />
                Built from {data.videoCount} videos
                {data.cached && <span className="text-white/15">· cached</span>}
              </div>
              <button
                onClick={() => regen.mutate()}
                disabled={regen.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 border border-white/10 text-[11px] font-mono text-white/40 hover:text-white hover:border-white/20 transition-all disabled:opacity-50"
              >
                {regen.isPending
                  ? <><Loader2 size={10} className="animate-spin" /> Rebuilding...</>
                  : <><RefreshCw size={10} /> Rebuild paths</>}
              </button>
            </div>

            {data.paths.map((path, pi) => (
              <PathCard key={pi} path={path} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function PathCard({ path }: { path: LearningPath }) {
  const style = LEVEL_STYLES[path.level] ?? LEVEL_STYLES.Beginner;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Path header */}
      <div className="p-5 border-b border-white/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className={clsx("w-2 h-2 rounded-full", style.dot)} />
              <span className={clsx(
                "px-2 py-0.5 rounded-full border text-[10px] font-mono",
                style.badge
              )}>
                {path.level}
              </span>
              <span className="text-[10px] font-mono text-white/20">{style.label}</span>
            </div>
            <h2 className="font-syne font-800 text-white text-lg leading-tight">
              {path.title}
            </h2>
            <p className="text-sm text-white/40 font-dm mt-1.5 leading-relaxed">
              {path.description}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-syne font-800 text-volt text-2xl">{path.steps.length}</p>
            <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest">
              video{path.steps.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="p-3">
        {path.steps.map((step, i) => (
          <Link
            key={`${step.videoId}-${i}`}
            href={`/video/${step.videoId}`}
            className="group flex items-start gap-4 p-3 rounded-xl hover:bg-white/[0.03] transition-all"
          >
            {/* Step number + connector */}
            <div className="flex flex-col items-center shrink-0 pt-0.5">
              <div className="w-7 h-7 rounded-lg bg-dark-700 border border-white/10 group-hover:border-volt/30 group-hover:bg-volt/10 flex items-center justify-center transition-all">
                <span className="font-mono text-[11px] text-white/40 group-hover:text-volt transition-colors">
                  {i + 1}
                </span>
              </div>
              {i < path.steps.length - 1 && (
                <div className="w-px h-8 bg-gradient-to-b from-white/10 to-transparent mt-1" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-syne font-semibold text-white group-hover:text-volt transition-colors line-clamp-1">
                {step.title}
              </p>
              <p className="text-xs text-white/35 font-dm mt-1 leading-relaxed">
                {step.reason}
              </p>
            </div>

            <div className="shrink-0 w-7 h-7 rounded-lg bg-volt/10 border border-volt/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
              <Play size={11} className="text-volt ml-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
