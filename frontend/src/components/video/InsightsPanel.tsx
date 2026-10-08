"use client";
import { useState, useEffect } from "react";
import { Copy, Check, Play, Pencil } from "lucide-react";
import { clsx } from "clsx";
import type { VideoRecord } from "@/lib/api";
import { readableTime } from "@/lib/exports";
// vm_chapters
import { ChapterEditor } from "./ChapterEditor";

type Tab = "summary" | "cuts" | "found" | "blog" | "thread";

const TABS: Array<{ k: Tab; label: string }> = [
  { k: "summary", label: "Summary" },
  { k: "cuts",    label: "Chapters" },
  { k: "found",   label: "Key moments" },
  { k: "blog",    label: "Article" },
  { k: "thread",  label: "Social thread" },
];

function Copyable({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="flex items-center gap-1.5 h-7 px-2.5 btn-ghost text-[11px] no-min"
    >
      {done ? <Check size={10} className="text-marker" /> : <Copy size={10} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function InsightsPanel({
  video, onSeek, owner, currentTime = 0, duration, onChaptersSaved,
}: {
  video: VideoRecord;
  onSeek?: (s: number) => void;
  /** vm_chapters: the owner can edit the chapters */
  owner?: boolean;
  currentTime?: number;
  duration?: number;
  onChaptersSaved?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  // vm_chapters: what was just saved, shown until the page has fetched it back.
  const [justSaved, setJustSaved] = useState<NonNullable<VideoRecord["ai"]>["chapters"] | null>(null);
  useEffect(() => { setJustSaved(null); }, [video.ai?.chapters]);
  const ai = video.ai;
  if (!ai) return null;
  const canSeek = typeof onSeek === "function";

  return (
    <section className="panel">
      {/* Tabs */}
      <div className="flex border-b border-rule overflow-x-auto scrollbar-hide">
        {TABS.map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx(
              "px-4 h-11 text-[12px] font-sans whitespace-nowrap relative transition-colors shrink-0 no-min",
              tab === k ? "text-paper" : "text-dim hover:text-paper-2"
            )}
          >
            {label}
            {tab === k && <span className="absolute bottom-0 inset-x-0 h-[2px] bg-signal" />}
          </button>
        ))}
      </div>

      <div className="p-5">
        {/* Summary */}
        {tab === "summary" && (
          <div className="space-y-4">
            <p className="text-[14px] font-sans text-paper-2 leading-[1.65]">
              {ai.summary ?? "No summary."}
            </p>
            {ai.summary && <Copyable text={ai.summary} label="Copy" />}
            {ai.tags?.length ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-3 border-t border-rule">
                {ai.tags.map((t) => (
                  <span key={t} className="tc lowercase">{t}</span>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* vm_chapters: the owner's editor */}
        {tab === "cuts" && editing && (
          <ChapterEditor
            videoId={video.id}
            chapters={justSaved ?? ai.chapters ?? []}
            currentTime={currentTime}
            duration={duration}
            onDone={(done) => { setEditing(false); if (done) { setJustSaved(done); setSaved(true); onChaptersSaved?.(); setTimeout(() => setSaved(false), 2500); } }}
          />
        )}

        {/* Cuts */}
        {tab === "cuts" && !editing && (
          <div className="-mx-5 -my-5">
            {owner && (
              <div className="flex items-center gap-3 px-5 py-2.5 border-b border-rule">
                {saved && <span className="text-[12.5px] text-marker" role="status">Chapters saved</span>}
                <button onClick={() => setEditing(true)} className="ml-auto btn btn-ghost h-8 px-3 inline-flex items-center gap-1.5 text-[12.5px] no-min">
                  <Pencil size={12} /> Edit chapters
                </button>
              </div>
            )}
            {(justSaved ?? ai.chapters ?? []).length === 0 && (
              <p className="p-5 text-[13.5px] text-dim">No chapters were found in this video.</p>
            )}
            {(justSaved ?? ai.chapters ?? []).map((c, i) => (
              <button
                key={i}
                onClick={() => canSeek && onSeek!(c.startSeconds)}
                disabled={!canSeek}
                className="w-full flex items-start gap-4 px-5 py-3.5 text-left border-b border-rule last:border-0 hover:bg-slate transition-colors group no-min"
              >
                <span className="tc tabular-nums shrink-0 pt-0.5 group-hover:tc-signal transition-colors">
                  {readableTime(c.startSeconds)}
                </span>
                <span className="w-px self-stretch bg-rule group-hover:bg-signal transition-colors shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-display text-[16px] text-paper leading-tight group-hover:text-signal transition-colors">
                    {c.title}
                  </span>
                  <span className="block text-[12px] font-sans text-dim mt-1 leading-relaxed">
                    {c.summary}
                  </span>
                </span>
                {canSeek && (
                  <Play size={11} className="text-dim-2 group-hover:text-signal shrink-0 mt-1 transition-colors" fill="currentColor" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Key moments, in green. */}
        {tab === "found" && (
          <div className="space-y-3">
            {(ai.highlights ?? []).length === 0 && (
              <p className="text-[13.5px] text-dim py-4">No key moments were picked out.</p>
            )}
            {(ai.highlights ?? []).map((h, i) => (
              <article
                key={i}
                className="border-l-2 border-marker pl-4 py-1 space-y-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-mono text-marker uppercase tracking-wider">
                    {h.reason}
                  </span>
                  <span className="tc tabular-nums shrink-0">
                    {readableTime(h.startSeconds)}–{readableTime(h.endSeconds)}
                  </span>
                </div>
                <p className="text-[15px] font-medium text-paper leading-[1.45]">
                  “{h.text}”
                </p>
                <div className="flex gap-2 pt-1">
                  {canSeek && (
                    <button
                      onClick={() => onSeek!(h.startSeconds)}
                      className="flex items-center gap-1.5 h-7 px-2.5 btn-marker text-[11px] no-min"
                    >
                      <Play size={9} fill="currentColor" /> Jump
                    </button>
                  )}
                  <Copyable text={h.text} label="Copy quote" />
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Blog */}
        {tab === "blog" && (
          ai.blogPost ? (
            <div className="space-y-3">
              <div className="max-h-80 overflow-y-auto text-[14px] font-sans text-paper-2 leading-[1.7] whitespace-pre-wrap pr-2">
                {ai.blogPost}
              </div>
              <div className="flex items-center gap-3 pt-3 border-t border-rule">
                <Copyable text={ai.blogPost} label="Copy post" />
                <span className="tc">
                  {ai.blogPost.split(/\s+/).length} words
                </span>
              </div>
            </div>
          ) : <p className="text-[13.5px] text-dim py-4">This was not written for this video.</p>
        )}

        {/* Thread */}
        {tab === "thread" && (
          ai.tweetThread ? (
            <div className="space-y-3">
              <div className="space-y-px">
                {ai.tweetThread.split(/\n(?=\d+\/)/).filter(Boolean).map((t, i) => (
                  <div key={i} className="group relative bg-void border border-rule p-3">
                    <p className="text-[13px] font-sans text-paper-2 leading-[1.6] pr-6">
                      {t.trim()}
                    </p>
                    <button
                      onClick={() => navigator.clipboard.writeText(t.trim())}
                      className="absolute top-2.5 right-2.5 text-dim-2 hover:text-paper opacity-0 group-hover:opacity-100 transition-all no-min"
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Copyable text={ai.tweetThread} label="Copy thread" />
                <span className="tc">
                  {ai.tweetThread.split(/\n(?=\d+\/)/).filter(Boolean).length} posts
                </span>
              </div>
            </div>
          ) : <p className="text-[13.5px] text-dim py-4">This was not written for this video.</p>
        )}
      </div>
    </section>
  );
}
