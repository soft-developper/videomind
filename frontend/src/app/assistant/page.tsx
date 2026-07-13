"use client";
import { useState, useRef, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { askLibrary, type LibraryAnswer } from "@/lib/api";
import { Navbar } from "@/components/layout/Navbar";
import { Send, RefreshCw } from "lucide-react";
import { readableTime } from "@/lib/exports";
import Link from "next/link";
import { clsx } from "clsx";

interface Msg {
  role: "you" | "ai";
  text: string;
  cites?: LibraryAnswer["citations"];
  failed?: boolean;
}

const PROMPTS = [
  "What runs through everything I've uploaded?",
  "Summarise what I've learned",
  "Where do my videos disagree with each other?",
  "What comes up most often?",
];

export default function AssistantPage() {
  const { connected, account } = useWallet();
  const wallet = account?.address?.toString();

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy || !wallet) return;
    setQ(""); setLast(question);
    setMsgs((m) => [...m, { role: "you", text: question }]);
    setBusy(true);
    try {
      const r = await askLibrary(question, wallet);
      setMsgs((m) => [...m, { role: "ai", text: r.answer, cites: r.citations }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "ai", text: e.message ?? "Failed.", failed: true }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-void">
      <Navbar />
      <main className="pt-14">
        <div className="border-b border-rule">
          <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-10">
            <p className="eyebrow mb-4">Assistant</p>
            <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.05] text-paper max-w-lg">
              One question.
              <br />
              <span className="italic text-signal">Every video.</span>
            </h1>
            <p className="text-[14px] font-sans text-dim mt-4 max-w-md leading-relaxed">
              Claude picks the relevant videos, reads their transcripts, and answers
              with the timecode it came from.
            </p>
          </div>
        </div>

        <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-8">
          {!connected ? (
            <div className="py-20 text-center">
              <p className="font-display text-[24px] text-paper mb-3">Connect a wallet</p>
              <p className="text-[13px] font-sans text-dim">
                The assistant reads your library, and only yours.
              </p>
            </div>
          ) : (
            <div className="panel flex flex-col h-[62vh] min-h-[440px]">
              <div className="flex-1 overflow-y-auto p-4 space-y-5 min-h-0">
                {msgs.length === 0 && (
                  <div className="space-y-3 pt-6">
                    <p className="eyebrow">Try</p>
                    <div className="space-y-px">
                      {PROMPTS.map((p) => (
                        <button
                          key={p}
                          onClick={() => ask(p)}
                          className="w-full text-left px-3 py-2.5 border border-rule text-[13px] font-sans text-dim hover:text-paper hover:border-rule-lit hover:bg-slate transition-colors no-min"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {msgs.map((m, i) => (
                  <div key={i} className="space-y-2.5">
                    <div className={clsx(
                      "px-3.5 py-3",
                      m.failed  ? "border-l-2 border-error bg-error/5"
                      : m.role === "you" ? "bubble-you"
                      : "bubble-ai"
                    )}>
                      <p className={clsx(
                        "text-[14px] font-sans leading-[1.65]",
                        m.failed ? "text-error" : m.role === "you" ? "text-paper" : "text-paper-2"
                      )}>
                        {m.text}
                      </p>
                    </div>

                    {m.failed && i === msgs.length - 1 && (
                      <button
                        onClick={() => { setMsgs((x) => x.slice(0, -1)); ask(last); }}
                        className="flex items-center gap-1.5 tc hover:text-paper transition-colors no-min"
                      >
                        <RefreshCw size={9} /> Retry
                      </button>
                    )}

                    {m.cites && m.cites.length > 0 && (
                      <div className="space-y-px">
                        <p className="eyebrow mb-1.5">
                          {m.cites.length} source{m.cites.length !== 1 ? "s" : ""}
                        </p>
                        {m.cites.map((c, j) => (
                          <Link
                            key={j}
                            href={`/video/${c.videoId}`}
                            className="block px-3 py-2.5 border border-rule hover:border-rule-lit hover:bg-slate transition-colors group"
                          >
                            <div className="flex items-baseline justify-between gap-3 mb-1">
                              <span className="text-[12px] font-sans text-paper-2 group-hover:text-signal transition-colors truncate">
                                {c.videoTitle}
                              </span>
                              <span className="tc tc-signal tabular-nums shrink-0">
                                {readableTime(c.time)}
                              </span>
                            </div>
                            <p className="text-[12px] font-sans text-dim leading-relaxed line-clamp-2">
                              “{c.quote}”
                            </p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {busy && (
                  <div className="flex items-center gap-2.5 px-3.5 py-3 bubble-ai">
                    <span className="dot dot-work" />
                    <span className="tc">Reading the relevant transcripts</span>
                  </div>
                )}

                <div ref={end} />
              </div>

              <div className="p-3 border-t border-rule shrink-0">
                <div className="flex gap-px">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && ask(q)}
                    placeholder="Ask across everything…"
                    disabled={busy}
                    className="flex-1 h-10 px-3 text-[14px] font-sans disabled:opacity-50"
                  />
                  <button
                    onClick={() => ask(q)}
                    disabled={!q.trim() || busy}
                    className={clsx(
                      "w-10 h-10 flex items-center justify-center transition-colors shrink-0 no-min",
                      q.trim() && !busy
                        ? "bg-signal text-void hover:bg-[#FF6449]"
                        : "border border-rule text-dim-2 cursor-not-allowed"
                    )}
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
