// src/lib/usage.ts
// vm_storage: the usage ledger.
//
// Every billable quantity is written down here as it happens: seconds of
// audio transcribed, AI tokens in and out, bytes put into storage and
// bytes removed. The ledger holds QUANTITIES only. Prices change, so
// money is worked out later from these rows, never stored in them.
//
// Each row says whose resource it was (owner_wallet), who caused it
// (actor_wallet, empty for a visitor), which video, which feature, and
// which provider and model did the work. Rows are only ever added.
//
// The context (who, which video, which feature) is set once at the edge,
// in a route or a job handler, with withUsage(). The code that talks to
// the AI provider just reports what the provider said it used.
import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import type { VideoRecord } from "../types/video.js";

export type UsageMetric =
  | "audio_seconds"
  | "input_tokens" | "output_tokens" | "cache_write_tokens" | "cache_read_tokens"
  | "bytes_stored" | "bytes_deleted";

const UNIT: Record<UsageMetric, string> = {
  audio_seconds: "seconds",
  input_tokens: "tokens", output_tokens: "tokens", cache_write_tokens: "tokens", cache_read_tokens: "tokens",
  bytes_stored: "bytes", bytes_deleted: "bytes",
};

export interface UsageContext {
  /** Feature that caused the usage: transcribe, analyze, ask, search, learn_paths, learn_ask, storage. */
  feature: string;
  /** Wallet that owns the resource. Billing is worked out per owner. */
  ownerWallet?: string | null;
  /** Wallet that triggered it. Empty for a visitor who is not signed in. */
  actorWallet?: string | null;
  videoId?: string | null;
  jobId?: string | null;
}

/** The wallet a video belongs to, in canonical form, or null for a record with no owner. */
export function ownerOf(video: Pick<VideoRecord, "ownerWallet" | "shelby">): string | null {
  return normalizeWallet(video.ownerWallet) ?? normalizeWallet(video.shelby?.accountAddress);
}

const context = new AsyncLocalStorage<UsageContext>();

/** Run fn with a usage context. Anything recorded inside is attributed to it. */
export function withUsage<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return context.run(ctx, fn);
}

