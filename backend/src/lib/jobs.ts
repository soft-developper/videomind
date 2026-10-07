// src/lib/jobs.ts
// vm_jobs: a durable job queue in the database.
//
// Every stage of processing a video is one row in `jobs`. The row is the
// source of truth: which stage, how many attempts, when to try again,
// why it failed. Nothing about a job lives only in memory, so a restart
// or a deploy loses nothing, and one failed stage can be retried without
// repeating the stages before it.
//
// How it stays correct with more than one worker:
//   * claiming is ONE SQL statement, so two workers can never take the
//     same job
//   * a running job holds a lease that the worker keeps renewing; if the
//     worker dies the lease runs out and another worker takes the job
//   * each job has a unique idempotency key, so asking for the same work
//     twice creates one job, not two
import crypto from "node:crypto";
import type { InValue } from "@libsql/client";
import { getDb } from "./db.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Job {
  id: string;
  videoId: string;
  kind: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  lockedBy: string | null;
  lockedUntil: number | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  error: string | null;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

function rowToJob(r: Record<string, unknown>): Job {
  let payload: Record<string, unknown> = {};
  try { payload = r.payload ? JSON.parse(String(r.payload)) : {}; } catch { payload = {}; }
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id),
    videoId: String(r.video_id),
    kind: String(r.kind),
    status: String(r.status) as JobStatus,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    runAfter: Number(r.run_after),
    lockedBy: r.locked_by ? String(r.locked_by) : null,
    lockedUntil: n(r.locked_until),
    idempotencyKey: String(r.idempotency_key),
    payload,
    error: r.error ? String(r.error) : null,
    errorCode: r.error_code ? String(r.error_code) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    startedAt: n(r.started_at),
    finishedAt: n(r.finished_at),
  };
}

/** Wait before attempt N+1, in ms. JOBS_BACKOFF_MS="30000,120000,600000". */
export function backoffMs(attemptsSoFar: number): number {
  const list = (process.env.JOBS_BACKOFF_MS ?? "30000,120000,600000")
    .split(",").map((s) => Number(s.trim())).filter((x) => Number.isFinite(x) && x >= 0);
  if (list.length === 0) return 30_000;
  return list[Math.min(Math.max(attemptsSoFar, 1), list.length) - 1];
}

/**
 * Add a job. If a job with the same key already exists nothing is added
 * and the existing job is returned, so callers can ask as often as they
 * like. The default key is "<videoId>:<kind>": one job of each kind per video.
 */
export async function enqueueJob(args: {
  videoId: string;
  kind: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: number;
  key?: string;
}): Promise<{ job: Job; created: boolean }> {
  const db = getDb();
  const now = Date.now();
  const key = args.key ?? `${args.videoId}:${args.kind}`;
  const ins = await db.execute({
    sql: `INSERT INTO jobs (id, video_id, kind, status, attempts, max_attempts, run_after, idempotency_key, payload, created_at, updated_at)
          VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO NOTHING`,
    args: [crypto.randomUUID(), args.videoId, args.kind, args.maxAttempts ?? 3, args.runAfter ?? now, key,
           JSON.stringify(args.payload ?? {}), now, now],
  });
  const row = await db.execute({ sql: "SELECT * FROM jobs WHERE idempotency_key = ?", args: [key] });
  return { job: rowToJob(row.rows[0] as Record<string, unknown>), created: ins.rowsAffected === 1 };
}

/**
 * Take the next job that is due, or one whose worker stopped renewing its
 * lease. One statement, so it is atomic. Returns null when nothing is due.
 */
export async function claimNextJob(workerId: string, leaseMs: number): Promise<Job | null> {
  const now = Date.now();
  const r = await getDb().execute({
    sql: `UPDATE jobs
             SET status = 'running', locked_by = ?, locked_until = ?, attempts = attempts + 1,
                 started_at = COALESCE(started_at, ?), updated_at = ?
           WHERE id = (
                   SELECT id FROM jobs
                    WHERE (status = 'queued' AND run_after <= ?)
                       OR (status = 'running' AND locked_until < ?)
                    ORDER BY run_after ASC, created_at ASC
                    LIMIT 1)
       RETURNING *`,
    args: [workerId, now + leaseMs, now, now, now, now],
  });
  return r.rows.length ? rowToJob(r.rows[0] as Record<string, unknown>) : null;
}

