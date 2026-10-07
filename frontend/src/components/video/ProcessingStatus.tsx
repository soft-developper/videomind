"use client";
import { useEffect, useRef, useState } from "react";
// vm_jobs: stage by stage status, the reason a stage failed, and retry
import { getVideoJobs, retryVideoJob, type VideoJob } from "@/lib/api";
import { clsx } from "clsx";
import Link from "next/link";
import { useSessionWallet } from "@/components/layout/AuthProvider";

const STEPS = [
  { k: "uploading",    n: "Store", d: "Blob landing on Shelby" },
  { k: "transcribing", n: "Read",  d: "Whisper transcribing audio" },
  { k: "analyzing",    n: "Map",   d: "Claude finding cuts and highlights" },
  { k: "ready",        n: "Ask",   d: "Intelligence ready" },
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
      <div className="panel p-6 text-center space-y-4">
        <p className="font-display text-[22px] text-paper">
          {failed ? `${failed.label} failed` : "Processing failed"}
        </p>
        <p className="text-[13px] font-sans text-dim leading-relaxed">
          {failed?.error
            ?? (failed
              ? "This step could not finish. The video's owner can see why and run it again."
              : "This video could not be processed.")}
        </p>
        {failed?.canRetry && (
          <p className="tc">
            Steps that already finished are kept. Only this step runs again.
          </p>
        )}
        {retryErr && <p className="text-[12px] font-sans text-error">{retryErr}</p>}
        <div className="flex gap-2 justify-center pt-1">
          {failed?.canRetry ? (
            <button onClick={retry} disabled={retrying} className="btn btn-signal h-9 px-4 flex items-center disabled:opacity-50">
              {retrying ? "Starting" : `Retry ${failed.label.toLowerCase()}`}
            </button>
          ) : (
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
    <div className="panel">
      <header className="flex items-center gap-2.5 px-4 h-10 border-b border-rule">
        <span className="dot dot-work" />
        <span className="eyebrow">Processing</span>
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
                on && "bg-signal-wash",
                !on && !done && "opacity-35"
              )}
            >
              <span className={clsx(
                "tc tabular-nums shrink-0 pt-0.5",
                on ? "tc-signal" : done ? "tc-marker" : ""
              )}>
                {done ? "done" : String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <p className={clsx(
                  "font-display text-[17px] leading-none",
                  on ? "text-paper" : done ? "text-dim" : "text-dim-2"
                )}>
                  {s.n}
                </p>
                <p className="text-[12px] font-sans text-dim mt-1.5">{s.d}</p>
              </div>
              {on && <span className="dot dot-work ml-auto mt-1.5" />}
            </div>
          );
        })}
      </div>

      <footer className="px-4 py-2.5 border-t border-rule">
        <p className="tc">
          {waiting
            ? `${waiting.label} hit a problem. Trying again, attempt ${waiting.attempts + 1} of ${waiting.maxAttempts}`
            : "Updates automatically · long videos take a few minutes"}
        </p>
      </footer>
    </div>
  );
}
