// src/lib/generation.ts
// vm_generate: videos made from a prompt (Part 17b).
//
// A generation becomes an ordinary video. The steps:
//   1. startGeneration checks who may generate (off, a list of wallets, or
//      everyone), the day's budget in real money (the provider bills
//      VideoMind), the model and the prompt; makes a video record with
//      status "generating"; holds the price in credits (per second); and
//      queues one "generate" job.
//   2. The job sends the prompt to the provider, then checks it for about a
//      minute at a time; when it is not done it queues the next check and
//      lets other jobs run in between.
//   3. When the video is ready it is saved as the video's original, the hold
//      is charged, and the usual processing starts (thumbnail, transcript,
//      chapters, search), exactly as for an upload.
// A refused prompt, an account without balance, a video deleted while it is
// made, or a failure that retrying cannot fix: nothing is charged.
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import { store } from "./store.js";
import { enqueueJob, type Job } from "./jobs.js";
import { PermanentJobError, nudgeRunner } from "./runner.js";
import { saveOriginal } from "./assets.js";
import { reserve, settle, release, CreditsError } from "./credits.js";
import { submit, check, download, cancel, keySet, GenRefused, type GenModel, type ProviderRef, type ProviderId } from "./genProviders.js";
import type { VideoRecord } from "../types/video.js";

export const GENERATE_JOB = "generate";
const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => (v == null ? null : String(v));
const DAY_MS = 86_400_000;
/** One job checks for about this long, then hands over to the next. */
const SLICE_MS = Number(process.env.GEN_CHECK_SLICE_MS) || 60_000;
const CHECK_EVERY_MS = Number(process.env.GEN_CHECK_EVERY_MS) || 5_000;
/** Give up after this long at the provider. */
const GIVE_UP_MS = Number(process.env.GEN_GIVE_UP_MS) || 30 * 60_000;

export class GenError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
function walletOf(v: unknown): string {
  const w = normalizeWallet(v);
  if (!w) throw new GenError(400, "bad_wallet", "That is not a wallet address.");
  return w;
}

// ── models ───────────────────────────────────────────────────────────────────
export interface ModelRow extends GenModel {
  label: string; enabled: boolean; costUsdPerSecond: number; position: number; note: string | null;
  /** The server has the provider's key. */
  ready: boolean;
}
const rowToModel = (r: any): ModelRow => ({
  id: String(r.id), label: String(r.label), provider: String(r.provider) as ProviderId, endpoint: String(r.endpoint), resolution: String(r.resolution),
  minSeconds: n(r.min_seconds), maxSeconds: n(r.max_seconds), enabled: !!n(r.enabled), costUsdPerSecond: Number(r.cost_usd_per_second) || 0,
  position: n(r.position), note: s(r.note), ready: keySet(String(r.provider) as ProviderId),
});
export async function listModels(): Promise<ModelRow[]> {
  return ((await getDb().execute("SELECT * FROM gen_models ORDER BY position, id")).rows as any[]).map(rowToModel);
}
async function modelById(id: unknown): Promise<ModelRow | null> {
  if (typeof id !== "string") return null;
  const r = await getDb().execute({ sql: "SELECT * FROM gen_models WHERE id = ?", args: [id] });
  return r.rows[0] ? rowToModel(r.rows[0]) : null;
}
/** Dashboard: switch a model on or off, and what it costs VideoMind per second. */
export async function updateModel(id: string, body: unknown): Promise<ModelRow> {
  const b = (body ?? {}) as Record<string, unknown>;
  const m = await modelById(id);
  if (!m) throw new GenError(404, "not_found", "No model with that id.");
  const enabled = typeof b.enabled === "boolean" ? b.enabled : m.enabled;
  let cost = m.costUsdPerSecond;
  if (b.costUsdPerSecond !== undefined) {
    const x = Number(b.costUsdPerSecond);
    if (!Number.isFinite(x) || x < 0 || x > 10) throw new GenError(400, "bad_amount", "The cost must be a number of US dollars per second, from 0 to 10.");
    cost = x;
  }
  await getDb().execute({ sql: "UPDATE gen_models SET enabled = ?, cost_usd_per_second = ? WHERE id = ?", args: [enabled ? 1 : 0, cost, id] });
  return (await modelById(id))!;
}

