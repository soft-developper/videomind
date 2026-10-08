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
  "What questions does this leave open?",
  "Find the most useful moment",
];

export function ChatPanel({ videoId, videoTitle, onSeek }: {
  videoId: string; videoTitle: string;
  /** vm_workspace: a source in an answer plays the video from that moment */
  onSeek?: (seconds: number) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // vm_shell: keep the newest message in view by scrolling this list only,
  // never the page, and only once there is a message.
  // vm_workspace: and only when the reader is already at the bottom. Someone
  // reading an earlier answer is not moved; a button takes them down.
  const atBottom = useRef(true);
  // True while the list scrolls itself down. Its own scroll events then say
  // nothing about where the reader is.
  const gliding = useRef(false);
  const [unseen, setUnseen] = useState(false);
  const toBottom = () => {
    const box = end.current?.parentElement;
    if (box) { gliding.current = true; box.scrollTo({ top: box.scrollHeight, behavior: "smooth" }); }
    atBottom.current = true;
    setUnseen(false);
  };
  useEffect(() => {
    if (!msgs.length) return;
    if (atBottom.current) toBottom(); else setUnseen(true);
  }, [msgs]);
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const b = e.currentTarget;
    const bottom = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
    if (gliding.current) { if (bottom) gliding.current = false; return; }
    atBottom.current = bottom;
    if (bottom) setUnseen(false);
  };
  // Wheel, touch and keys come only from a person: they end a glide.
  const byHand = () => { gliding.current = false; };

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setQ(""); setLast(question);
    atBottom.current = true;   // the person just asked: show them their question and the answer
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
      <header className="flex items-center px-4 h-12 border-b border-rule shrink-0">
        <h2 className="text-[14px] font-semibold text-paper">Ask about this video</h2>
      </header>

      <div className="relative flex-1 min-h-0 flex flex-col">
      <div onScroll={onListScroll} onWheel={byHand} onTouchMove={byHand} onKeyDown={byHand} className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        {msgs.length === 0 && (
          <div className="space-y-4 pt-4">
            <p className="text-[13.5px] font-sans text-dim leading-relaxed">
              Answers point to the moments in the video they came from.
            </p>
            <div className="space-y-2">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => ask(p)}
                  className="w-full text-left px-3 py-2 rounded-md text-[13.5px] font-sans text-paper-2 border border-rule hover:border-rule-lit hover:text-paper hover:bg-slate-2 transition-colors no-min"
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
                  <button
                    key={j}
                    onClick={() => onSeek?.(s.time)}
                    disabled={!onSeek}
                    aria-label={`Play from ${readableTime(s.time)}: ${s.text}`}
                    className="w-full flex items-start gap-2.5 px-2 py-1.5 border-l border-rule text-left hover:border-signal hover:bg-slate-2 transition-colors no-min group/src disabled:hover:bg-transparent"
                  >
                    <span className="tc tc-signal tabular-nums shrink-0">
                      {readableTime(s.time)}
                    </span>
                    <span className="text-[11px] font-sans text-dim leading-relaxed line-clamp-2 group-hover/src:text-paper-2">
                      {s.text}
                    </span>
                  </button>
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
      {unseen && (
        <button onClick={toBottom} className="absolute bottom-2 left-1/2 -translate-x-1/2 h-8 px-3 rounded-full btn btn-ghost bg-slate-2 text-[12.5px] no-min">
          New answer below
        </button>
      )}
      </div>

      <div className="p-3 border-t border-rule shrink-0">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && ask(q)}
            placeholder="Ask a question"
            disabled={busy}
            className="flex-1 h-9 px-3 text-[13px] font-sans disabled:opacity-50"
          />
          <button
            onClick={() => ask(q)}
            disabled={!q.trim() || busy}
            className={clsx(
              "w-9 h-9 rounded flex items-center justify-center transition-colors shrink-0 no-min",
              q.trim() && !busy
                ? "bg-paper text-void hover:bg-white"
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
