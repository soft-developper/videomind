"use client";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle, Upload, FileText, Brain, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";
import { getVideoStatus } from "@/lib/api";
import { clsx } from "clsx";
import Link from "next/link";

const STEPS = [
  { key: "uploading",    label: "Uploading to Shelby",    icon: Upload,    desc: "Video stored on decentralised network" },
  { key: "transcribing", label: "Transcribing audio",      icon: FileText,  desc: "Whisper AI extracting speech to text" },
  { key: "analyzing",   label: "Analyzing with Claude",   icon: Brain,     desc: "Generating chapters, highlights & summary" },
  { key: "ready",       label: "Intelligence ready",      icon: Sparkles,  desc: "All AI outputs stored and available" },
];

const ORDER = ["uploading", "processing", "transcribing", "analyzing", "ready"];

// Friendly label for each status shown in the header
const STATUS_HEADING: Record<string, string> = {
  uploading:    "Uploading your video to Shelby...",
  processing:   "Processing your video...",
  transcribing: "Transcribing audio with Whisper...",
  analyzing:    "Analyzing content with Claude...",
  ready:        "Ready!",
  error:        "Processing failed",
};

export function ProcessingStatus({
  videoId,
  onReady,
}: {
  videoId: string;
  onReady: () => void;
}) {
  const [status, setStatus] = useState("uploading");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (status === "ready" || status === "error") return;

    setFetchError(null);
    const interval = setInterval(async () => {
      try {
        const data = await getVideoStatus(videoId);
        setStatus(data.status);
        setFetchError(null);
        if (data.status === "ready") {
          clearInterval(interval);
          onReady();
        }
        if (data.status === "error") clearInterval(interval);
      } catch (err: any) {
        setFetchError(err.message ?? "Failed to fetch status");
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [videoId, status, onReady, retryCount]);

  const currentIdx = ORDER.indexOf(status);

  // ── Error state ────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="glass-card rounded-2xl p-8 text-center space-y-5">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
          <AlertTriangle size={22} className="text-red-400" />
        </div>
        <div>
          <p className="font-syne font-semibold text-white text-lg">Processing failed</p>
          <p className="text-sm text-white/40 font-dm mt-2 leading-relaxed">
            Something went wrong during AI processing. This is usually caused by an unsupported
            audio format or a temporary API issue.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3 justify-center pt-2">
          <Link
            href="/upload"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-volt text-black font-syne font-semibold text-sm hover:bg-volt-dim transition-all"
          >
            <Upload size={14} />
            Upload again
          </Link>
          <Link
            href="/"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-dark-700 border border-white/10 text-white/60 font-syne font-semibold text-sm hover:border-white/20 transition-all"
          >
            Back to library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Loader2 size={14} className="text-volt animate-spin shrink-0" />
        <p className="text-sm font-syne font-semibold text-white">
          {STATUS_HEADING[status] ?? "Processing..."}
        </p>
      </div>

      {/* Status fetch error — non-fatal, just warn */}
      {fetchError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
          <p className="text-xs text-yellow-400/80 font-mono flex-1">
            Status check failed — retrying...
          </p>
          <button
            onClick={() => setRetryCount((c) => c + 1)}
            className="text-yellow-400/60 hover:text-yellow-400 transition-colors"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-2">
        {STEPS.map((step, i) => {
          const stepIdx = ORDER.indexOf(step.key);
          const done = currentIdx > stepIdx;
          const active = status === step.key ||
            (step.key === "uploading" && status === "processing");
          const Icon = step.icon;

          return (
            <div
              key={step.key}
              className={clsx(
                "flex items-start gap-3 p-3.5 rounded-xl transition-all duration-500",
                active && "bg-volt/[0.06] border border-volt/15",
                !active && !done && "opacity-30"
              )}
            >
              <div className={clsx(
                "w-8 h-8 rounded-lg shrink-0 flex items-center justify-center border transition-all",
                done   ? "bg-volt/20 border-volt/30"  :
                active ? "bg-volt/10 border-volt/20"  :
                         "bg-dark-700 border-white/10"
              )}>
                {done
                  ? <CheckCircle size={14} className="text-volt" />
                  : <Icon size={14} className={active ? "text-volt" : "text-white/20"} />
                }
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <p className={clsx(
                  "text-sm font-dm transition-colors",
                  active ? "text-white" : done ? "text-white/50" : "text-white/20"
                )}>
                  {step.label}
                </p>
                <p className={clsx(
                  "text-xs font-mono mt-0.5 transition-colors",
                  active ? "text-volt/60" : "text-white/15"
                )}>
                  {step.desc}
                </p>
              </div>
              {active && <Loader2 size={12} className="text-volt animate-spin shrink-0 mt-1" />}
              {done && <CheckCircle size={12} className="text-volt/40 shrink-0 mt-1" />}
            </div>
          );
        })}
      </div>

      {/* Time warning */}
      <p className="text-[11px] font-mono text-white/20 text-center">
        This page updates automatically · Large videos may take a few minutes
      </p>
    </div>
  );
}