export interface UsageEntry extends Partial<UsageContext> {
  metric: UsageMetric;
  quantity: number;
  provider?: string | null;
  model?: string | null;
  /**
   * Set this when the same event could be reported twice (for example
   * "stored:<asset id>"). A second row with the same key is ignored.
   */
  key?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Add rows to the ledger. Never throws: a ledger problem must not break
 * the request that caused the usage. It is logged loudly instead.
 */
export async function recordUsage(entries: UsageEntry | UsageEntry[]): Promise<number> {
  const list = (Array.isArray(entries) ? entries : [entries])
    .filter((e) => Number.isFinite(e.quantity) && e.quantity > 0);
  if (!list.length) return 0;
  const ctx = context.getStore();
  const now = Date.now();
  try {
    const rows = list.map((e) => {
      const feature = e.feature ?? ctx?.feature ?? "unattributed";
      if (feature === "unattributed") console.warn(`[usage] ${e.metric} recorded outside any usage context`);
      return {
        sql: `INSERT INTO usage_ledger
                (id, created_at, owner_wallet, actor_wallet, video_id, feature, metric, quantity, unit,
                 provider, model, job_id, idempotency_key, meta)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(idempotency_key) DO NOTHING`,
        args: [
          crypto.randomUUID(), now,
          e.ownerWallet ?? ctx?.ownerWallet ?? null,
          e.actorWallet ?? ctx?.actorWallet ?? null,
          e.videoId ?? ctx?.videoId ?? null,
          feature, e.metric, e.quantity, UNIT[e.metric],
          e.provider ?? null, e.model ?? null,
          e.jobId ?? ctx?.jobId ?? null,
          e.key ?? null,
          e.meta ? JSON.stringify(e.meta) : null,
        ],
      };
    });
    const res = await getDb().batch(rows, "write");
    return res.reduce((n, r) => n + r.rowsAffected, 0);
  } catch (err: any) {
    console.error(`[usage] FAILED to record ${list.map((e) => `${e.metric}=${e.quantity}`).join(", ")}: ${err?.message ?? err}`);
    return 0;
  }
}

/**
 * Record what Claude reports for one Messages API answer. Cached tokens
 * are reported by the API separately from input_tokens, so they are
 * separate rows here too.
 */
export async function recordClaudeUsage(message: { id?: string; model?: string; usage?: unknown }): Promise<void> {
  const u = (message?.usage ?? {}) as Record<string, unknown>;
  const base = { provider: "anthropic", model: message?.model ?? null, meta: message?.id ? { requestId: message.id } : null };
  await recordUsage([
    { ...base, metric: "input_tokens", quantity: Number(u.input_tokens ?? 0) },
    { ...base, metric: "output_tokens", quantity: Number(u.output_tokens ?? 0) },
    { ...base, metric: "cache_write_tokens", quantity: Number(u.cache_creation_input_tokens ?? 0) },
    { ...base, metric: "cache_read_tokens", quantity: Number(u.cache_read_input_tokens ?? 0) },
  ]);
}

/** Record the length of audio one transcription request processed. */
export async function recordTranscriptionUsage(seconds: unknown, model: string): Promise<void> {
  await recordUsage({ metric: "audio_seconds", quantity: Number(seconds ?? 0), provider: "openai", model });
}

export interface UsageTotal { feature: string; metric: string; unit: string; total: number; events: number }

/** Totals for one owner since a point in time, grouped by feature and metric. */
export async function usageTotals(ownerWallet: string, sinceMs: number): Promise<UsageTotal[]> {
  const res = await getDb().execute({
    sql: `SELECT feature, metric, unit, SUM(quantity) AS total, COUNT(*) AS events
            FROM usage_ledger
           WHERE owner_wallet = ? AND created_at >= ?
           GROUP BY feature, metric, unit
           ORDER BY feature, metric`,
    args: [ownerWallet, sinceMs],
  });
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return { feature: String(row.feature), metric: String(row.metric), unit: String(row.unit), total: Number(row.total), events: Number(row.events) };
  });
}

/** Bytes this owner has in storage right now: everything stored minus everything deleted. */
export async function storedBytes(ownerWallet: string): Promise<number> {
  const res = await getDb().execute({
    sql: `SELECT COALESCE(SUM(CASE metric WHEN 'bytes_stored' THEN quantity WHEN 'bytes_deleted' THEN -quantity ELSE 0 END), 0) AS bytes
            FROM usage_ledger WHERE owner_wallet = ?`,
    args: [ownerWallet],
  });
  return Math.max(0, Number((res.rows[0] as Record<string, unknown>).bytes));
}

// vm_knowledge: a shared video answers questions from anyone who has the
// link, and every answer is paid for by the video's owner. This counts
// the answers given to people other than the owner in the last day, so a
// link passed around widely cannot run up the owner's bill without limit.
// One answer writes one output_tokens row, so rows are answers.
export const ASK_WINDOW_MS = 24 * 3600_000;
export function askBudgetPerVideo(): number {
  const raw = process.env.ASK_BUDGET_PER_VIDEO_DAY;
  if (raw == null || raw.trim() === "") return 100;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
}
export async function visitorAnswersToday(videoId: string, ownerWallet: string | null): Promise<number> {
  const res = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM usage_ledger
           WHERE video_id = ? AND feature = 'ask' AND metric = 'output_tokens' AND created_at >= ?
             AND COALESCE(actor_wallet, '') != ?`,
    args: [videoId, Date.now() - ASK_WINDOW_MS, ownerWallet ?? ""],
  });
  return Number((res.rows[0] as Record<string, unknown> | undefined)?.n ?? 0);
}
