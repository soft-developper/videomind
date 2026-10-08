"use client";
import { useEffect, useRef, useState } from "react";
// vm_jobs: stage by stage status, the reason a stage failed, and retry
import { getVideoJobs, retryVideoJob, type VideoJob } from "@/lib/api";
import { clsx } from "clsx";
import Link from "next/link";
import { useSessionWallet } from "@/components/layout/AuthProvider";

const STEPS = [
  { k: "uploading",    n: "Upload",     d: "Sending the file to your library" },
  { k: "transcribing", n: "Transcribe", d: "Writing down every sentence with its time" },
  { k: "analyzing",    n: "Chapters",   d: "Finding chapters, a summary and key moments" },
  { k: "ready",        n: "Ready",      d: "Searchable and ready to share" },
];

const ORDER = ["uploading", "processing", "transcribing", "analyzing", "ready"];

export function ProcessingStatus({
  videoId, onReady,
}: { videoId: string; onReady: () => void }) {
  const [status, setStatus] = useState("uploading");
  // Signing in changes what the server shows (the reason, the retry), so reload then.
  const sessionWallet = useSessionWallet();
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);
  // Kept in a ref so a new function from the parent does not restart polling.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await getVideoJobs(videoId);
        if (!alive) return;
        setJobs(d.jobs);
        setStatus(d.status);
        if (d.status === "ready") onReadyRef.current();
      } catch {}
    };
    // One read straight away, so a failure shows its reason without a wait.
    void load();
    if (status === "ready" || status === "error") return () => { alive = false; };
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [videoId, status, sessionWallet]);

  const idx = ORDER.indexOf(status);
  // vm_transcribe: a long recording is transcribed in pieces; say which one is being worked on
  const pieces = jobs.find((j) => j.kind === "transcribe")?.progress;
  const failed = jobs.find((j) => j.status === "failed");
  // A stage that failed but will be tried again by itself.
  const waiting = jobs.find((j) => j.status === "queued" && j.attempts > 0);

  const retry = async () => {
    if (!failed || retrying) return;
    setRetrying(true); setRetryErr(null);
    try {
      const d = await retryVideoJob(videoId, failed.kind);
      setJobs([]);
      setStatus(d.status);
    } catch (e: any) {
      setRetryErr(e.message ?? "Could not retry.");
    } finally {
      setRetrying(false);
    }
  };

  if (status === "error") {
    return (
      <div className="panel p-5 space-y-3">
        <p className="font-display text-[18px] text-paper">
          {failed ? `${failed.label} failed` : "Processing failed"}
        </p>
        <p className="text-[14px] font-sans text-paper-2 leading-relaxed">
          {failed?.error
            ?? (failed
              ? "This step could not finish. The video's owner can see why and run it again."
              : "This video could not be processed.")}
        </p>
        {failed?.canRetry && (
          <p className="text-[13px] text-dim">
            Steps that already finished are kept. Only this step runs again.
          </p>
        )}
        {failed?.errorCode === "too_long" && (
          <p className="text-[13px] text-dim">
            The video itself is fine and plays normally. It only has no transcript.
          </p>
        )}
        {retryErr && <p role="alert" className="text-[13px] font-sans text-error">{retryErr}</p>}
        <div className="flex gap-2 pt-2">
          {failed?.canRetry ? (
            <button onClick={retry} disabled={retrying} className="btn btn-signal h-9 px-4 flex items-center">
              {retrying ? "Starting" : `Retry ${failed.label.toLowerCase()}`}
            </button>
          ) : failed?.errorCode === "too_long" ? null : (
            <Link href="/upload" className="btn btn-signal h-9 px-4 flex items-center">
              Upload again
            </Link>
          )}
          <Link href="/library" className="btn btn-ghost h-9 px-4 flex items-center">
            Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 h-11 border-b border-rule">
        <span className="dot dot-work" />
        <span className="text-[14px] font-semibold text-paper">Processing</span>
      </header>

      <div>
        {STEPS.map((s, i) => {
          const si = ORDER.indexOf(s.k);
          const done = idx > si;
          const on = status === s.k || (s.k === "uploading" && status === "processing");
          return (
            <div
              key={s.k}
              className={clsx(
                "flex items-start gap-4 px-4 py-3.5 border-b border-rule last:border-0 transition-colors",
                on && "bg-signal/[0.10] shadow-[inset_2px_0_0_var(--signal)]",
                !on && !done && "opacity-45"
              )}
            >
              <span className={clsx(
                "tc w-9 shrink-0 pt-px",
                on ? "text-paper" : done ? "tc-marker" : ""
              )}>
                {done ? "Done" : i + 1}
              </span>
              <div className="min-w-0">
                <p className={clsx(
                  "text-[14px] font-medium leading-snug",
                  on ? "text-paper" : done ? "text-paper-2" : "text-dim"
                )}>
                  {s.n}
                </p>
                <p className="text-[13px] font-sans text-dim mt-0.5">{s.d}</p>
                {on && s.k === "transcribing" && pieces && pieces.total > 1 && (
                  <p className="tc text-paper-2 mt-1.5">
                    Part {Math.min(pieces.done + 1, pieces.total)} of {pieces.total}
                  </p>
                )}
              </div>
              {on && <span className="dot dot-work ml-auto mt-2" />}
            </div>
          );
        })}
      </div>

      <footer className="px-4 py-2.5 border-t border-rule">
        <p className="text-[13px] text-dim">
          {waiting
            ? `${waiting.label} hit a problem. Trying again, attempt ${waiting.attempts + 1} of ${waiting.maxAttempts}`
            : "This updates by itself. Long videos take a few minutes."}
        </p>
      </footer>
    </div>
  );
}
