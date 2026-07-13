"use client";
import { useState, useRef, useEffect } from "react";
import { Send, RefreshCw } from "lucide-react";
import { chatWithVideo } from "@/lib/api";
import { clsx } from "clsx";
import { readableTime } from "@/lib/exports";

interface Msg {
  role: "you" | "ai";
  text: string;
  sources?: Array<{ time: number; text: string }>;
  failed?: boolean;
}

const PROMPTS = [
  "Summarize this",
  "What are the key points?",
  "What did they get wrong?",
  "Find the most useful moment",
];

export function ChatPanel({ videoId, videoTitle }: { videoId: string; videoTitle: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ(""); setLast(question);
    setMsgs((m) => [...m, { role: "you", text: question }]);
    setBusy(true);
    try {
      const r = await chatWithVideo(videoId, question);
      setMsgs((m) => [...m, { role: "ai", text: r.answer, sources: r.sources }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "ai", text: e.message ?? "Something broke.", failed: true }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-3 h-10 border-b border-rule shrink-0">
        <span className="eyebrow">Ask the video</span>
        <span className="tc ml-auto">Claude</span>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        {msgs.length === 0 && (
          <div className="space-y-4 pt-4">
            <p className="text-[13px] font-sans text-dim leading-relaxed">
              Every answer comes with the timecode it came from.
            </p>
            <div className="space-y-px">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => ask(p)}
                  className="w-full text-left px-3 py-2.5 text-[13px] font-sans text-paper-2/70 border border-rule hover:border-rule-lit hover:text-paper hover:bg-slate transition-colors no-min"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className="space-y-2">
            <div className={clsx(
              "px-3 py-2.5",
              m.failed  ? "border-l-2 border-error bg-error/5"
              : m.role === "you" ? "bubble-you"
              : "bubble-ai"
            )}>
              <p className={clsx(
                "text-[13px] font-sans leading-[1.6]",
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

            {m.sources && m.sources.length > 0 && (
              <div className="space-y-px pl-2">
                {m.sources.map((s, j) => (
                  <div key={j} className="flex items-start gap-2.5 px-2 py-1.5 border-l border-rule">
                    <span className="tc tc-signal tabular-nums shrink-0">
                      {readableTime(s.time)}
                    </span>
                    <p className="text-[11px] font-sans text-dim leading-relaxed line-clamp-2">
                      {s.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 px-3 py-2.5 bubble-ai">
            <span className="dot dot-work" />
            <span className="tc">Reading the transcript</span>
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
            placeholder="Ask anything…"
            disabled={busy}
            className="flex-1 h-9 px-3 text-[13px] font-sans disabled:opacity-50"
          />
          <button
            onClick={() => ask(q)}
            disabled={!q.trim() || busy}
            className={clsx(
              "w-9 h-9 flex items-center justify-center transition-colors shrink-0 no-min",
              q.trim() && !busy
                ? "bg-signal text-void hover:bg-[#FF6449]"
                : "border border-rule text-dim-2 cursor-not-allowed"
            )}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
