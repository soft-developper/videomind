"use client";
import Link from "next/link";
import { Film, Clock, CheckCircle, Loader2, AlertTriangle, Zap, RefreshCw, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { api } from "@/lib/api";
import type { VideoRecord } from "@/lib/api";

const STATUS_CONFIG = {
  uploading:    { label: "Uploading",    spin: true },
  processing:   { label: "Processing",   spin: true },
  transcribing: { label: "Transcribing", spin: true },
  analyzing:    { label: "Analyzing",    spin: true },
  ready:        { label: "Ready",        spin: false },
  error:        { label: "Failed",       spin: false },
};

function formatDate(ms: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms));
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function VideoCard({ video }: { video: VideoRecord }) {
  const cfg = STATUS_CONFIG[video.status];
  const isError = video.status === "error";
  const isProcessing = !["ready", "error"].includes(video.status);

  const { account } = useWallet();
  const queryClient = useQueryClient();
  const walletAddress = account?.address?.toString();

  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm) { setConfirm(true); return; }

    setDeleting(true);
    try {
      await api.delete(`/api/videos/${video.id}`);
      setDeleted(true);
      // Invalidate the library query so the card disappears
      queryClient.invalidateQueries({ queryKey: ["videos", walletAddress] });
      queryClient.invalidateQueries({ queryKey: ["shelby-stats", walletAddress] });
      queryClient.invalidateQueries({ queryKey: ["shelby-badge", walletAddress] });
    } catch {
      setDeleting(false);
      setConfirm(false);
    }
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirm(false);
  };

  // Fade out after deletion
  if (deleted) return null;

  return (
    <div className="relative group">
      <Link href={`/video/${video.id}`} className="block">
        <div className={clsx(
          "glass-card-hover rounded-2xl overflow-hidden transition-all duration-300",
          isError && "border border-red-500/20 hover:border-red-500/30",
          confirm && "ring-2 ring-red-500/40"
        )}>
          {/* Thumbnail area */}
          <div className="relative aspect-video bg-dark-800 overflow-hidden">
            {/* Grid pattern */}
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(200,255,0,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(200,255,0,0.5) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }}
            />

            {/* Center icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              {isError
                ? <AlertTriangle size={32} className="text-red-400/20" strokeWidth={1} />
                : <Film size={40} className="text-white/10" strokeWidth={1} />
              }
            </div>

            {/* Processing shimmer */}
            {isProcessing && <div className="absolute inset-0 shimmer opacity-30" />}

            {/* Status badge */}
            <div className={clsx(
              "absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border",
              video.status === "ready"
                ? "bg-volt/10 border-volt/20 text-volt"
                : isError
                ? "bg-red-500/10 border-red-500/20 text-red-400"
                : "bg-dark-900/80 border-white/10 text-white/60"
            )}>
              {cfg.spin
                ? <Loader2 size={10} className="animate-spin" />
                : isError
                ? <AlertTriangle size={10} />
                : <CheckCircle size={10} />
              }
              {cfg.label}
            </div>

            {/* Delete button — appears on hover (top-left) */}
            {!confirm && (
              <button
                onClick={handleDelete}
                className="absolute top-3 left-3 w-7 h-7 rounded-lg bg-dark-900/80 border border-white/10 flex items-center justify-center text-white/30 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                title="Delete video"
              >
                <Trash2 size={12} />
              </button>
            )}

            {/* Shelby badge */}
            <div className="absolute bottom-3 left-3 flex items-center gap-1 px-2 py-1 rounded bg-dark-900/70 border border-white/10">
              <Zap size={10} className="text-volt" />
              <span className="font-mono text-[10px] text-white/40">Shelby</span>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 space-y-3">
            <h3 className={clsx(
              "font-syne font-semibold text-sm leading-snug line-clamp-2 transition-colors",
              isError
                ? "text-white/50 group-hover:text-white/70"
                : "text-white group-hover:text-volt"
            )}>
              {video.title}
            </h3>

            {isError && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-red-400/60">
                <RefreshCw size={9} /> Click to view details or retry
              </div>
            )}

            {!isError && video.ai?.tags && video.ai.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {video.ai.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded text-[10px] font-mono bg-dark-700 text-white/40 border border-white/[0.06]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
              <div className="flex items-center gap-1 text-[11px] text-white/30 font-mono">
                <Clock size={10} />
                {formatDate(video.createdAt)}
              </div>
              <span className="text-[11px] text-white/20 font-mono">
                {formatBytes(video.meta.sizeBytes)}
              </span>
            </div>
          </div>
        </div>
      </Link>

      {/* Confirm delete overlay */}
      {confirm && (
        <div
          className="absolute inset-0 rounded-2xl bg-dark-950/90 backdrop-blur-sm flex flex-col items-center justify-center gap-4 p-5 z-10"
          onClick={(e) => e.preventDefault()}
        >
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <Trash2 size={16} className="text-red-400" />
          </div>
          <div className="text-center">
            <p className="font-syne font-semibold text-white text-sm">Delete this video?</p>
            <p className="text-[11px] text-white/35 font-dm mt-1 leading-relaxed">
              Removed from your library. The Shelby blob expires naturally.
            </p>
          </div>
          <div className="flex items-center gap-2 w-full">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-syne font-semibold hover:bg-red-500/30 transition-all disabled:opacity-50"
            >
              {deleting
                ? <Loader2 size={11} className="animate-spin" />
                : <Trash2 size={11} />
              }
              {deleting ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={cancelDelete}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-dark-700 border border-white/10 text-white/50 text-xs font-syne font-semibold hover:border-white/20 transition-all"
            >
              <X size={11} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