// ── who may generate, and the day's budget ───────────────────────────────────
export type GenAccess = "off" | "allowlist" | "everyone";
export interface GenSettings { access: GenAccess; dailyUsd: number }
export async function getGenSettings(): Promise<GenSettings> {
  const r = await getDb().execute("SELECT id, value FROM credit_settings WHERE id IN ('gen_access', 'gen_daily_usd')");
  const m = new Map((r.rows as any[]).map((x) => [String(x.id), String(x.value)]));
  const access = (["off", "allowlist", "everyone"] as const).find((a) => a === m.get("gen_access")) ?? "off";
  const daily = Number(m.get("gen_daily_usd"));
  return { access, dailyUsd: Number.isFinite(daily) && daily >= 0 ? daily : 5 };
}
export async function setGenSettings(body: unknown): Promise<GenSettings> {
  const b = (body ?? {}) as Record<string, unknown>;
  const now = await getGenSettings();
  const access = b.access === undefined ? now.access : (["off", "allowlist", "everyone"] as const).find((a) => a === b.access);
  if (!access) throw new GenError(400, "bad_value", "Access must be off, allowlist or everyone.");
  let daily = now.dailyUsd;
  if (b.dailyUsd !== undefined) {
    const x = typeof b.dailyUsd === "string" && b.dailyUsd.trim() === "" ? NaN : Number(b.dailyUsd);
    if (!Number.isFinite(x) || x < 0 || x > 10_000) throw new GenError(400, "bad_amount", "The daily budget must be a number of US dollars from 0 to 10,000.");
    daily = x;
  }
  const db = getDb();
  for (const [id, value] of [["gen_access", access], ["gen_daily_usd", String(daily)]]) {
    await db.execute({ sql: "INSERT INTO credit_settings (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", args: [id, value] });
  }
  return getGenSettings();
}
export async function listAllowed(): Promise<Array<{ wallet: string; addedBy: string | null; createdAt: number }>> {
  const r = await getDb().execute("SELECT * FROM gen_allowlist ORDER BY created_at DESC");
  return (r.rows as any[]).map((x) => ({ wallet: String(x.wallet), addedBy: s(x.added_by), createdAt: n(x.created_at) }));
}
export async function allowWallet(walletIn: unknown, adminEmail: string) {
  const wallet = walletOf(walletIn);
  await getDb().execute({ sql: "INSERT INTO gen_allowlist (wallet, added_by, created_at) VALUES (?, ?, ?) ON CONFLICT(wallet) DO NOTHING", args: [wallet, adminEmail, Date.now()] });
  return { wallet };
}
export async function disallowWallet(walletIn: unknown) {
  const wallet = walletOf(walletIn);
  const r = await getDb().execute({ sql: "DELETE FROM gen_allowlist WHERE wallet = ?", args: [wallet] });
  if (!r.rowsAffected) throw new GenError(404, "not_found", "That wallet is not on the list.");
  return { wallet };
}
export async function mayGenerate(walletIn: string | null | undefined): Promise<boolean> {
  const wallet = normalizeWallet(walletIn);
  if (!wallet) return false;
  const { access } = await getGenSettings();
  if (access === "everyone") return true;
  if (access === "off") return false;
  return !!(await getDb().execute({ sql: "SELECT 1 FROM gen_allowlist WHERE wallet = ?", args: [wallet] })).rows.length;
}

const startOfUtcDay = (t: number) => t - (t % DAY_MS);
/** What counts against the budget: everything sent to a provider, or still on its way there. */
const SPENT_SQL = `SELECT COALESCE(SUM(cost_usd), 0) AS c FROM generations
                    WHERE created_at >= ? AND (status IN ('queued', 'running', 'succeeded') OR submitted_at IS NOT NULL)`;
export async function spentToday(now = Date.now()): Promise<number> {
  return Number((await getDb().execute({ sql: SPENT_SQL, args: [startOfUtcDay(now)] })).rows[0]?.c ?? 0) || 0;
}

// ── starting one ─────────────────────────────────────────────────────────────
export interface StartArgs { wallet: string; prompt: unknown; modelId: unknown; seconds?: unknown; aspect?: unknown; title?: unknown; visibility?: unknown; now?: number }

