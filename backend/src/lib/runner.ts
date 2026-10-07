// src/lib/runner.ts
// vm_jobs: the worker loop that executes jobs from the queue.
//
// It runs inside the API service for now. It only talks to the database,
// so the same code runs unchanged as its own service (src/worker.ts)
// once uploads live in shared storage instead of on this machine's disk.
import crypto from "node:crypto";
import { claimNextJob, completeJob, failJob, heartbeatJob, releaseJob, type Job } from "./jobs.js";

/** Thrown by a handler for a failure that trying again cannot fix. */
export class PermanentJobError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PermanentJobError";
    this.code = code;
  }
}

export type JobHandler = (job: Job) => Promise<void>;
/** Called once when a job fails for good (no attempts left, or not retryable). */
export type FinalFailureHook = (job: Job, f: { error: string; code: string }) => Promise<void>;

const handlers = new Map<string, JobHandler>();
let onFinalFailure: FinalFailureHook | null = null;

export function registerHandler(kind: string, fn: JobHandler) { handlers.set(kind, fn); }
export function setFinalFailureHook(fn: FinalFailureHook | null) { onFinalFailure = fn; }

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

let wake: (() => void) | null = null;
/** Wake an idle runner now instead of at its next poll. */
export function nudgeRunner() { wake?.(); }

export interface Runner { stop: () => Promise<void>; workerId: string }

export function startRunner(opts: { concurrency?: number; pollMs?: number; leaseMs?: number } = {}): Runner {
  const concurrency = opts.concurrency ?? envInt("JOBS_CONCURRENCY", 1);
  const pollMs = opts.pollMs ?? envInt("JOBS_POLL_MS", 2000);
  const leaseMs = opts.leaseMs ?? envInt("JOBS_LEASE_MS", 5 * 60_000);
  const workerId = `w-${crypto.randomUUID().slice(0, 8)}`;
  const running = new Map<string, Job>();
  let stopped = false;
  const wakers = new Set<() => void>();
  wake = () => wakers.forEach((w) => w());

  const idle = () => new Promise<void>((resolve) => {
    const done = () => { clearTimeout(t); wakers.delete(done); resolve(); };
    const t = setTimeout(done, pollMs);
    wakers.add(done);
  });

  async function runOne(job: Job) {
    running.set(job.id, job);
    const beat = setInterval(() => {
      heartbeatJob(job.id, workerId, leaseMs).catch(() => {});
    }, Math.max(1000, Math.floor(leaseMs / 3)));
    try {
      // A job taken over from a dead worker may already be out of attempts.
      if (job.attempts > job.maxAttempts) {
        throw new PermanentJobError("worker_lost", "The server stopped while running this step too many times.");
      }
      const handler = handlers.get(job.kind);
      if (!handler) throw new PermanentJobError("no_handler", `No handler for job kind "${job.kind}".`);
      await handler(job);
      await completeJob(job.id, workerId);
      console.log(`[jobs] ${job.kind} ${job.videoId} succeeded (attempt ${job.attempts})`);
    } catch (err: any) {
      const permanent = err instanceof PermanentJobError;
      const f = {
        error: String(err?.message ?? err ?? "Unknown error"),
        code: permanent ? err.code : String(err?.code ?? "error"),
        retryable: !permanent,
      };
      const ended = await failJob(job, workerId, f).catch(() => null);
      console.warn(`[jobs] ${job.kind} ${job.videoId} attempt ${job.attempts} failed (${f.code}): ${f.error} -> ${ended ?? "lease lost"}`);
      if (ended === "failed" && onFinalFailure) await onFinalFailure(job, f).catch(() => {});
    } finally {
      clearInterval(beat);
      running.delete(job.id);
    }
  }

  async function slot() {
    while (!stopped) {
      let job: Job | null = null;
      try { job = await claimNextJob(workerId, leaseMs); }
      catch (err: any) { console.warn(`[jobs] claim failed: ${err?.message ?? err}`); }
      if (stopped) {
        if (job) await releaseJob(job.id, workerId).catch(() => {});
        break;
      }
      if (job) await runOne(job);
      else await idle();
    }
  }

  const slots = Array.from({ length: concurrency }, () => slot());
  console.log(`[jobs] runner ${workerId} started (concurrency ${concurrency}, lease ${Math.round(leaseMs / 1000)}s)`);

  return {
    workerId,
    /** Stop taking jobs and hand back any that are mid run. */
    async stop() {
      stopped = true;
      wake?.();
      await Promise.all(Array.from(running.keys()).map((id) => releaseJob(id, workerId).catch(() => {})));
      // Do not wait for in flight handlers: a deploy gives only a few seconds.
      await Promise.race([Promise.all(slots), new Promise((r) => setTimeout(r, 500))]);
      console.log(`[jobs] runner ${workerId} stopped`);
    },
  };
}

/** Test hook. */
export function _resetRunner() { handlers.clear(); onFinalFailure = null; wake = null; }
