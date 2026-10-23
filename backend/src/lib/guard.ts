// src/lib/guard.ts
// vm_apiguard: request guards for the public API.
//
// What this closes:
//   1. Routes that acted on EVERY wallet when no wallet was sent
//      (delete all, list all, search all, global stats).
//   2. Unlimited calls to routes that spend money (Whisper, Claude) or
//      disk (2 GB uploads) or that delete records.
//
// What this does NOT do: prove the caller owns the wallet they name.
// That needs a wallet signature (sign in) and a frontend change. Until
// then, a caller who knows a wallet address can still act as it, inside
// the limits below.
//
// No new dependency. Counters live in memory, which is correct for a
// single backend instance. They reset when the service restarts.
import type { Request, Response, NextFunction, RequestHandler } from "express";
// vm_ops: limit hits are shown in the admin dashboard (memory only, callers as codes)
import { recordLimitHit } from "./securityLog.js";

const WALLET_RE = /^0x[0-9a-fA-F]{1,64}$/;

/** True for a well formed Aptos account address (0x + up to 64 hex). */
export function isWalletAddress(v: unknown): v is string {
  return typeof v === "string" && WALLET_RE.test(v);
}

/**
 * vm_callerip (Part 22b): who the caller is, for per caller limits, view
 * counting and the security log.
 *
 * The first X-Forwarded-For entry is whatever the caller typed: Render keeps
 * it and adds the real address after it (confirmed on api.vidzmind.xyz on
 * 23 Oct 2026). On Render (RENDER=true, set by Render) the service sits behind
 * Cloudflare, which sets True-Client-IP and CF-Connecting-IP to the real
 * visitor and does not let a caller forge them, so those are read first.
 * CLIENT_IP_HEADER overrides the list (comma separated header names).
 * Elsewhere (a local run) the connection's own address is used, so a typed
 * header means nothing. If Render ever sends neither header, the old first
 * X-Forwarded-For entry is used and a warning is logged once.
 */
const ipHeaders = (): string[] => {
  const set = process.env.CLIENT_IP_HEADER?.trim();
  if (set) return set.toLowerCase().split(",").map((h) => h.trim()).filter(Boolean);
  return process.env.RENDER === "true" ? ["true-client-ip", "cf-connecting-ip"] : [];
};
const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;
let warnedNoHeader = false;
export function clientKey(req: Request): string {
  const headers = ipHeaders();
  for (const h of headers) {
    const v = req.headers[h];
    const one = (Array.isArray(v) ? v[0] : v ?? "").trim();
    if (IP_RE.test(one)) return one;
  }
  if (headers.length) {
    if (!warnedNoHeader) { warnedNoHeader = true; console.warn(`[guard] none of ${headers.join(", ")} arrived; using the first X-Forwarded-For entry, which a caller can forge`); }
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff ?? "").split(",")[0].trim();
    return first || req.socket?.remoteAddress || "unknown";
  }
  return req.socket?.remoteAddress || "unknown";
}

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  buckets.forEach((b, k) => { if (b.resetAt <= now) buckets.delete(k); });
}

/** Seconds until the bucket frees up, or 0 if there is room for one more. */
function waitFor(key: string, max: number, now: number): number {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return 0;
  return b.count >= max ? Math.ceil((b.resetAt - now) / 1000) : 0;
}

function count(key: string, windowMs: number, now: number) {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + windowMs });
  else b.count += 1;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface LimitRule { max: number; windowMs: number }
export interface LimitOptions {
  /** bucket family, e.g. "ai". Routes sharing a name share the budget. */
  name: string;
  perClient: LimitRule;
  global: LimitRule;
  /** what the caller is told, e.g. "AI requests" */
  label: string;
}

/**
 * vm_limits: is there room for one more, without taking it? Answers 429 and
 * returns false when there is not. Pair with spendBudget once the request
 * has been accepted, so refused requests never use the budget.
 */
export function checkBudget(opts: LimitOptions, req: Request, res: Response, who?: string): boolean {
  registry.set(opts.name, opts);
  const now = Date.now();
  sweep(now);
  const wait = Math.max(
    waitFor(`${opts.name}:c:${who ?? clientKey(req)}`, opts.perClient.max, now),
    waitFor(`${opts.name}:g`, opts.global.max, now)
  );
  if (wait <= 0) return true;
  const mins = Math.max(1, Math.ceil(wait / 60));
  console.warn(`[guard] 429 family=${opts.name} caller=${clientKey(req)} wait=${wait}s`);
  recordLimitHit(opts.name, clientKey(req));
  res.setHeader("Retry-After", String(wait));
  res.status(429).json({ error: `Too many ${opts.label}. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.` });
  return false;
}
/** vm_limits: use one unit of budget for an accepted request (see checkBudget). `who` (a wallet) replaces the caller's address. */
export function spendBudget(opts: LimitOptions, req: Request, who?: string): void {
  const now = Date.now();
  count(`${opts.name}:c:${who ?? clientKey(req)}`, opts.perClient.windowMs, now);
  count(`${opts.name}:g`, opts.global.windowMs, now);
}

/**
 * Take one unit of budget for this request. Returns true if there was
 * room. Otherwise it has already answered 429 and returns false, and the
 * caller must stop. A rejected request does not consume budget.
 */