export async function startGeneration(a: StartArgs): Promise<{ videoId: string; generationId: string; costMicros: number }> {
  const wallet = walletOf(a.wallet);
  const now = a.now ?? Date.now();
  if (!(await mayGenerate(wallet))) throw new GenError(403, "not_allowed", "Video generation is not open to this wallet yet.");
  const prompt = typeof a.prompt === "string" ? a.prompt.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim() : "";
  if (prompt.length < 3) throw new GenError(400, "bad_prompt", "Describe the video you want.");
  if (prompt.length > 2000) throw new GenError(400, "bad_prompt", "Keep the description under 2,000 characters.");
  const model = await modelById(a.modelId);
  if (!model || !model.enabled) throw new GenError(400, "bad_model", "That model is not available.");
  if (!model.ready) throw new GenError(503, "model_unavailable", "That model cannot be used right now. Try another one.");
  const seconds = model.minSeconds === model.maxSeconds ? model.maxSeconds : Math.round(Number(a.seconds ?? Math.min(8, model.maxSeconds)));
  if (!Number.isFinite(seconds) || seconds < model.minSeconds || seconds > model.maxSeconds) {
    throw new GenError(400, "bad_seconds", `Choose a length from ${model.minSeconds} to ${model.maxSeconds} seconds.`);
  }
  const aspect = a.aspect === "9:16" ? "9:16" : "16:9";
  const visibility = a.visibility === "public" || a.visibility === "unlisted" ? a.visibility : "private";
  const title = (typeof a.title === "string" && a.title.trim() ? a.title.trim() : prompt).replace(/\s+/g, " ").slice(0, 120);
  const costUsd = Math.round(seconds * model.costUsdPerSecond * 10_000) / 10_000;

  const videoId = crypto.randomUUID();
  const generationId = crypto.randomUUID();
  const { dailyUsd } = await getGenSettings();
  // The budget is checked and taken in one statement, so two at once cannot pass it together.
  const ins = await getDb().execute({
    sql: `INSERT INTO generations (id, wallet, video_id, model_id, prompt, seconds, aspect, status, cost_usd, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ? WHERE (${SPENT_SQL}) + ? <= ?`,
    args: [generationId, wallet, videoId, model.id, prompt, seconds, aspect, costUsd, now, now, startOfUtcDay(now), costUsd, dailyUsd],
  });
  if (!ins.rowsAffected) throw new GenError(429, "budget_reached", "Video generation has reached today's limit. Try again tomorrow.");

  // Credits: the price per second, held until the video arrives.
  let holdId: string | null = null, costMicros = 0;
  try {
    const r = await reserve({ wallet, action: "generate_video", quantity: seconds, videoId, key: `generate:${generationId}`, ttlMs: GIVE_UP_MS + 2 * 3600_000, now });
    if (!r.free) { holdId = r.hold.id; costMicros = r.amountMicros; }
  } catch (e) {
    await getDb().execute({ sql: "UPDATE generations SET status = 'failed', error_code = 'no_credits', error = ?, finished_at = ?, updated_at = ? WHERE id = ?", args: ["Not enough credits.", now, now, generationId] });
    throw e;
  }
  const record: VideoRecord = {
    id: videoId, title, description: "", createdAt: now, status: "generating", ownerWallet: wallet,
    category: null, visibility,
    shelby: { videoBlobName: `videomind/videos/${videoId}/raw.mp4`, accountAddress: "", videoTxHash: "" },
    meta: { sizeBytes: 0, mimeType: "video/mp4", durationSeconds: seconds },
  };
  try {
    await store.set(videoId, record);
    await getDb().execute({ sql: "UPDATE generations SET hold_id = ?, updated_at = ? WHERE id = ?", args: [holdId, now, generationId] });
  } catch (e) {
    await release(holdId).catch(() => {});
    await getDb().execute({ sql: "UPDATE generations SET status = 'failed', error_code = 'server_error', error = 'The video could not be created.', finished_at = ?, updated_at = ? WHERE id = ?", args: [now, now, generationId] }).catch(() => {});
    throw e;
  }
  await enqueueJob({ videoId, kind: GENERATE_JOB, key: `${videoId}:${GENERATE_JOB}:0`, payload: { round: 0 } });
  nudgeRunner();
  return { videoId, generationId, costMicros };
}

