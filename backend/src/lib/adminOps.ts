// src/lib/adminOps.ts
// vm_ops: the dashboard's Operations and Security sections.
// Operations: processing jobs (retry a failed one), unfinished uploads
// (discard one), stores on Shelby (check one again), and running the
// hourly housekeeping now. Security: suspended wallets, sessions, admin
// sign in activity, and the recent events kept in memory (securityLog.ts).
import { getDb } from "./db.js";
import { store } from "./store.js";
import { retryJob } from "./jobs.js";
import { nudgeRunner } from "./runner.js";
import { abortUpload, sweepUploads } from "./uploads.js";
import { sweepStorage } from "./assets.js";
import { checkAnchor, getAnchor } from "./anchors.js";
import { namesOf } from "./profiles.js";
import { normalizeWallet } from "./auth.js";
import { limitSummary, refusedSignIns, counts } from "./securityLog.js";
import { NOT_RETRYABLE, statusForStage } from "../services/pipeline.js";

const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export class OpsError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** What each kind of job is, in the words the site uses. */
export const JOB_LABELS: Record<string, string> = {
  transcribe: "Transcription", analyze: "Chapters and summary", inspect: "Thumbnails and video facts",
  embed: "Search passages", anchor_check: "Shelby store check", clip: "Clip", youtube_upload: "YouTube upload",
};

async function ownerNames(wallets: Array<string | null>) {
  const list = [...new Set(wallets.map((w) => normalizeWallet(w)).filter(Boolean) as string[])];
  return list.length ? namesOf(list).catch(() => new Map<string, string>()) : new Map<string, string>();
}

// ── jobs ────────────────────────────────────────────────────────────────────
export type JobFilter = "failed" | "queued" | "running" | "all";
export async function listJobsForAdmin(o: { filter?: unknown; limit?: unknown }) {
  const filter: JobFilter = ["failed", "queued", "running", "all"].includes(String(o.filter)) ? (o.filter as JobFilter) : "failed";
  const limit = Math.min(Math.max(Math.floor(n(o.limit)) || 100, 1), 300);
  const db = getDb();
  const [rows, tally] = await Promise.all([
    db.execute({
      sql: `SELECT j.*, v.title AS title, COALESCE(v.owner_wallet, s.account_address) AS owner
              FROM jobs j LEFT JOIN videos v ON v.id = j.video_id LEFT JOIN video_shelby s ON s.video_id = j.video_id
             ${filter === "all" ? "" : "WHERE j.status = ?"} ORDER BY j.updated_at DESC LIMIT ?`,
      args: filter === "all" ? [limit] : [filter, limit],
    }),
    db.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status"),
  ]);
  const list = rows.rows as any[];
  const names = await ownerNames(list.map((r) => r.owner));
  return {
    counts: Object.fromEntries((tally.rows as any[]).map((r) => [String(r.status), n(r.n)])),
    jobs: list.map((j) => ({
      id: String(j.id), videoId: String(j.video_id), title: s(j.title), owner: normalizeWallet(j.owner), ownerName: names.get(normalizeWallet(j.owner) ?? "") ?? null,
      kind: String(j.kind), label: JOB_LABELS[String(j.kind)] ?? String(j.kind), status: String(j.status),
      attempts: n(j.attempts), maxAttempts: n(j.max_attempts), error: s(j.error), errorCode: s(j.error_code),
      retryable: String(j.status) === "failed" && !NOT_RETRYABLE.has(String(j.error_code ?? "")),
      createdAt: n(j.created_at), updatedAt: n(j.updated_at),
    })),
  };
}
export async function retryJobById(id: string) {
  const r = await getDb().execute({ sql: "SELECT * FROM jobs WHERE id = ?", args: [id] });
  const j = r.rows[0] as any;
  if (!j) throw new OpsError(404, "not_found", "No job with that id.");
  if (String(j.status) !== "failed") throw new OpsError(409, "not_failed", "Only a failed job can be run again.");
  if (NOT_RETRYABLE.has(String(j.error_code ?? ""))) throw new OpsError(409, "not_retryable", `This failure cannot be fixed by running it again: ${j.error ?? "see the error"}.`);
  const job = await retryJob(String(j.video_id), String(j.kind));
  if (!job) throw new OpsError(409, "not_failed", "Only a failed job can be run again.");
  if (j.kind === "transcribe" || j.kind === "analyze") await store.update(String(j.video_id), { status: statusForStage(job.kind) }).catch(() => {});
  nudgeRunner();
  return { id: job.id, videoId: job.videoId, kind: job.kind };
}

// ── uploads ─────────────────────────────────────────────────────────────────
export async function listOpenUploadsForAdmin() {
  const r = await getDb().execute(`SELECT u.video_id, u.owner_wallet, u.filename, u.size_bytes, u.created_at, u.updated_at, v.title
                                     FROM uploads u LEFT JOIN videos v ON v.id = u.video_id
                                    WHERE u.status IN ('open', 'completing') ORDER BY u.created_at DESC LIMIT 200`);
  const rows = r.rows as any[];
  const names = await ownerNames(rows.map((x) => x.owner_wallet));
  return {
    uploads: rows.map((u) => ({
      videoId: String(u.video_id), title: s(u.title) ?? s(u.filename), filename: s(u.filename), sizeBytes: n(u.size_bytes),
      owner: normalizeWallet(u.owner_wallet), ownerName: names.get(normalizeWallet(u.owner_wallet) ?? "") ?? null,
      createdAt: n(u.created_at), updatedAt: n(u.updated_at),
    })),
  };
}
export async function discardUpload(videoId: string) {
  const ok = await abortUpload(videoId);
  if (!ok) throw new OpsError(409, "not_open", "That upload is not open any more.");
  return { videoId };
}