export function takeBudget(opts: LimitOptions, req: Request, res: Response): boolean {
  registry.set(opts.name, opts);
  const now = Date.now();
  sweep(now);
  const cKey = `${opts.name}:c:${clientKey(req)}`;
  const gKey = `${opts.name}:g`;
  const wait = Math.max(
    waitFor(cKey, opts.perClient.max, now),
    waitFor(gKey, opts.global.max, now)
  );
  if (wait > 0) {
    const mins = Math.max(1, Math.ceil(wait / 60));
    // Visible in the Render logs, so a limit that fires too early can be diagnosed.
    console.warn(`[guard] 429 family=${opts.name} caller=${clientKey(req)} wait=${wait}s`);
    recordLimitHit(opts.name, clientKey(req));
    res.setHeader("Retry-After", String(wait));
    res.status(429).json({
      error: `Too many ${opts.label}. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
    });
    return false;
  }
  count(cKey, opts.perClient.windowMs, now);
  count(gKey, opts.global.windowMs, now);
  return true;
}

// vm_admin_settings: every limit in use, as the server reads it (with any
// LIMIT_* setting applied), for the dashboard's Settings page.
const registry = new Map<string, LimitOptions>();
export const limitRules = (): LimitOptions[] => [...registry.values()];

/** Express middleware form of takeBudget. */
export function rateLimit(opts: LimitOptions): RequestHandler {
  registry.set(opts.name, opts);
  return (req: Request, res: Response, next: NextFunction) => {
    if (takeBudget(opts, req, res)) next();
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Chat, search, library assistant, learning paths: each call spends Claude tokens. */
export const AI_LIMIT: LimitOptions = {
  name: "ai",
  label: "AI requests",
  perClient: { max: envInt("LIMIT_AI_PER_CLIENT_10MIN", 20), windowMs: 10 * MIN },
  global:    { max: envInt("LIMIT_AI_GLOBAL_HOUR", 150),    windowMs: HOUR },
};
export const limitAi = rateLimit(AI_LIMIT);

/**
 * Starting the pipeline: each video spends a Whisper transcription and a
 * Claude analysis. vm_limits (Part 22a): checked when the upload opens, so
 * nobody sends a whole file only to be told to wait, and counted only when
 * the upload is accepted (checkBudget, then spendBudget). Money is guarded by
 * credits and the provider budgets (Part 20e); this guards the queue.
 */
export const PROCESS_LIMIT: LimitOptions = {
  name: "pipeline",
  label: "videos to process",
  perClient: { max: envInt("LIMIT_PIPELINE_PER_CLIENT_HOUR", 20), windowMs: HOUR },   // per wallet
  global:    { max: envInt("LIMIT_PIPELINE_GLOBAL_HOUR", 300),    windowMs: HOUR },
};
registry.set(PROCESS_LIMIT.name, PROCESS_LIMIT);   // listed on the dashboard before its first use
/** vm_limits: running a failed step again (its own budget, not the uploads'). */
export const limitRetry = rateLimit({
  name: "retry",
  label: "retries",
  perClient: { max: envInt("LIMIT_RETRY_PER_CLIENT_HOUR", 30), windowMs: HOUR },
  global:    { max: envInt("LIMIT_RETRY_GLOBAL_HOUR", 600),    windowMs: HOUR },
});
/** vm_limits: asking Shelby again whether a store is confirmed (reads only). */
export const limitAnchorCheck = rateLimit({
  name: "anchor_check",
  label: "Shelby checks",
  perClient: { max: envInt("LIMIT_ANCHOR_CHECK_PER_CLIENT_10MIN", 30), windowMs: 10 * MIN },
  global:    { max: envInt("LIMIT_ANCHOR_CHECK_GLOBAL_10MIN", 1000), windowMs: 10 * MIN },
});

/** Reserving an id and sending a file (up to 2 GB to disk). One upload uses two. */
export const limitUpload = rateLimit({
  name: "upload",
  label: "uploads",
  perClient: { max: envInt("LIMIT_UPLOAD_PER_CLIENT_HOUR", 30), windowMs: HOUR },
  global:    { max: envInt("LIMIT_UPLOAD_GLOBAL_HOUR", 120),    windowMs: HOUR },
});

/** Deleting records. */
export const limitDelete = rateLimit({
  name: "delete",
  label: "delete requests",
  perClient: { max: envInt("LIMIT_DELETE_PER_CLIENT_10MIN", 60), windowMs: 10 * MIN },
  global:    { max: envInt("LIMIT_DELETE_GLOBAL_HOUR", 300),     windowMs: HOUR },
});

/** Sign in attempts: nonce requests and signature checks. */
export const limitAuth = rateLimit({
  name: "auth",
  label: "sign in attempts",
  perClient: { max: envInt("LIMIT_AUTH_PER_CLIENT_10MIN", 30), windowMs: 10 * MIN },
  global:    { max: envInt("LIMIT_AUTH_GLOBAL_HOUR", 1000),    windowMs: HOUR },
});

/** Test hook: clear all counters. */
export function _resetLimits() { buckets.clear(); lastSweep = 0; }
