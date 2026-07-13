"use client";
import { useState, useRef, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { askLibrary, type LibraryAnswer } from "@/lib/api";
import { Navbar } from "@/components/layout/Navbar";
import {
  Sparkles, Send, Loader2, Bot, User, Wallet,
  Film, Clock, AlertTriangle, RefreshCw, Library,
} from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

interface Msg {
  role: "user" | "assistant";
  content: string;
  citations?: LibraryAnswer["citations"];
  error?: boolean;
}

const SUGGESTED = [
  "What are the main themes across my videos?",
  "Summarise everything I've learned so far",
  "What topics come up most often?",
  "Are there any contradictions between my videos?",
];

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AssistantPage() {
  const { connected, account } = useWallet();
  const wallet = account?.address?.toString();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastQ, setLastQ] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || loading || !wallet) return;

    setInput("");
    setLastQ(question);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      const res = await askLibrary(question, wallet);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.answer, citations: res.citations },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: err.message ?? "Something went wrong.", error: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    setMessages((prev) => prev.slice(0, -1));
    send(lastQ);
  };

  return (
    <div className="min-h-screen gradient-mesh">
      <Navbar />
      <main className="pt-20 sm:pt-24 pb-16 px-4 sm:px-6 max-w-3xl mx-auto">

        {/* Header */}
        <div className="pt-4 mb-8">
          <span className="px-3 py-1 rounded-full border border-volt/20 bg-volt/5 text-xs font-mono text-volt">
            Cross-Video Intelligence
          </span>
          <h1 className="font-syne text-2xl sm:text-3xl font-800 text-white mt-3 leading-tight">
            Library <span className="text-volt">Assistant</span>
          </h1>
          <p className="text-white/40 font-dm text-sm mt-3 max-w-lg leading-relaxed">
            Ask anything about your entire video library. Claude searches across
            every video and cites exactly where each answer comes from.
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
                The assistant answers from your personal video library.
              </p>
            </div>
          </div>
        )}

        {connected && (
          <div className="glass-card rounded-2xl flex flex-col h-[60vh] min-h-[420px] overflow-hidden">

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">
              {messages.length === 0 && (
                <div className="space-y-5">
                  <div className="text-center py-6">
                    <div className="w-12 h-12 rounded-2xl bg-volt/10 border border-volt/20 flex items-center justify-center mx-auto mb-4">
                      <Library size={20} className="text-volt" />
                    </div>
                    <p className="text-sm text-white/50 font-dm">
                      Ask across every video you've uploaded
                    </p>
                    <p className="text-xs text-white/25 font-mono mt-1">
                      Answers include citations with clickable timestamps
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-mono text-white/25 uppercase tracking-widest">
                      Try asking
                    </p>
                    {SUGGESTED.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="w-full text-left px-4 py-3 rounded-xl bg-dark-800/60 border border-white/[0.06] hover:border-volt/20 hover:bg-volt/[0.03] text-sm text-white/50 hover:text-white/80 transition-all font-dm"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={clsx("flex gap-3", msg.role === "user" && "flex-row-reverse")}>
                  <div className={clsx(
                    "w-7 h-7 rounded-lg shrink-0 flex items-center justify-center border",
                    msg.error       ? "bg-red-500/10 border-red-500/20"
                    : msg.role === "user" ? "bg-volt/10 border-volt/20"
                    : "bg-dark-700 border-white/10"
                  )}>
                    {msg.error
                      ? <AlertTriangle size={12} className="text-red-400" />
                      : msg.role === "user"
                      ? <User size={12} className="text-volt" />
                      : <Bot size={12} className="text-white/60" />}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className={clsx(
                      "rounded-xl px-4 py-3 text-sm font-dm leading-relaxed",
                      msg.error       ? "bg-red-500/10 border border-red-500/20 text-red-400 mr-8"
                      : msg.role === "user" ? "chat-bubble-user text-white ml-8"
                      : "chat-bubble-ai text-white/80 mr-8"
                    )}>
                      {msg.content}
                    </div>

                    {msg.error && i === messages.length - 1 && (
                      <button
                        onClick={retry}
                        className="flex items-center gap-1.5 text-xs text-red-400/60 hover:text-red-400 font-mono transition-colors"
                      >
                        <RefreshCw size={10} /> Retry
                      </button>
                    )}

                    {/* Citations */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="space-y-1.5 mr-8">
                        <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest">
                          Sources · {msg.citations.length}
                        </p>
                        {msg.citations.map((c, j) => (
                          <Link
                            key={j}
                            href={`/video/${c.videoId}`}
                            className="block p-3 rounded-xl bg-dark-800/60 border border-white/[0.06] hover:border-volt/20 hover:bg-volt/[0.03] transition-all group"
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <Film size={10} className="text-volt/50 shrink-0" />
                              <span className="text-[11px] font-syne font-semibold text-white/70 group-hover:text-volt transition-colors truncate">
                                {c.videoTitle}
                              </span>
                              <div className="flex items-center gap-1 ml-auto shrink-0">
                                <Clock size={9} className="text-volt" />
                                <span className="font-mono text-[10px] text-volt tabular-nums">
                                  {fmt(c.time)}
                                </span>
                              </div>
                            </div>
                            <p className="text-[11px] text-white/40 font-dm leading-relaxed line-clamp-2 pl-4">
                              "{c.quote}"
                            </p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-lg bg-dark-700 border border-white/10 flex items-center justify-center">
                    <Bot size={12} className="text-white/60" />
                  </div>
                  <div className="chat-bubble-ai rounded-xl px-4 py-3 flex items-center gap-2">
                    <Loader2 size={13} className="text-volt animate-spin" />
                    <span className="text-xs font-mono text-white/40">
                      Searching your library...
                    </span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-white/[0.06] shrink-0">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(input)}
                  placeholder="Ask across all your videos..."
                  disabled={loading}
                  className="flex-1 bg-dark-800 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 font-dm focus:outline-none focus:border-volt/30 transition-all disabled:opacity-50"
                />
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || loading}
                  className={clsx(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0",
                    input.trim() && !loading
                      ? "bg-volt text-black hover:bg-volt-dim"
                      : "bg-dark-700 text-white/20 cursor-not-allowed"
                  )}
                >
                  <Send size={14} />
                </button>
              </div>
              <p className="text-[10px] font-mono text-white/15 mt-2 text-center">
                Claude picks the most relevant videos, then answers from their transcripts
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