/** Renew the lease. False means this worker no longer holds the job. */
export async function heartbeatJob(id: string, workerId: string, leaseMs: number): Promise<boolean> {
  const now = Date.now();
  const r = await getDb().execute({
    sql: "UPDATE jobs SET locked_until = ?, updated_at = ? WHERE id = ? AND locked_by = ? AND status = 'running'",
    args: [now + leaseMs, now, id, workerId],
  });
  return r.rowsAffected === 1;
}

export async function completeJob(id: string, workerId: string): Promise<boolean> {
  const now = Date.now();
  const r = await getDb().execute({
    sql: `UPDATE jobs SET status = 'succeeded', locked_by = NULL, locked_until = NULL, error = NULL, error_code = NULL,
                 finished_at = ?, updated_at = ?
           WHERE id = ? AND locked_by = ? AND status = 'running'`,
    args: [now, now, id, workerId],
  });
  return r.rowsAffected === 1;
}

/**
 * Record a failure. A retryable failure with attempts left goes back to
 * the queue after a growing wait. Anything else is final.
 * Returns the status the job ended up in, or null if the lease was lost.
 */
export async function failJob(
  job: Job,
  workerId: string,
  f: { error: string; code: string; retryable: boolean }
): Promise<JobStatus | null> {
  const now = Date.now();
  const again = f.retryable && job.attempts < job.maxAttempts;
  const args: InValue[] = again
    ? ["queued", now + backoffMs(job.attempts), null, f.error.slice(0, 1000), f.code, now, job.id, workerId]
    : ["failed", job.runAfter, now, f.error.slice(0, 1000), f.code, now, job.id, workerId];
  const r = await getDb().execute({
    sql: `UPDATE jobs SET status = ?, run_after = ?, finished_at = ?, error = ?, error_code = ?,
                 locked_by = NULL, locked_until = NULL, updated_at = ?
           WHERE id = ? AND locked_by = ? AND status = 'running'`,
    args,
  });
  return r.rowsAffected === 1 ? (again ? "queued" : "failed") : null;
}

/**
 * Hand a running job back without counting the attempt. Used when the
 * service is shutting down for a deploy, so the next instance picks it
 * up at once instead of waiting for the lease to run out.
 */
export async function releaseJob(id: string, workerId: string): Promise<void> {
  const now = Date.now();
  await getDb().execute({
    sql: `UPDATE jobs SET status = 'queued', run_after = ?, attempts = MAX(attempts - 1, 0),
                 locked_by = NULL, locked_until = NULL, updated_at = ?
           WHERE id = ? AND locked_by = ? AND status = 'running'`,
    args: [now, now, id, workerId],
  });
}

/** Put a FAILED job back in the queue with a fresh set of attempts. */
export async function retryJob(videoId: string, kind: string): Promise<Job | null> {
  const now = Date.now();
  const r = await getDb().execute({
    sql: `UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, error = NULL, error_code = NULL,
                 finished_at = NULL, updated_at = ?
           WHERE video_id = ? AND kind = ? AND status = 'failed'
       RETURNING *`,
    args: [now, now, videoId, kind],
  });
  return r.rows.length ? rowToJob(r.rows[0] as Record<string, unknown>) : null;
}

export async function listJobs(videoId: string): Promise<Job[]> {
  const r = await getDb().execute({ sql: "SELECT * FROM jobs WHERE video_id = ? ORDER BY created_at ASC", args: [videoId] });
  return r.rows.map((x) => rowToJob(x as Record<string, unknown>));
}

export async function deleteJobsForVideo(videoId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM jobs WHERE video_id = ?", args: [videoId] });
}