// ── Shelby stores ───────────────────────────────────────────────────────────
export async function listAnchorsForAdmin(o: { state?: unknown }) {
  const states = ["checking", "anchored", "lapsed", "missing", "unverified"];
  const state = states.includes(String(o.state)) ? String(o.state) : "problems";
  const db = getDb();
  const [rows, tally] = await Promise.all([
    db.execute({
      sql: `SELECT a.*, v.title AS title FROM anchors a LEFT JOIN videos v ON v.id = a.video_id
             ${state === "problems" ? "WHERE a.state != 'anchored'" : "WHERE a.state = ?"} ORDER BY a.updated_at DESC LIMIT 200`,
      args: state === "problems" ? [] : [state],
    }),
    db.execute("SELECT state, COUNT(*) AS n FROM anchors GROUP BY state"),
  ]);
  const list = rows.rows as any[];
  const names = await ownerNames(list.map((r) => r.wallet));
  return {
    counts: Object.fromEntries((tally.rows as any[]).map((r) => [String(r.state), n(r.n)])),
    anchors: list.map((a) => ({
      id: String(a.id), videoId: String(a.video_id), title: s(a.title), owner: normalizeWallet(a.wallet), ownerName: names.get(normalizeWallet(a.wallet) ?? "") ?? null,
      network: String(a.network), objectName: String(a.object_name), state: String(a.state), sizeBytes: a.size_bytes == null ? null : n(a.size_bytes),
      paidUntil: a.paid_until == null ? null : n(a.paid_until), checkedAt: a.checked_at == null ? null : n(a.checked_at), error: s(a.error), updatedAt: n(a.updated_at),
    })),
  };
}
export async function checkAnchorNow(id: string) {
  const a = await getAnchor(id);
  if (!a) throw new OpsError(404, "not_found", "No store with that id.");
  const v = await store.get(a.videoId);
  try {
    const r = await checkAnchor(id, { lastTry: true, expectedSize: v?.meta?.sizeBytes ?? null });
    return { id, state: r.state };
  } catch {
    throw new OpsError(503, "chain_unreachable", "Shelby could not be reached. Try again in a minute.");
  }
}

// ── housekeeping ────────────────────────────────────────────────────────────
export async function runHousekeeping() {
  const [files, uploads] = await Promise.all([sweepStorage(), sweepUploads()]);
  return { videosCleaned: files, uploadsDiscarded: uploads };
}

// ── security ────────────────────────────────────────────────────────────────
export async function securityOverview(currentAdminSession: string | null) {
  const db = getDb(); const now = Date.now();
  const [susp, wsess, asess, activity] = await Promise.all([
    db.execute("SELECT wallet, reason, suspended_at, admin_email FROM wallet_suspensions ORDER BY suspended_at DESC LIMIT 100"),
    db.execute({ sql: "SELECT COUNT(*) AS n, COUNT(DISTINCT wallet_address) AS w FROM sessions WHERE revoked_at IS NULL AND expires_at > ?", args: [now] }),
    db.execute({
      sql: `SELECT s.token_hash, s.created_at, s.last_seen_at, s.expires_at, u.email FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
             WHERE s.stage = 'full' AND s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_seen_at DESC`, args: [now] }),
    db.execute(`SELECT at, email, action, detail FROM admin_audit
                 WHERE action IN ('sign_in','sign_in_failed','sign_in_while_locked','locked','password_reset','reset_link_sent','reset_link_unknown_email','set_up','sign_out','admin_sessions_ended')
                 ORDER BY id DESC LIMIT 60`),
  ]);
  const IDLE = 2 * 3600_000;
  return {
    suspended: (susp.rows as any[]).map((r) => ({ wallet: String(r.wallet), reason: String(r.reason), at: n(r.suspended_at), by: s(r.admin_email) })),
    walletSessions: { open: n((wsess.rows[0] as any).n), wallets: n((wsess.rows[0] as any).w) },
    adminSessions: (asess.rows as any[]).filter((r) => now - n(r.last_seen_at) <= IDLE).map((r) => ({
      id: String(r.token_hash).slice(0, 12), email: String(r.email), createdAt: n(r.created_at), lastSeenAt: n(r.last_seen_at), endsAt: n(r.expires_at),
      current: currentAdminSession != null && String(r.token_hash) === currentAdminSession,
    })),
    adminSignIns: (activity.rows as any[]).map((r) => ({ at: n(r.at), email: s(r.email), action: String(r.action), detail: r.detail ? JSON.parse(String(r.detail)) : null })),
    memory: { ...counts(), limits: limitSummary().slice(0, 100), refusedSignIns: refusedSignIns().slice(0, 100) },
  };
}
/** Sign every other admin session out (this one stays). */
export async function endOtherAdminSessions(currentTokenHash: string) {
  const r = await getDb().execute({
    sql: "UPDATE admin_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND token_hash != ?",
    args: [Date.now(), currentTokenHash],
  });
  return { ended: r.rowsAffected };
}
