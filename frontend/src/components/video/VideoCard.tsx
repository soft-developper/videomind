"use client";
import Link from "next/link";
import { Trash2, X, Play } from "lucide-react";
import { clsx } from "clsx";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { api } from "@/lib/api";
import type { VideoRecord } from "@/lib/api";

const STATUS: Record<string, { label: string; dot: string }> = {
  uploading:    { label: "Uploading",    dot: "dot-work" },
  processing:   { label: "Processing",   dot: "dot-work" },
  transcribing: { label: "Transcribing", dot: "dot-work" },
  analyzing:    { label: "Analyzing",    dot: "dot-work" },
  ready:        { label: "Ready",        dot: "dot-live" },
  error:        { label: "Failed",       dot: "dot-dead" },
};

function tc(sec?: number) {
  if (!sec || !isFinite(sec)) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function when(ms: number) {
  const d = Date.now() - ms;
  const min = Math.floor(d / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(ms));
}

/** Mini density preview — the card carries a fingerprint of the video's shape. */
function MiniStrip({ transcript, duration }: { transcript?: any[]; duration?: number }) {
  const bars = useMemo(() => {
    if (!transcript?.length || !duration) return [];
    const N = 48;
    const lane = new Array(N).fill(0);
    const bd = duration / N;
    for (const seg of transcript) {
      const dur = Math.max(seg.end - seg.start, 0.1);
      const cps = seg.text.length / dur;
      const a = Math.max(0, Math.floor(seg.start / bd));
      const b = Math.min(N, Math.ceil(seg.end / bd));
      for (let i = a; i < b; i++) lane[i] = Math.max(lane[i], cps);
    }
    const max = Math.max(...lane, 1);
    return lane.map((v) => v / max);
  }, [transcript, duration]);

  if (!bars.length) return null;

  return (
    <div className="flex items-end gap-px h-5 px-3 pb-2">
      {bars.map((v, i) => (
        <div
          key={i}
          className="flex-1 min-w-0"
          style={{
            height: v === 0 ? "1px" : `${Math.max(v * 100, 15)}%`,
            background: v === 0 ? "var(--dim-2)" : `rgba(232,230,225,${0.1 + v * 0.35})`,
          }}
        />
      ))}
    </div>
  );
}

export function VideoCard({ video }: { video: VideoRecord }) {
  const st = STATUS[video.status] ?? STATUS.ready;
  const isError = video.status === "error";
  const isWorking = !["ready", "error"].includes(video.status);
  const dur = tc(video.meta.durationSeconds);

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

  return (
    <div className="relative group">
      <Link href={`/video/${video.id}`} className="block">
        <article className={clsx(
          "panel-hover",
          isError && "border-error/25",
          confirm && "border-error"
        )}>
          {/* Frame */}
          <div className="relative aspect-video bg-void overflow-hidden border-b border-rule">
            {isWorking && <div className="absolute inset-0 scan" />}

            {/* Slate — like a film clapper board */}
            <div className="absolute inset-0 flex flex-col justify-between p-3">
              <div className="flex items-start justify-between">
                <span className="eyebrow">{video.id.slice(0, 8)}</span>
                <span className="flex items-center gap-1.5">
                  <span className={clsx("dot", st.dot)} />
                  <span className="tc">{st.label}</span>
                </span>
              </div>

              {video.status === "ready" && (
                <div className="flex items-end justify-between">
                  <span className="tc">Shelby</span>
                  {dur && <span className="tc tabular-nums text-paper-2">{dur}</span>}
                </div>
              )}
            </div>

            {/* Play on hover */}
            {video.status === "ready" && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="w-9 h-9 bg-signal flex items-center justify-center">
                  <Play size={13} className="text-void ml-0.5" fill="currentColor" />
                </span>
              </div>
            )}

            {/* Delete */}
            {!confirm && (
              <button
                onClick={del}
                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-dim-2 hover:text-error opacity-0 group-hover:opacity-100 transition-all no-min"
                aria-label="Delete"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>

          {/* Density fingerprint */}
          {video.status === "ready" && (
            <MiniStrip
              transcript={video.ai?.transcript}
              duration={video.meta.durationSeconds}
            />
          )}

          {/* Meta */}
          <div className="px-3 pb-3 pt-1 space-y-2">
            <h3 className={clsx(
              "font-display text-[17px] leading-[1.2] line-clamp-2 transition-colors",
              isError ? "text-dim" : "text-paper group-hover:text-signal"
            )}>
              {video.title}
            </h3>

            {!isError && video.ai?.tags && video.ai.tags.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {video.ai.tags.slice(0, 3).map((t) => (
                  <span key={t} className="tc lowercase">{t}</span>
                ))}
              </div>
            )}

            {isError && (
              <p className="text-[12px] font-sans text-error/60">
                Processing failed — open to retry
              </p>
            )}

            <p className="tc">{when(video.createdAt)}</p>
          </div>
        </article>
      </Link>

      {/* Confirm */}
      {confirm && (
        <div
          className="absolute inset-0 bg-void/95 flex flex-col items-center justify-center gap-4 p-4 z-10 border border-error"
          onClick={(e) => e.preventDefault()}
        >
          <p className="font-display text-[16px] text-paper text-center leading-tight">
            Delete this video?
          </p>
          <p className="text-[12px] font-sans text-dim text-center leading-relaxed">
            Removed from your library. The blob expires on Shelby naturally.
          </p>
          <div className="flex gap-2 w-full">
            <button
              onClick={del}
              disabled={deleting}
              className="flex-1 h-8 text-[12px] font-sans bg-error/15 border border-error/40 text-error hover:bg-error/25 transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirm(false); }}
              className="flex-1 h-8 text-[12px] font-sans btn-ghost flex items-center justify-center gap-1"
            >
              <X size={11} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
