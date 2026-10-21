"use client";
import { useEffect, useRef, useState } from "react";
// vm_jobs: stage by stage status, the reason a stage failed, and retry
import { getVideoJobs, retryVideoJob, type VideoJob } from "@/lib/api";
import { clsx } from "clsx";
import Link from "next/link";
import { useSessionWallet } from "@/components/layout/AuthProvider";
// vm_lang
import { useTranslations } from "next-intl";
import { localize } from "@/lib/errorText";
// vm_charge: processing stopped for credits: add some, then Try again
import { AddCreditsLink, PriceTag, isNoCredits } from "@/components/credits/Credits";

// vm_lang: names and lines are message keys under "processing.steps".
const STEPS = [{ k: "uploading" }, { k: "transcribing" }, { k: "analyzing" }, { k: "ready" }] as const;

const ORDER = ["uploading", "processing", "transcribing", "analyzing", "ready"];

export function ProcessingStatus({
  videoId, onReady,
}: { videoId: string; onReady: () => void }) {
  const tp = useTranslations("processing");
  // The server names a failed step in English; known steps are named in the reader's language.
  const stage = (j: VideoJob, what: "name" | "failed" | "retry") =>
    j.kind === "transcribe" || j.kind === "analyze" ? tp(`stage.${j.kind}.${what}`) : what === "name" ? j.label : what === "failed" ? tp("stepFailed", { step: j.label }) : tp("retryStep", { step: j.label.toLowerCase() });
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
      setRetryErr(e.message ?? tp("retryFailed"));
    } finally {
      setRetrying(false);
    }
  };

  if (status === "error") {
    return (
      <div className="panel p-5 space-y-3">
        <p className="font-display text-[18px] text-paper">
          {failed ? stage(failed, "failed") : tp("failed")}
        </p>
        <p className="text-[14px] font-sans text-paper-2 leading-relaxed">
          {localize(failed?.error)
            ?? (failed
              ? tp("stepCouldNot")
              : tp("couldNot"))}
        </p>
        {failed?.canRetry && (
          <p className="text-[13px] text-dim">
            {tp("kept")}
          </p>
        )}
        {isNoCredits(failed?.errorCode) && (
          <div className="space-y-1" data-processing-no-credits>
            <PriceTag what="process" />
            <AddCreditsLink className="text-[13.5px] text-paper" />
          </div>
        )}
        {failed?.errorCode === "too_long" && (
          <p className="text-[13px] text-dim">
            {tp("tooLong")}
          </p>
        )}
        {retryErr && <p role="alert" className="text-[13px] font-sans text-error">{retryErr}</p>}
        <div className="flex gap-2 pt-2">
          {failed?.canRetry ? (
            <button onClick={retry} disabled={retrying} className="btn btn-signal h-9 px-4 flex items-center">
              {retrying ? tp("starting") : stage(failed, "retry")}
            </button>
          ) : failed?.errorCode === "too_long" ? null : (
            <Link href="/upload" className="btn btn-signal h-9 px-4 flex items-center">
              {tp("uploadAgain")}
            </Link>
          )}
          <Link href="/library" className="btn btn-ghost h-9 px-4 flex items-center">
            {tp("library")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 h-11 border-b border-rule">
        <span className="dot dot-work" />
        <span className="text-[14px] font-semibold text-paper">{tp("title")}</span>
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
                on && "bg-signal/[0.10] shadow-[inset_2px_0_0_var(--signal)] rtl:shadow-[inset_-2px_0_0_var(--signal)]",
                !on && !done && "opacity-45"
              )}
            >
              <span className={clsx(
                "tc w-9 shrink-0 pt-px",
                on ? "text-paper" : done ? "tc-marker" : ""
              )}>
                {done ? tp("done") : i + 1}
              </span>
              <div className="min-w-0">
                <p className={clsx(
                  "text-[14px] font-medium leading-snug",
                  on ? "text-paper" : done ? "text-paper-2" : "text-dim"
                )}>
                  {tp(`steps.${s.k}.n`)}
                </p>
                <p className="text-[13px] font-sans text-dim mt-0.5">{tp(`steps.${s.k}.d`)}</p>
                {on && s.k === "transcribing" && pieces && pieces.total > 1 && (
                  <p className="tc text-paper-2 mt-1.5">
                    {tp("part", { n: Math.min(pieces.done + 1, pieces.total), total: pieces.total })}
                  </p>
                )}
              </div>
              {on && <span className="dot dot-work ms-auto mt-2" />}
            </div>
          );
        })}
      </div>

      <footer className="px-4 py-2.5 border-t border-rule">
        <p className="text-[13px] text-dim">
          {waiting
            ? tp("retrying", { step: stage(waiting, "name"), n: waiting.attempts + 1, max: waiting.maxAttempts })
            : tp("updates")}
        </p>
      </footer>
    </div>
  );
}
