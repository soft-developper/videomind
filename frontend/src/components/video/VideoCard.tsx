"use client";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { api } from "@/lib/api";
import type { VideoRecord } from "@/lib/api";

// vm_shell: the card shows what is known about the video instead of a
// thumbnail it does not have yet: its first chapters as a small table of
// contents, and under it a ruler cut at the chapter boundaries. Once
// thumbnails exist they take the place of the table of contents.

/** The grid every list of video cards uses. */
export const VIDEO_GRID = "grid gap-x-5 gap-y-9 grid-cols-[repeat(auto-fill,minmax(248px,1fr))]";

const WORKING: Record<string, string> = {
  uploading:    "Upload not finished",
  processing:   "Processing",
  transcribing: "Transcribing",
  analyzing:    "Finding chapters",
};

export function clock(sec?: number | null): string | null {
  if (sec == null || !isFinite(sec) || sec < 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function length(sec?: number): string | null {
  if (!sec || !isFinite(sec)) return null;
  const min = Math.round(sec / 60);
  if (min < 1) return "Under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function when(ms: number): string {
  const d = Date.now() - ms;
  const min = Math.floor(d / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(ms));
}

/** One segment per chapter, as wide as the chapter is long. */
function ChapterRuler({ starts, duration }: { starts: number[]; duration?: number }) {
  const parts = useMemo(() => {
    if (!duration || !isFinite(duration) || starts.length === 0) return [];
    const s = [...starts].filter((x) => x >= 0 && x < duration).sort((a, b) => a - b);
    if (s[0] !== 0) s.unshift(0);
    return s.map((start, i) => Math.max(((s[i + 1] ?? duration) - start) / duration, 0.01));
  }, [starts, duration]);

  if (!parts.length) return <div className="h-[3px] mt-2 rounded-full bg-rule" />;
  return (
    <div className="flex gap-[3px] h-[3px] mt-2" aria-hidden>
      {parts.map((w, i) => (
        <span
          key={i}
          style={{ flexGrow: w, flexBasis: 0 }}
          className="rounded-full bg-rule-lit group-hover:bg-dim transition-colors"
        />
      ))}
    </div>
  );
}

export function VideoCard({ video }: { video: VideoRecord }) {
  const failed = video.status === "error";
  const working = !failed && video.status !== "ready";
  const chapters = video.ai?.chapters ?? [];
  const duration = video.meta.durationSeconds;
  const runtime = clock(duration);

  const { account } = useWallet();
  const qc = useQueryClient();
  const wallet = account?.address?.toString();

  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [gone, setGone] = useState(false);

  const del = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm) { setConfirm(true); return; }
    setDeleting(true);
    try {
      await api.delete(`/api/videos/${video.id}`);
      setGone(true);
      qc.invalidateQueries({ queryKey: ["videos", wallet] });
      qc.invalidateQueries({ queryKey: ["shelby-stats", wallet] });
      qc.invalidateQueries({ queryKey: ["shelby-badge", wallet] });
    } catch { setDeleting(false); setConfirm(false); }
  };

  if (gone) return null;

  const meta = failed
    ? []
    : [
        chapters.length ? `${chapters.length} chapter${chapters.length === 1 ? "" : "s"}` : null,
        length(duration),
      ].filter(Boolean) as string[];

  return (
    <div className="relative group">
      <Link href={`/video/${video.id}`} className="block rounded-md focus-visible:outline-offset-4">
        <article>
          <div className={clsx(
            "relative aspect-video overflow-hidden rounded-md bg-screen border transition-colors",
            failed ? "border-error/40" : "border-rule group-hover:border-rule-lit"
          )}>
            {working && <div className="absolute inset-0 scan rounded-none opacity-60" />}

            {/* Table of contents */}
            {!working && !failed && (
              <ol className="absolute inset-0 p-3.5 pr-10 flex flex-col gap-[5px] text-[12.5px] leading-snug">
                {chapters.slice(0, 4).map((c, i) => (
                  <li key={i} className="flex gap-2.5 min-w-0">
                    <span className="tc w-[38px] shrink-0 text-dim-2 group-hover:text-dim transition-colors">{clock(c.startSeconds)}</span>
                    <span className="truncate text-dim group-hover:text-paper-2 transition-colors">{c.title}</span>
                  </li>
                ))}
                {chapters.length > 4 && (
                  <li className="pl-[48px] text-dim-2">{chapters.length - 4} more</li>
                )}
                {chapters.length === 0 && <li className="text-dim-2">No chapters yet</li>}
              </ol>
            )}

            {working && (
              <div className="absolute inset-0 p-3.5 flex items-start gap-2">
                <span className="dot dot-work mt-[7px]" />
                <span className="text-[13px] text-paper-2">{WORKING[video.status] ?? "Processing"}</span>
              </div>
            )}

            {failed && (
              <div className="absolute inset-0 p-3.5">
                <p className="text-[13px] text-error">Processing stopped</p>
                <p className="text-[12.5px] text-dim mt-0.5">Open it to see which step, and retry.</p>
              </div>
            )}

            {runtime && !working && !failed && (
              <span className="absolute bottom-2 right-2 tc text-[12px] text-paper px-1.5 py-px rounded-xs bg-screen/85 border border-rule">
                {runtime}
              </span>
            )}
          </div>

          <ChapterRuler starts={chapters.map((c) => c.startSeconds)} duration={working || failed ? undefined : duration} />

          <div className="pt-2.5">
            <h3 className={clsx(
              "text-[14px] font-medium leading-snug line-clamp-2 transition-colors",
              failed ? "text-paper-2" : "text-paper"
            )}>
              {video.title}
            </h3>
            <p className="tc mt-1 flex flex-wrap gap-x-3">
              {meta.map((m) => <span key={m}>{m}</span>)}
              <span>{when(video.createdAt)}</span>
            </p>
          </div>
        </article>
      </Link>

      {/* Delete. Always visible on touch screens, where nothing can hover. */}
      {!confirm && (
        <button
          onClick={del}
          aria-label={`Delete ${video.title}`}
          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-sm bg-screen/85 border border-rule text-dim hover:text-error hover:border-error/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 transition no-min"
        >
          <Trash2 size={13} />
        </button>
      )}

      {confirm && (
        <div
          className="absolute inset-x-0 top-0 aspect-video rounded-md bg-slate border border-error/60 flex flex-col justify-between p-3.5 z-10"
          onClick={(e) => e.preventDefault()}
        >
          <div>
            <p className="text-[13.5px] font-medium text-paper">Delete this video?</p>
            <p className="text-[12.5px] text-dim mt-0.5 leading-snug">
              It leaves your library. The copy on Shelby stays until its paid period ends.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={del}
              disabled={deleting}
              className="h-8 px-3 rounded text-[13px] font-medium bg-error/15 border border-error/50 text-error hover:bg-error/25 transition-colors disabled:opacity-50 no-min"
            >
              {deleting ? "Deleting" : "Delete"}
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirm(false); }}
              className="h-8 px-3 btn-ghost text-[13px] no-min"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
