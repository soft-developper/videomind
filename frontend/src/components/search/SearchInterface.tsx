"use client";
import { useState } from "react";
import { Search, RefreshCw, X } from "lucide-react";
import { searchAllVideos } from "@/lib/api";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { readableTime } from "@/lib/exports";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";

export function SearchInterface() {
  const { connected } = useWallet();
  // vm_signin: search runs only once the wallet has signed in
  const wallet = useSessionWallet();

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState("");

  const run = async (text: string) => {
    const query = text.trim();
    if (!query) return;
    if (!wallet) { setErr("Sign in with your wallet first. The prompt is at the bottom of the page."); return; }
    setQ(query); setLast(query); setBusy(true); setHits(null); setErr(null);
    try {
      const d = await searchAllVideos(query, wallet);
      setHits(d.results);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (!connected) {
    return (
      <EmptyState title="Connect a wallet to search" action={<WalletButton />}>
        Search looks through your own library, so it needs to know which library is yours.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      {/* Query bar */}
      <div className="flex items-center rounded-md border border-rule bg-side focus-within:border-dim transition-colors overflow-hidden">
        <span className="pl-3 shrink-0">
          {busy ? <span className="dot dot-work" /> : <Search size={14} className="text-dim" />}
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(q)}
          placeholder="Describe what you are looking for"
          disabled={busy}
          className="flex-1 h-12 px-3 text-[15px] font-sans bg-transparent border-0 rounded-none focus:border-0"
        />
        <button
          onClick={() => run(q)}
          disabled={busy || !q.trim()}
          className="h-9 mr-1.5 px-4 rounded bg-paper text-void text-[13.5px] font-sans font-medium hover:bg-white transition-colors disabled:bg-rule disabled:text-dim disabled:cursor-not-allowed shrink-0 no-min"
        >
          Search
        </button>
      </div>

      {/* Idle */}
      {hits === null && !busy && !err && (
        <p className="text-[13.5px] text-dim leading-relaxed max-w-[60ch]">
          Describe it the way you remember it, in your own words. For example: the part where
          the trade off between consistency and availability is explained.
        </p>
      )}

      {/* Error */}
      {err && (
        <div role="alert" className="rounded-md border border-error/50 bg-error/5 p-3.5 flex items-start gap-3">
          <p className="text-[13px] font-sans text-error flex-1">{err}</p>
          <button onClick={() => run(last)} className="tc text-error/70 hover:text-error no-min">
            <RefreshCw size={11} />
          </button>
        </div>
      )}

      {/* Results */}
      {hits !== null && !busy && !err && (
        <div className="space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-rule">
            <p className="text-[13.5px] text-paper-2">
              {hits.length === 0 ? "Nothing found" : `Found in ${hits.length} video${hits.length !== 1 ? "s" : ""}`}
            </p>
            <button
              onClick={() => { setHits(null); setQ(""); }}
              className="tc hover:text-paper transition-colors no-min flex items-center gap-1"
            >
              <X size={10} /> Clear
            </button>
          </div>

          {hits.length === 0 && (
            <p className="py-6 text-[14px] font-sans text-dim">
              Nothing in your library matches that. Try describing it in different words.
            </p>
          )}

          {hits.map((r) => (
            <Link key={r.videoId} href={`/video/${r.videoId}`} className="block panel-hover group">
              <header className="flex items-baseline justify-between gap-4 px-4 py-3 border-b border-rule">
                <h3 className="text-[15px] font-semibold text-paper truncate">
                  {r.title}
                </h3>
                <span className="tc shrink-0">
                  {r.matches.length} moment{r.matches.length !== 1 ? "s" : ""}
                </span>
              </header>

              <div>
                {r.matches.map((m: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5 border-b border-rule last:border-0">
                    <span className="tc tc-signal tabular-nums shrink-0 pt-0.5">
                      {readableTime(m.time)}
                    </span>
                    <p className="text-[13.5px] font-sans text-paper-2 leading-relaxed line-clamp-2">
                      {m.text}
                    </p>
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
