"use client";
import { useState } from "react";
import {
  BookOpen, Zap, FileText, Twitter, AlignLeft,
  Tag, ChevronRight, Clock, Copy, CheckCircle,
} from "lucide-react";
import { clsx } from "clsx";
import type { VideoRecord } from "@/lib/api";

type Tab = "summary" | "chapters" | "highlights" | "blog" | "thread";

const TABS: Array<{ key: Tab; label: string; icon: React.ComponentType<any> }> = [
  { key: "summary",    label: "Summary",    icon: AlignLeft },
  { key: "chapters",  label: "Chapters",   icon: BookOpen },
  { key: "highlights",label: "Highlights", icon: Zap },
  { key: "blog",      label: "Blog Post",  icon: FileText },
  { key: "thread",    label: "X Thread",   icon: Twitter },
];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 border border-white/10 text-xs font-mono text-white/50 hover:text-white hover:border-white/20 transition-all"
    >
      {copied
        ? <><CheckCircle size={11} className="text-volt" /> Copied!</>
        : <><Copy size={11} /> {label}</>
      }
    </button>
  );
}

export function InsightsPanel({ video }: { video: VideoRecord }) {
  const [tab, setTab] = useState<Tab>("summary");
  const ai = video.ai;
  if (!ai) return null;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b border-white/[0.06] px-2 scrollbar-hide">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "flex items-center gap-2 px-4 py-3.5 text-xs font-mono whitespace-nowrap border-b-2 transition-all shrink-0",
              tab === key
                ? "border-volt text-volt"
                : "border-transparent text-white/30 hover:text-white/60"
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div className="p-5">

        {/* ── Summary ── */}
        {tab === "summary" && (
          <div className="space-y-4">
            <p className="text-sm text-white/70 font-dm leading-relaxed">
              {ai.summary ?? "No summary available."}
            </p>
            {ai.summary && (
              <CopyButton text={ai.summary} label="Copy summary" />
            )}
            {ai.tags && ai.tags.length > 0 && (
              <div className="flex items-start gap-2 pt-2 border-t border-white/[0.06]">
                <Tag size={12} className="text-white/30 mt-1 shrink-0" />
                <div className="flex flex-wrap gap-1.5">
                  {ai.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 rounded-lg bg-dark-700 border border-white/[0.06] text-xs font-mono text-white/40 hover:border-volt/20 hover:text-white/60 transition-all cursor-default"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Chapters ── */}
        {tab === "chapters" && (
          <div className="space-y-1">
            {(ai.chapters ?? []).length === 0 && (
              <p className="text-white/30 text-sm py-4 text-center">No chapters available.</p>
            )}
            {(ai.chapters ?? []).map((ch, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3.5 rounded-xl hover:bg-white/[0.03] transition-colors group cursor-default"
              >
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  <span className="font-mono text-xs text-white/20 w-5 text-right">{i + 1}</span>
                  <div className="w-px h-8 chapter-line" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-syne font-semibold text-white group-hover:text-volt transition-colors">
                      {ch.title}
                    </p>
                    <div className="flex items-center gap-1 text-[10px] font-mono text-volt/60">
                      <Clock size={9} />
                      {formatTime(ch.startSeconds)}
                    </div>
                  </div>
                  <p className="text-xs text-white/40 font-dm mt-1 leading-relaxed">{ch.summary}</p>
                </div>
                <ChevronRight size={14} className="text-white/10 group-hover:text-volt/40 transition-colors shrink-0 mt-1" />
              </div>
            ))}
          </div>
        )}

        {/* ── Highlights ── */}
        {tab === "highlights" && (
          <div className="space-y-3">
            {(ai.highlights ?? []).length === 0 && (
              <p className="text-white/30 text-sm py-4 text-center">No highlights available.</p>
            )}
            {(ai.highlights ?? []).map((hl, i) => (
              <div key={i} className="p-4 rounded-xl bg-volt/[0.04] border border-volt/10 space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Zap size={12} className="text-volt" />
                    <span className="text-xs font-mono text-volt">{hl.reason}</span>
                  </div>
                  <span className="text-[10px] font-mono text-white/30">
                    {formatTime(hl.startSeconds)} – {formatTime(hl.endSeconds)}
                  </span>
                </div>
                <p className="text-sm text-white/60 font-dm leading-relaxed italic">
                  "{hl.text}"
                </p>
                <CopyButton text={hl.text} label="Copy quote" />
              </div>
            ))}
          </div>
        )}

        {/* ── Blog Post ── */}
        {tab === "blog" && (
          <div className="space-y-4">
            {ai.blogPost ? (
              <>
                <div className="max-h-96 overflow-y-auto text-sm text-white/70 font-dm leading-relaxed whitespace-pre-wrap pr-1">
                  {ai.blogPost}
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                  <CopyButton text={ai.blogPost} label="Copy blog post" />
                  <span className="text-[10px] font-mono text-white/20">
                    ~{Math.ceil(ai.blogPost.split(" ").length / 200)} min read ·{" "}
                    {ai.blogPost.split(" ").length} words
                  </span>
                </div>
              </>
            ) : (
              <p className="text-white/30 text-sm py-4 text-center">Blog post not yet generated.</p>
            )}
          </div>
        )}

        {/* ── X Thread ── */}
        {tab === "thread" && (
          <div className="space-y-4">
            {ai.tweetThread ? (
              <>
                <div className="space-y-2">
                  {ai.tweetThread
                    .split(/\n(?=\d+\/)/)
                    .filter(Boolean)
                    .map((tweet, i) => (
                      <div
                        key={i}
                        className="group relative p-4 rounded-xl bg-dark-800 border border-white/[0.06] hover:border-white/10 transition-all"
                      >
                        <p className="text-sm text-white/70 font-dm leading-relaxed pr-8">
                          {tweet.trim()}
                        </p>
                        <button
                          onClick={() => navigator.clipboard.writeText(tweet.trim())}
                          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-white/30 hover:text-white"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    ))}
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                  <CopyButton text={ai.tweetThread} label="Copy full thread" />
                  <span className="text-[10px] font-mono text-white/20">
                    {ai.tweetThread.split(/\n(?=\d+\/)/).filter(Boolean).length} tweets
                  </span>
                </div>
              </>
            ) : (
              <p className="text-white/30 text-sm py-4 text-center">Thread not yet generated.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
