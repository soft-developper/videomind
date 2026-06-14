"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideos, deleteAllVideos, api } from "@/lib/api";
import { VideoCard } from "@/components/video/VideoCard";
import { SkeletonCard } from "@/components/ui/SkeletonCard";
import { Navbar } from "@/components/layout/Navbar";
import { ShelbyBadge } from "@/components/layout/ShelbyBadge";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  LayoutGrid, Zap, Brain, Upload, ArrowRight,
  AlertTriangle, RefreshCw, MessageSquare, Search,
  FileText, Sparkles, Info, Wallet, Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

function Counter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    if (target === 0) { setVal(0); return; }
    const start = performance.now();
    const duration = 1200;
    const tick = (now: number) => {
      const pct = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - pct, 3);
      setVal(Math.round(ease * target));
      if (pct < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target]);
  return <>{val}{suffix}</>;
}

const FEATURES = [
  { icon: FileText,      title: "AI Transcription",   desc: "Whisper AI extracts a full timestamped transcript from every uploaded video automatically." },
  { icon: Brain,         title: "Claude Analysis",    desc: "Claude generates chapters, highlights, summaries, blog posts and X threads from the transcript." },
  { icon: MessageSquare, title: "Ask the Video",      desc: "Chat with any video in natural language. Claude answers instantly with timestamp citations." },
  { icon: Search,        title: "Semantic Search",    desc: "Search across your entire library by meaning — not just keywords. Find any moment, instantly." },
  { icon: Zap,           title: "Shelby Storage",     desc: "Every video is stored on Shelby Protocol — decentralised, wallet-signed, on Aptos Testnet." },
  { icon: Sparkles,      title: "Content Generation", desc: "One video becomes a blog post, an X thread, and a newsletter. AI writes everything." },
];