// ── the job ──────────────────────────────────────────────────────────────────
interface GenRow {
  id: string; wallet: string; videoId: string; modelId: string; prompt: string; seconds: number; aspect: "16:9" | "9:16";
  status: string; ref: ProviderRef | null; holdId: string | null; submittedAt: number | null; createdAt: number;
}
const rowToGen = (r: any): GenRow => ({
  id: String(r.id), wallet: String(r.wallet), videoId: String(r.video_id), modelId: String(r.model_id), prompt: String(r.prompt),
  seconds: n(r.seconds), aspect: r.aspect === "9:16" ? "9:16" : "16:9", status: String(r.status),
  ref: r.provider_ref ? JSON.parse(String(r.provider_ref)) : null, holdId: s(r.hold_id), submittedAt: r.submitted_at == null ? null : n(r.submitted_at), createdAt: n(r.created_at),
});
async function genOfVideo(videoId: string): Promise<GenRow | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM generations WHERE video_id = ?", args: [videoId] });
  return r.rows[0] ? rowToGen(r.rows[0]) : null;
}
async function markGen(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  await getDb().execute({ sql: `UPDATE generations SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, args: [...keys.map((k) => fields[k] as any), Date.now(), id] });
}

/** A generation that ended without a video: nothing charged, the video marked. */
async function endWithout(g: GenRow, code: string, message: string) {
  const now = Date.now();
  await release(g.holdId).catch(() => {});
  await markGen(g.id, { status: "failed", error_code: code, error: message.slice(0, 1000), finished_at: now });
  await store.update(g.videoId, { status: "error" }).catch(() => {});
}

export function makeGenerateHandler(deps = { submit, check, download, cancel, now: () => Date.now(), sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) }) {
  return async function generate(job: Job): Promise<void> {
    const g = await genOfVideo(job.videoId);
    if (!g) throw new PermanentJobError("video_gone", "This generation no longer exists.");
    if (g.status === "succeeded" || g.status === "failed") return;
    const video = await store.get(g.videoId);
    if (!video) {
      if (g.ref) await deps.cancel(g.ref).catch(() => {});
      await release(g.holdId).catch(() => {});
      await markGen(g.id, { status: "failed", error_code: "video_gone", error: "The video was deleted while it was being made.", finished_at: deps.now() });
      return;
    }
    const model = await modelById(g.modelId);
    if (!model) throw new PermanentJobError("bad_model", "The model of this generation was removed.");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vm-generate-"));
    const file = path.join(dir, "generated.mp4");
    try {
      let ref = g.ref, written = false;
      try {
        if (!ref) {
          const r = await deps.submit(model, { prompt: g.prompt, seconds: g.seconds, aspect: g.aspect }, file);
          ref = r.ref; written = r.written;
          await markGen(g.id, { status: "running", provider_ref: JSON.stringify(ref), submitted_at: deps.now() });
        }
        if (!written) {
          // Check for a while; if it is still being made, hand over to a later job.
          const until = deps.now() + SLICE_MS;
          let state = await deps.check(ref);
          while (state.state === "running" && deps.now() < until) { await deps.sleep(CHECK_EVERY_MS); state = await deps.check(ref); }
          if (state.state === "running") {
            if (deps.now() - (g.submittedAt ?? deps.now()) > GIVE_UP_MS) {
              await deps.cancel(ref).catch(() => {});
              throw new PermanentJobError("timeout", "The provider did not finish the video in 30 minutes.");
            }
            const round = Number(job.payload?.round ?? 0) + 1;
            await enqueueJob({ videoId: g.videoId, kind: GENERATE_JOB, key: `${g.videoId}:${GENERATE_JOB}:${round}`, payload: { round }, runAfter: deps.now() + 10_000 });
            return;
          }
        }
        const got = written ? { seconds: null, expandedPrompt: null } : await deps.download(ref, file);
        const stat = await fs.stat(file);
        if (!stat.size) throw new Error("The provider sent an empty file.");
        await saveOriginal({ videoId: g.videoId, filePath: file, ext: ".mp4", contentType: "video/mp4", ownerWallet: g.wallet });
        // Charged for the seconds asked for, or fewer if fewer came back.
        const secs = got.seconds != null ? Math.min(g.seconds, Math.ceil(got.seconds)) : g.seconds;
        await settle(g.holdId, { quantity: secs }).catch((e) => console.error(`[generate] settling ${g.id}: ${e?.message ?? e}`));
        await markGen(g.id, { status: "succeeded", finished_at: deps.now(), expanded_prompt: got.expandedPrompt, bytes: stat.size });
        // From here it is an upload like any other.
        await enqueueJob({ videoId: g.videoId, kind: "inspect" });
        const { created } = await enqueueJob({ videoId: g.videoId, kind: "transcribe" });
        await store.update(g.videoId, { status: created ? "transcribing" : video.status, meta: { ...video.meta, sizeBytes: stat.size } });
        nudgeRunner();
      } catch (e: any) {
        if (e instanceof GenRefused) throw new PermanentJobError(e.code, e.message);
        throw e;
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/** The job failed for good: nothing charged, the video shows the failure. Called by the pipeline's final failure hook. */
export async function generationGaveUp(job: Job, f: { error: string; code: string }) {
  const g = await genOfVideo(job.videoId);
  if (!g || g.status === "succeeded" || g.status === "failed") return;
  await endWithout(g, f.code, f.error);
}

/** The video is being deleted: stop the generation and charge nothing. */
export async function releaseGeneration(videoId: string) {
  const g = await genOfVideo(videoId);
  if (!g || g.status === "succeeded" || g.status === "failed") return;
  if (g.ref) await cancel(g.ref).catch(() => {});
  await release(g.holdId).catch(() => {});
  await markGen(g.id, { status: "failed", error_code: "video_gone", error: "The video was deleted while it was being made.", finished_at: Date.now() });
}

// ── reading ──────────────────────────────────────────────────────────────────
/** What a video page shows about how the video was made. Null for an upload. */
export async function generationOf(videoId: string, forOwner: boolean) {
  const g = await getDb().execute({ sql: "SELECT g.*, m.label FROM generations g LEFT JOIN gen_models m ON m.id = g.model_id WHERE g.video_id = ?", args: [videoId] });
  const r = g.rows[0] as any;
  if (!r) return null;
  return { model: s(r.label) ?? String(r.model_id), seconds: n(r.seconds), aspect: String(r.aspect), status: String(r.status),
    prompt: forOwner ? String(r.prompt) : null, errorCode: forOwner ? s(r.error_code) : null, createdAt: n(r.created_at) };
}

/** What the generate page needs: may this wallet generate, the models, and the price. */
export async function generateInfo(walletIn: string | null | undefined) {
  const [allowed, models, settings, spent] = await Promise.all([mayGenerate(walletIn), listModels(), getGenSettings(), spentToday()]);
  return {
    allowed,
    budgetReached: settings.dailyUsd <= spent,
    models: models.filter((m) => m.enabled && m.ready).map((m) => ({ id: m.id, label: m.label, minSeconds: m.minSeconds, maxSeconds: m.maxSeconds, resolution: m.resolution })),
  };
}

/** The dashboard: settings, models, the day's spend, recent generations. */
export async function adminGeneration(now = Date.now()) {
  const [settings, models, spent, allowed, recent, totals] = await Promise.all([
    getGenSettings(), listModels(), spentToday(now), listAllowed(),
    getDb().execute("SELECT g.*, m.label FROM generations g LEFT JOIN gen_models m ON m.id = g.model_id ORDER BY g.created_at DESC LIMIT 30"),
    getDb().execute({ sql: "SELECT COUNT(*) AS c, COALESCE(SUM(seconds), 0) AS secs, COALESCE(SUM(cost_usd), 0) AS usd FROM generations WHERE status = 'succeeded' AND created_at >= ?", args: [now - 30 * DAY_MS] }),
  ]);
  const t = totals.rows[0] as any;
  return {
    settings, models, spentTodayUsd: spent, allowlist: allowed,
    last30: { videos: n(t.c), seconds: n(t.secs), costUsd: Number(t.usd) || 0 },
    recent: (recent.rows as any[]).map((r) => ({
      id: String(r.id), wallet: String(r.wallet), videoId: String(r.video_id), model: s(r.label) ?? String(r.model_id), prompt: String(r.prompt).slice(0, 300),
      seconds: n(r.seconds), costUsd: Number(r.cost_usd) || 0, status: String(r.status), errorCode: s(r.error_code), error: s(r.error),
      createdAt: n(r.created_at), finishedAt: r.finished_at == null ? null : n(r.finished_at),
    })),
  };
}

/** For the cost per unit on the Credits page: what one second cost VideoMind in 30 days. */
export async function generationUnitCost(now = Date.now()) {
  const r = await getDb().execute({ sql: "SELECT COALESCE(SUM(seconds), 0) AS secs, COALESCE(SUM(cost_usd), 0) AS usd FROM generations WHERE status = 'succeeded' AND created_at >= ?", args: [now - 30 * DAY_MS] });
  const secs = n((r.rows[0] as any).secs), usd = Number((r.rows[0] as any).usd) || 0;
  return { action: "generate_video", units: secs, costUsd: usd, perUnitUsd: secs > 0 ? usd / secs : null };
}

export { CreditsError };
