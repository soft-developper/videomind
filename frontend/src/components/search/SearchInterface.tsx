"use client";
import { useState } from "react";
import { Search, Loader2, Film, Clock, Zap, AlertTriangle, RefreshCw, SearchX, Wallet } from "lucide-react";
import { searchAllVideos } from "@/lib/api";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import Link from "next/link";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const EXAMPLES = [
  "What did they say about Shelby architecture?",
  "Explain blob expiration and renewal",
  "Key insights on decentralized storage",
  "How to integrate the SDK",
];

export function SearchInterface() {
  const { connected, account } = useWallet();
  const walletAddress = account?.address?.toString();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  const doSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLastQuery(trimmed);
    setLoading(true);
    setResults(null);
    setError(null);

    try {
      const data = await searchAllVideos(trimmed, walletAddress);
      setResults(data.results);
    } catch (err: any) {
      setError(err.message ?? "Search failed. Please try again.");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const retry = () => doSearch(lastQuery);

  // Wallet not connected
  if (!connected) {
    return (
      <div className="text-center py-16 space-y-5">
        <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-white/10 flex items-center justify-center mx-auto">
          <Wallet size={20} className="text-white/20" strokeWidth={1} />
        </div>
        <div>
          <p className="font-syne font-semibold text-white">Connect your wallet to search</p>
          <p className="text-white/30 text-sm font-dm mt-2 max-w-sm mx-auto leading-relaxed">
            Search is scoped to your wallet's video library. Connect your Aptos wallet to get started.
          </p>
        </div>
        <p className="text-[11px] font-mono text-white/20">
          Use the Connect Wallet button in the top navigation
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Search bar */}
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2">
          {loading
            ? <Loader2 size={18} className="text-volt animate-spin" />
            : <Search size={18} className="text-white/30" />
          }
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch(query)}
          placeholder="Search across your videos by meaning, not keywords..."
          disabled={loading}
          className="w-full bg-dark-800 border border-white/10 rounded-2xl pl-12 pr-32 py-4 text-white placeholder-white/20 font-dm text-sm focus:outline-none focus:border-volt/30 focus:bg-dark-700 transition-all disabled:opacity-60"
        />
        <button
          onClick={() => doSearch(query)}
          disabled={loading || !query.trim()}
          className="absolute right-3 top-1/2 -translate-y-1/2 px-5 py-2 rounded-xl bg-volt text-black text-xs font-syne font-semibold hover:bg-volt-dim disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          Search
        </button>
      </div>

      {/* Wallet scope indicator */}
      <div className="flex items-center gap-2 text-[11px] font-mono text-white/20">
        <Zap size={10} className="text-volt/40" />
        Searching videos for {walletAddress?.slice(0, 8)}...{walletAddress?.slice(-6)}
      </div>

      {/* Example queries */}
      {results === null && !loading && !error && (
        <div className="space-y-3">
          <p className="text-xs font-mono text-white/25 uppercase tracking-widest">Example queries</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => doSearch(ex)}
                className="text-left px-4 py-3 rounded-xl bg-dark-800/60 border border-white/[0.06] hover:border-volt/20 hover:bg-volt/[0.03] text-sm text-white/40 hover:text-white/70 transition-all font-dm"
              >
                <span className="text-volt mr-2">"</span>
                {ex}
                <span className="text-volt ml-1">"</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 overflow-hidden">
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-syne font-semibold text-red-400">Search failed</p>
              <p className="text-xs text-red-400/70 font-dm mt-1 leading-relaxed">{error}</p>
            </div>
          </div>
          <div className="border-t border-red-500/20 px-4 py-2.5">
            <button
              onClick={retry}
              className="flex items-center gap-1.5 text-xs text-red-400/60 hover:text-red-400 transition-colors font-mono"
            >
              <RefreshCw size={11} /> Try again
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {results !== null && !loading && !error && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-volt" />
              <p className="text-sm font-syne text-white">
                {results.length === 0
                  ? "No results found"
                  : `${results.length} video${results.length !== 1 ? "s" : ""} matched`}
              </p>
            </div>
            <button
              onClick={() => { setResults(null); setQuery(""); setLastQuery(""); }}
              className="text-xs font-mono text-white/25 hover:text-white/50 transition-colors"
            >
              Clear
            </button>
          </div>

          {/* Empty state */}
          {results.length === 0 && (
            <div className="text-center py-16 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-white/[0.06] flex items-center justify-center mx-auto">
                <SearchX size={20} className="text-white/20" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-white/40 font-dm text-sm">No videos matched your query</p>
                <p className="text-white/20 font-mono text-xs mt-1">
                  Try different keywords or upload more videos
                </p>
              </div>
              <button
                onClick={() => { setResults(null); setQuery(""); }}
                className="text-xs font-mono text-volt/60 hover:text-volt transition-colors"
              >
                ← Back to examples
              </button>
            </div>
          )}

          {/* Result cards */}
          {results.map((result) => (
            <Link
              key={result.videoId}
              href={`/video/${result.videoId}`}
              className="block glass-card-hover rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-dark-700 border border-white/10 flex items-center justify-center shrink-0">
                  <Film size={16} className="text-white/30" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-white text-sm truncate">{result.title}</p>
                  <p className="text-xs font-mono text-white/30">
                    {result.matches.length} match{result.matches.length !== 1 ? "es" : ""}
                  </p>
                </div>
                <Zap size={12} className="text-volt/40 shrink-0" />
              </div>

              <div className="space-y-2">
                {result.matches.map((match: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-dark-800/60 border border-white/[0.06]">
                    <div className="flex items-center gap-1 shrink-0 mt-0.5">
                      <Clock size={10} className="text-volt" />
                      <span className="text-[10px] font-mono text-volt">{formatTime(match.time)}</span>
                    </div>
                    <p className="text-xs text-white/50 font-dm leading-relaxed line-clamp-2">{match.text}</p>
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
