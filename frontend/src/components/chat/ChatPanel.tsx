"use client";
import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Clock, Loader2, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";
import { chatWithVideo } from "@/lib/api";
import { clsx } from "clsx";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ time: number; text: string }>;
  error?: boolean;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SUGGESTED = [
  "Give me a summary of this video",
  "What are the key takeaways?",
  "What topics are covered?",
  "Find the most important moment",
];

export function ChatPanel({ videoId, videoTitle }: { videoId: string; videoTitle: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setInput("");
    setLastQuestion(q);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    try {
      const res = await chatWithVideo(videoId, q);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.answer, sources: res.sources },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: err.message ?? "Failed to get a response. Please try again.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    // Remove last error message then resend
    setMessages((prev) => prev.slice(0, -1));
    send(lastQuestion);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/[0.06] shrink-0">
        <div className="w-8 h-8 rounded-lg bg-volt/10 border border-volt/20 flex items-center justify-center">
          <Sparkles size={14} className="text-volt" />
        </div>
        <div>
          <p className="text-sm font-syne font-semibold text-white">Ask the Video</p>
          <p className="text-xs text-white/30 font-mono">Powered by Claude</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="text-center py-6">
              <Bot size={32} className="text-white/20 mx-auto mb-3" strokeWidth={1} />
              <p className="text-sm text-white/40 font-dm">
                Ask anything about{" "}
                <span className="text-white/60">"{videoTitle}"</span>
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-mono text-white/25 uppercase tracking-widest">Suggested</p>
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full text-left px-3 py-2.5 rounded-lg bg-dark-700/60 border border-white/[0.06] hover:border-volt/20 hover:bg-volt/[0.04] text-xs text-white/50 hover:text-white/80 transition-all font-dm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={clsx("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
          >
            <div className={clsx(
              "w-7 h-7 rounded-lg shrink-0 flex items-center justify-center border",
              msg.error
                ? "bg-red-500/10 border-red-500/20"
                : msg.role === "user"
                ? "bg-volt/10 border-volt/20"
                : "bg-dark-700 border-white/10"
            )}>
              {msg.error
                ? <AlertTriangle size={12} className="text-red-400" />
                : msg.role === "user"
                ? <User size={12} className="text-volt" />
                : <Bot size={12} className="text-white/60" />
              }
            </div>

            <div className={clsx(
              "flex-1 min-w-0 space-y-2",
              msg.role === "user" ? "items-end" : "items-start"
            )}>
              <div className={clsx(
                "rounded-xl px-3.5 py-2.5 text-sm font-dm leading-relaxed",
                msg.error
                  ? "bg-red-500/10 border border-red-500/20 text-red-400 mr-8"
                  : msg.role === "user"
                  ? "chat-bubble-user text-white ml-8"
                  : "chat-bubble-ai text-white/80 mr-8"
              )}>
                {msg.content}
              </div>

              {/* Retry button on error */}
              {msg.error && i === messages.length - 1 && (
                <button
                  onClick={retry}
                  className="flex items-center gap-1.5 ml-0 text-xs text-red-400/60 hover:text-red-400 font-mono transition-colors"
                >
                  <RefreshCw size={10} /> Retry
                </button>
              )}

              {/* Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="space-y-1 mr-8">
                  <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest">Sources</p>
                  {msg.sources.map((src, j) => (
                    <div
                      key={j}
                      className="flex items-start gap-2 px-3 py-2 rounded-lg bg-dark-800/60 border border-white/[0.06]"
                    >
                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                        <Clock size={10} className="text-volt" />
                        <span className="font-mono text-[10px] text-volt">{formatTime(src.time)}</span>
                      </div>
                      <p className="text-[11px] text-white/40 line-clamp-2 font-dm">{src.text}</p>
                    </div>
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
            <div className="chat-bubble-ai rounded-xl px-3.5 py-2.5">
              <Loader2 size={14} className="text-white/40 animate-spin" />
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
            placeholder="Ask anything..."
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
      </div>
    </div>
  );
}
