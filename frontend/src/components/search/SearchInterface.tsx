"use client";
import { useState } from "react";
import { Search, RefreshCw, X } from "lucide-react";
import { searchAllVideos } from "@/lib/api";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { readableTime } from "@/lib/exports";
import Link from "next/link";

const EXAMPLES = [
  "What did they say about expiration?",
  "Explain how blobs get renewed",
  "The part about wallet signing",
  "Anything on decentralised storage",
];

export function SearchInterface() {
  const { connected, account } = useWallet();
  const wallet = account?.address?.toString();

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState("");

  const run = async (text: string) => {
    const query = text.trim();
    if (!query) return;
    setQ(query); setLast(query); setBusy(true); setHits(null); setErr(null);
    try {
      const d = await searchAllVideos(query, wallet);
      setHits(d.results);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (!connected) {
    return (
      <div className="py-20 text-center">
        <p className="font-display text-[24px] text-paper mb-3">
          Connect a wallet to search
        </p>
        <p className="text-[13px] font-sans text-dim">
          Search runs across your library only.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Query bar */}
      <div className="flex items-center border border-rule focus-within:border-rule-lit transition-colors">
        <span className="pl-3 shrink-0">
          {busy ? <span className="dot dot-work" /> : <Search size={14} className="text-dim" />}
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(q)}
          placeholder="Describe what you're looking for…"
          disabled={busy}
          className="flex-1 h-12 px-3 text-[15px] font-sans bg-transparent border-0 focus:border-0"
        />
        <button
          onClick={() => run(q)}
          disabled={busy || !q.trim()}
          className="h-12 px-5 bg-signal text-void text-[13px] font-sans font-medium hover:bg-[#FF6449] transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0 no-min"
        >
          Search
        </button>
      </div>

      {/* Idle */}
      {hits === null && !busy && !err && (
        <div>
          <p className="eyebrow mb-3">Try</p>
          <div className="grid sm:grid-cols-2 gap-px">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => run(e)}
                className="text-left px-4 py-3 border border-rule text-[13px] font-sans text-dim hover:text-paper hover:border-rule-lit hover:bg-slate transition-colors no-min"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {err && (
        <div className="border border-error/40 bg-error/5 p-3 flex items-start gap-3">
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
            <p className="eyebrow">
              {hits.length === 0 ? "No match" : `${hits.length} video${hits.length !== 1 ? "s" : ""}`}
            </p>
            <button
              onClick={() => { setHits(null); setQ(""); }}
              className="tc hover:text-paper transition-colors no-min flex items-center gap-1"
            >
              <X size={10} /> Clear
            </button>
          </div>

          {hits.length === 0 && (
            <p className="py-16 text-center text-[13px] font-sans text-dim">
              Nothing in your library matches that. Try different words.
            </p>
          )}

          {hits.map((r) => (
            <Link key={r.videoId} href={`/video/${r.videoId}`} className="block panel-hover group">
              <header className="flex items-baseline justify-between gap-4 px-4 py-3 border-b border-rule">
                <h3 className="font-display text-[19px] text-paper group-hover:text-signal transition-colors truncate">
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
                    <p className="text-[13px] font-sans text-paper-2/70 leading-relaxed line-clamp-2">
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