export default function HomePage() {
  const { connected, account } = useWallet();
  const walletAddress = account?.address?.toString();
  const [showCleanup, setShowCleanup] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["videos", walletAddress],
    queryFn: () => getVideos(walletAddress),
    refetchInterval: 8000,
    retry: 2,
    enabled: !!walletAddress,
  });

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["shelby-stats", walletAddress],
    queryFn: async () => {
      const res = await api.get("/api/shelby/stats", {
        params: walletAddress ? { wallet: walletAddress } : {},
      });
      return res.data as {
        totalVideos: number; readyVideos: number;
        blobCount: number; processing: number;
      };
    },
    refetchInterval: 15_000,
    enabled: !!walletAddress,
  });

  const videos = data ?? [];

  const handleCleanup = async () => {
    if (!walletAddress) return;
    setCleaning(true);
    try {
      const res = await deleteAllVideos(walletAddress);
      setCleanMsg(res.message);
      refetch();
      refetchStats();
      setShowCleanup(false);
    } catch (err: any) {
      setCleanMsg(err.message);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="min-h-screen gradient-mesh">
      <Navbar />

      <main className="pt-20 sm:pt-24 pb-16 px-4 sm:px-6 max-w-7xl mx-auto">

        {/* Hero */}
        <div className="pt-6 mb-12 sm:mb-16">
          <div className="flex items-center gap-2 mb-5">
            <span className="px-3 py-1 rounded-full border border-volt/20 bg-volt/5 text-xs font-mono text-volt">
              Built on Shelby Protocol
            </span>
          </div>
          <h1 className="font-syne text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-800 text-white leading-[1.1] mb-5 max-w-3xl">
            Every video becomes a{" "}
            <span className="text-volt volt-text-glow">searchable knowledge base</span>
          </h1>
          <p className="text-white/40 font-dm text-base sm:text-lg max-w-xl leading-relaxed mb-8">
            Upload any video. AI generates transcript, chapters, highlights & answers.
            Everything stored on Shelby Protocol — decentralised, wallet-owned.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/upload" className="flex items-center gap-2 px-6 py-3 rounded-xl bg-volt text-black font-syne font-semibold text-sm hover:bg-volt-dim volt-glow transition-all">
              <Upload size={14} /> Upload Video <ArrowRight size={14} />
            </Link>
            <Link href="/search" className="flex items-center gap-2 px-6 py-3 rounded-xl bg-dark-700 border border-white/10 text-white font-syne font-semibold text-sm hover:border-white/20 transition-all">
              <Search size={14} /> Search Library
            </Link>
            <Link href="/about" className="flex items-center gap-2 px-6 py-3 rounded-xl border border-volt/20 bg-volt/5 text-volt font-syne font-semibold text-sm hover:bg-volt/10 transition-all">
              <Info size={14} /> About the Build
            </Link>
          </div>
        </div>

        {/* Live stats — only when connected */}
        {connected && walletAddress && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: "Videos",       value: stats?.totalVideos  ?? 0 },
                { label: "Shelby Blobs", value: stats?.blobCount    ?? 0 },
                { label: "AI Ready",     value: stats?.readyVideos  ?? 0 },
                { label: "Processing",   value: stats?.processing   ?? 0 },
              ].map(({ label, value }) => (
                <div key={label} className="glass-card rounded-2xl p-4 text-center">
                  <p className="font-syne font-800 text-2xl sm:text-3xl text-volt">
                    <Counter target={value} />
                  </p>
                  <p className="text-[11px] font-mono text-white/30 uppercase tracking-widest mt-1">{label}</p>
                </div>
              ))}
            </div>
            <div className="mb-8">
              <ShelbyBadge />
            </div>
          </>
        )}

        {/* Cleanup success message */}
        {cleanMsg && (
          <div className="mb-6 flex items-center gap-3 p-4 rounded-xl bg-volt/[0.06] border border-volt/20">
            <Zap size={14} className="text-volt shrink-0" />
            <p className="text-sm text-volt/80 font-dm">{cleanMsg}</p>
            <button onClick={() => setCleanMsg(null)} className="ml-auto text-volt/40 hover:text-volt text-xs font-mono">dismiss</button>
          </div>
        )}

        {/* Library header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-syne font-semibold text-white text-lg flex items-center gap-2">
            <LayoutGrid size={16} className="text-volt" />
            {connected ? "Your Library" : "Library"}
          </h2>
          {connected && videos.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowCleanup(true)}
                className="flex items-center gap-1.5 text-xs font-mono text-white/25 hover:text-red-400 transition-colors"
              >
                <Trash2 size={11} /> Clean up
              </button>
              <Link href="/upload" className="flex items-center gap-1.5 text-xs font-mono text-white/30 hover:text-volt transition-colors">
                <Upload size={11} /> Add video
              </Link>
            </div>
          )}
        </div>

        {/* Cleanup confirm dialog */}
        {showCleanup && (
          <div className="mb-6 p-5 glass-card rounded-2xl border border-red-500/20 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-syne font-semibold text-white">Delete all videos?</p>
                <p className="text-xs text-white/40 font-dm mt-1">
                  This will remove all {videos.length} video{videos.length !== 1 ? "s" : ""} from your library database.
                  The blobs on Shelby will remain until they expire naturally.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleCleanup}
                disabled={cleaning}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-syne font-semibold hover:bg-red-500/30 transition-all disabled:opacity-50"
              >
                <Trash2 size={12} /> {cleaning ? "Deleting..." : "Yes, delete all"}
              </button>
              <button
                onClick={() => setShowCleanup(false)}
                className="px-4 py-2 rounded-xl bg-dark-700 border border-white/10 text-white/50 text-xs font-syne font-semibold hover:border-white/20 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Wallet disconnected state ─────────────────────────────────── */}
        {!connected && (
          <div className="text-center py-16 sm:py-20 space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-dark-800 border border-white/10 flex items-center justify-center mx-auto">
              <Wallet size={24} className="text-white/20" strokeWidth={1} />
            </div>
            <div>
              <h3 className="font-syne font-semibold text-white text-lg mb-2">Connect your wallet</h3>
              <p className="text-white/30 text-sm font-dm max-w-sm mx-auto px-4 leading-relaxed">
                VideoMind is wallet-native. Connect your Aptos wallet to see your personal video library stored on Shelby Protocol.
              </p>
            </div>
            <p className="text-[11px] font-mono text-white/20">
              Use the Connect Wallet button in the top navigation
            </p>
          </div>
        )}

        {/* Loading */}
        {connected && isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Error */}
        {connected && isError && (
          <div className="max-w-md mx-auto py-12 text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
            <div>
              <p className="font-syne font-semibold text-white">Could not load library</p>
              <p className="text-sm text-white/40 font-dm mt-2 leading-relaxed">
                {(error as Error)?.message ?? "Unable to reach the VideoMind server."}
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-dark-700 border border-white/10 text-white/60 font-syne font-semibold text-sm hover:border-white/20 transition-all mx-auto"
            >
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        )}

        {/* Empty state (connected but no videos) */}
        {connected && !isLoading && !isError && videos.length === 0 && (
          <div className="text-center py-16 space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-dark-800 border border-white/10 flex items-center justify-center mx-auto">
              <LayoutGrid size={24} className="text-white/20" strokeWidth={1} />
            </div>
            <div>
              <h3 className="font-syne font-semibold text-white text-lg mb-2">No videos yet</h3>
              <p className="text-white/30 text-sm font-dm px-4">
                Upload your first video and let AI turn it into a knowledge base
              </p>
            </div>
            <Link href="/upload" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-volt text-black font-syne font-semibold text-sm hover:bg-volt-dim transition-all">
              <Upload size={14} /> Upload Video
            </Link>
          </div>
        )}

        {/* Video grid */}
        {connected && !isLoading && !isError && videos.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}

        {/* Feature showcase */}
        <div className="mt-20 sm:mt-24">
          <div className="flex items-center gap-3 mb-10">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-xs font-mono text-white/25 uppercase tracking-widest px-3">What VideoMind does</span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="glass-card-hover rounded-2xl p-5 space-y-3">
                <div className="w-10 h-10 rounded-xl bg-volt/10 border border-volt/20 flex items-center justify-center">
                  <Icon size={16} className="text-volt" />
                </div>
                <div>
                  <p className="font-syne font-semibold text-white text-sm">{title}</p>
                  <p className="text-xs text-white/40 font-dm mt-1.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Shelby CTA */}
        <div className="mt-16 p-6 sm:p-8 glass-card rounded-2xl border border-volt/10 bg-volt/[0.02] text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-volt/10 border border-volt/20 flex items-center justify-center mx-auto">
            <Zap size={20} className="text-volt" />
          </div>
          <div>
            <p className="font-syne font-800 text-white text-xl sm:text-2xl">Powered by Shelby Protocol</p>
            <p className="text-white/40 font-dm text-sm mt-2 max-w-lg mx-auto leading-relaxed">
              Every video blob is stored on Shelby Testnet, signed by your Aptos wallet.
              VideoMind uses <span className="text-white/60">@shelby-protocol/react</span> and{" "}
              <span className="text-white/60">useUploadBlobs</span> for wallet-native uploads.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link href="/about" className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-volt/20 bg-volt/5 text-volt font-syne font-semibold text-sm hover:bg-volt/10 transition-all">
              <Info size={13} /> See full integration details
            </Link>
            <a href="https://explorer.shelby.xyz/testnet" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-dark-700 border border-white/10 text-white/60 font-syne font-semibold text-sm hover:border-white/20 transition-all">
              Shelby Explorer ↗
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
