"use client";
import { useState, useEffect } from "react";
import { Copy, Check, Play, Pencil } from "lucide-react";
import { clsx } from "clsx";
import type { VideoRecord } from "@/lib/api";
import { readableTime } from "@/lib/exports";
// vm_chapters
import { ChapterEditor } from "./ChapterEditor";
// vm_lang
import { useTranslations } from "next-intl";

type Tab = "summary" | "cuts" | "found" | "blog" | "thread";

const TABS: Tab[] = ["summary", "cuts", "found", "blog", "thread"];

function Copyable({ text, label }: { text: string; label: string }) {
  const ti = useTranslations("insights");
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
      {done ? ti("copied") : label}
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
  const ti = useTranslations("insights");
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
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx(
              "px-4 h-11 text-[12px] font-sans whitespace-nowrap relative transition-colors shrink-0 no-min",
              tab === k ? "text-paper" : "text-dim hover:text-paper-2"
            )}
          >
            {ti(`tab.${k}`)}
            {tab === k && <span className="absolute bottom-0 inset-x-0 h-[2px] bg-signal" />}
          </button>
        ))}
      </div>

      <div className="p-5">
        {/* Summary */}
        {tab === "summary" && (
          <div className="space-y-4">
            <p dir="auto" className="text-[14px] font-sans text-paper-2 leading-[1.65]">
              {ai.summary ?? ti("noSummary")}
            </p>
            {ai.summary && <Copyable text={ai.summary} label={ti("copy")} />}
            {ai.tags?.length ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-3 border-t border-rule">
                {ai.tags.map((t) => (
                  <span key={t} dir="auto" className="tc lowercase">{t}</span>
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
                {saved && <span className="text-[12.5px] text-marker" role="status">{ti("saved")}</span>}
                <button onClick={() => setEditing(true)} className="ms-auto btn btn-ghost h-8 px-3 inline-flex items-center gap-1.5 text-[12.5px] no-min">
                  <Pencil size={12} /> {ti("edit")}
                </button>
              </div>
            )}
            {(justSaved ?? ai.chapters ?? []).length === 0 && (
              <p className="p-5 text-[13.5px] text-dim">{ti("noChapters")}</p>
            )}
            {(justSaved ?? ai.chapters ?? []).map((c, i) => (
              <button
                key={i}
                onClick={() => canSeek && onSeek!(c.startSeconds)}
                disabled={!canSeek}
                className="w-full flex items-start gap-4 px-5 py-3.5 text-start border-b border-rule last:border-0 hover:bg-slate transition-colors group no-min"
              >
                <span className="tc tabular-nums shrink-0 pt-0.5 group-hover:tc-signal transition-colors">
                  {readableTime(c.startSeconds)}
                </span>
                <span className="w-px self-stretch bg-rule group-hover:bg-signal transition-colors shrink-0" />
                <span className="flex-1 min-w-0">
                  <span dir="auto" className="block font-display text-[16px] text-paper leading-tight group-hover:text-signal transition-colors">
                    {c.title}
                  </span>
                  <span dir="auto" className="block text-[12px] font-sans text-dim mt-1 leading-relaxed">
                    {c.summary}
                  </span>
                </span>
                {canSeek && (
                  <Play size={11} className="text-dim-2 group-hover:text-signal shrink-0 mt-1 transition-colors rtl:rotate-180" fill="currentColor" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Key moments, in green. */}
        {tab === "found" && (
          <div className="space-y-3">
            {(ai.highlights ?? []).length === 0 && (
              <p className="text-[13.5px] text-dim py-4">{ti("noMoments")}</p>
            )}
            {(ai.highlights ?? []).map((h, i) => (
              <article
                key={i}
                className="border-s-2 border-marker ps-4 py-1 space-y-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span dir="auto" className="text-[11px] font-mono text-marker uppercase tracking-wider">
                    {h.reason}
                  </span>
                  <span dir="ltr" className="tc tabular-nums shrink-0">
                    {readableTime(h.startSeconds)}–{readableTime(h.endSeconds)}
                  </span>
                </div>
                <p dir="auto" className="text-[15px] font-medium text-paper leading-[1.45]">
                  “{h.text}”
                </p>
                <div className="flex gap-2 pt-1">
                  {canSeek && (
                    <button
                      onClick={() => onSeek!(h.startSeconds)}
                      className="flex items-center gap-1.5 h-7 px-2.5 btn-marker text-[11px] no-min"
                    >
                      <Play size={9} fill="currentColor" /> {ti("jump")}
                    </button>
                  )}
                  <Copyable text={h.text} label={ti("copyQuote")} />
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Blog */}
        {tab === "blog" && (
          ai.blogPost ? (
            <div className="space-y-3">
              <div dir="auto" className="max-h-80 overflow-y-auto text-[14px] font-sans text-paper-2 leading-[1.7] whitespace-pre-wrap pe-2">
                {ai.blogPost}
              </div>
              <div className="flex items-center gap-3 pt-3 border-t border-rule">
                <Copyable text={ai.blogPost} label={ti("copyPost")} />
                <span className="tc">
                  {ti("words", { count: ai.blogPost.split(/\s+/).length })}
                </span>
              </div>
            </div>
          ) : <p className="text-[13.5px] text-dim py-4">{ti("notWritten")}</p>
        )}

        {/* Thread */}
        {tab === "thread" && (
          ai.tweetThread ? (
            <div className="space-y-3">
              <div className="space-y-px">
                {ai.tweetThread.split(/\n(?=\d+\/)/).filter(Boolean).map((t, i) => (
                  <div key={i} className="group relative bg-void border border-rule p-3">
                    <p dir="auto" className="text-[13px] font-sans text-paper-2 leading-[1.6] pe-6">
                      {t.trim()}
                    </p>
                    <button
                      onClick={() => navigator.clipboard.writeText(t.trim())}
                      aria-label={ti("copy")}
                      className="absolute top-2.5 end-2.5 text-dim-2 hover:text-paper opacity-0 group-hover:opacity-100 transition-all no-min"
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Copyable text={ai.tweetThread} label={ti("copyThread")} />
                <span className="tc">
                  {ti("posts", { count: ai.tweetThread.split(/\n(?=\d+\/)/).filter(Boolean).length })}
                </span>
              </div>
            </div>
          ) : <p className="text-[13.5px] text-dim py-4">{ti("notWritten")}</p>
        )}
      </div>
    </section>
  );
}
