// src/services/search.ts
// vm_search: search across a library, down to the moment.
//
//   * A transcript is cut into passages of about a minute, never in the
//     middle of a sentence. Each passage is turned into an embedding with
//     OpenAI's text-embedding-3-small (1536 numbers) and saved in the
//     `passages` table, in the same Turso database, as an F32_BLOB.
//   * This happens in a job named "embed" that runs after transcription.
//     Like the thumbnail job, it is not a step the video page lists, and
//     its failure never marks a video as failed.
//   * A search embeds the question the same way and ranks the wallet's
//     passages by cosine distance (Turso's vector_distance_cos). Every
//     passage of the wallet is compared, so nothing is missed; Claude is
//     not called.
//   * A library question reads the passages that match it, from every
//     video, instead of whole transcripts of up to four videos.
import OpenAI from "openai";
import "dotenv/config";
import { getDb } from "../lib/db.js";
import { store } from "../lib/store.js";
import { enqueueJob, type Job } from "../lib/jobs.js";
import { PermanentJobError, nudgeRunner } from "../lib/runner.js";
import { ownerOf, recordUsage, withUsage } from "../lib/usage.js";
import type { TranscriptSegment } from "../types/video.js";

export const EMBED = "embed";
export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMENSIONS = 1536;

/** A passage ends at the first sentence boundary after this many seconds... */
const PASSAGE_SECONDS = 45;
/** ...or once it has this many characters, whichever comes first. */
const PASSAGE_CHARS = 1200;
/** Passages sent to OpenAI in one request. Far under its limits (2048 inputs, 300,000 tokens). */
const BATCH = 128;

let client: OpenAI | null = null;
function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 2 });
  return client;
}
/** Test hook. */
export function _resetSearch() { client = null; }

export interface Passage { seq: number; start: number; end: number; text: string }

/**
 * Join transcript sentences into passages of about 45 seconds. A passage
 * always starts and ends on a sentence, so a search lands where someone
 * starts speaking.
 */
export function makePassages(transcript: TranscriptSegment[]): Passage[] {
  const out: Passage[] = [];
  let cur: { start: number; end: number; parts: string[]; chars: number } | null = null;
  const close = () => {
    if (cur && cur.parts.length) out.push({ seq: out.length, start: cur.start, end: cur.end, text: cur.parts.join(" ") });
    cur = null;
  };
  for (const s of transcript) {
    const text = String(s?.text ?? "").replace(/\s+/g, " ").trim();
    if (!text || !Number.isFinite(s.start)) continue;
    if (!cur) cur = { start: s.start, end: s.end, parts: [], chars: 0 };
    cur.parts.push(text); cur.chars += text.length + 1; cur.end = Math.max(cur.end, s.end);
    if (cur.end - cur.start >= PASSAGE_SECONDS || cur.chars >= PASSAGE_CHARS) close();
  }
  close();
  return out;
}

/** Vectors as Turso takes them: the raw bytes of 32 bit floats. */
const asBlob = (v: number[]) => new Uint8Array(new Float32Array(v).buffer);

/** Embed texts, in batches, and record the tokens used. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const r = await openai().embeddings.create({ model: EMBED_MODEL, input: batch, dimensions: EMBED_DIMENSIONS });
    await recordUsage({ metric: "input_tokens", quantity: Number(r.usage?.prompt_tokens ?? 0), provider: "openai", model: EMBED_MODEL });
    const sorted = [...r.data].sort((a, b) => a.index - b.index);
    if (sorted.length !== batch.length) throw new Error(`Embeddings came back for ${sorted.length} of ${batch.length} passages.`);
    for (const d of sorted) {
      if (!Array.isArray(d.embedding) || d.embedding.length !== EMBED_DIMENSIONS) throw new Error("An embedding came back with the wrong size.");
      out.push(d.embedding);
    }
  }
  return out;
}

// ── the job ───────────────────────────────────────────────────────────────

/**
 * Queue the job for a video. A video transcribed again (after a retry)
 * gets its passages made again, so a finished job is restarted too.
 */
export async function queueEmbed(videoId: string): Promise<void> {
  const { job, created } = await enqueueJob({ videoId, kind: EMBED });
  if (!created && (job.status === "failed" || job.status === "succeeded")) {
    await getDb().execute({
      sql: `UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, error = NULL, error_code = NULL, finished_at = NULL, updated_at = ?
             WHERE video_id = ? AND kind = ? AND status IN ('failed', 'succeeded')`,
      args: [Date.now(), Date.now(), videoId, EMBED],
    });
  }
  nudgeRunner();
}

export async function embedHandler(job: Job) {
  const video = await store.get(job.videoId);
  if (!video) throw new PermanentJobError("video_gone", "The video was deleted.");
  const transcript = video.ai?.transcript;
  if (!Array.isArray(transcript)) throw new PermanentJobError("no_transcript", "There is no transcript to index.");
  const passages = makePassages(transcript);

  let vectors: number[][] = [];
  if (passages.length) {
    try {
      vectors = await withUsage(
        { feature: "embed", ownerWallet: ownerOf(video), videoId: job.videoId, jobId: job.id },
        () => embedTexts(passages.map((p) => p.text)));
    } catch (err: any) {
      const status = Number(err?.status);
      if (status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
        throw new PermanentJobError("bad_request", `Indexing was refused by the AI provider (${status}): ${String(err?.message ?? "").slice(0, 300)}`);
      }
      throw err;
    }
  }
  // The video may have been deleted while OpenAI worked.
  if (!(await store.get(job.videoId))) throw new PermanentJobError("video_gone", "The video was deleted.");

  // Old passages out, new ones in, in one write: a search never sees half a video.
  await getDb().batch([
    { sql: "DELETE FROM passages WHERE video_id = ?", args: [job.videoId] },
    ...passages.map((p, i) => ({
      sql: "INSERT INTO passages (video_id, seq, start_sec, end_sec, text, embedding) VALUES (?, ?, ?, ?, ?, vector32(?))",
      args: [job.videoId, p.seq, p.start, p.end, p.text, asBlob(vectors[i])],
    })),
  ], "write");
}

/**
 * Videos that were transcribed before this part. Queues up to `limit` of
 * them per call, oldest first, and returns how many.
 */
export async function backfillEmbed(limit = 25): Promise<number> {
  const res = await getDb().execute({
    sql: `SELECT v.id AS id FROM videos v
            JOIN video_ai a ON a.video_id = v.id
           WHERE v.status = 'ready' AND a.transcript IS NOT NULL AND a.transcript != '[]'
             AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.video_id = v.id AND j.kind = ?)
           ORDER BY v.created_at ASC LIMIT ?`,
    args: [EMBED, limit],
  });
  let queued = 0;
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const { created } = await enqueueJob({ videoId: String(r.id), kind: EMBED });
    if (created) queued++;
  }
  if (queued) console.log(`[search] queued ${queued} earlier video(s) for search`);
  return queued;
}

// ── searching ─────────────────────────────────────────────────────────────

export interface Hit { videoId: string; title: string; start: number; end: number; text: string; score: number; category?: string | null }

/** vm_search_page: narrow a search to some kinds of video, or to one collection. */
export interface SearchFilter { categories?: string[]; collectionId?: string }

/**
 * The passages of a wallet's ready videos closest to `query`, best first.
 * `score` is the cosine similarity (1 is identical).
 */
export async function findPassages(wallet: string, query: string, limit = 30, filter: SearchFilter = {}): Promise<Hit[]> {
  const [q] = await embedTexts([query]);
  const extra: string[] = [];
  const extraArgs: Array<string> = [];
  if (filter.categories?.length) {
    extra.push(`AND v.category IN (${filter.categories.map(() => "?").join(",")})`);
    extraArgs.push(...filter.categories);
  }
  if (filter.collectionId) {
    extra.push("AND EXISTS (SELECT 1 FROM collection_items ci WHERE ci.video_id = v.id AND ci.collection_id = ?)");
    extraArgs.push(filter.collectionId);
  }
  const res = await getDb().execute({
    sql: `SELECT p.video_id AS video_id, v.title AS title, v.category AS category, p.start_sec AS start_sec, p.end_sec AS end_sec, p.text AS text,
                 vector_distance_cos(p.embedding, vector32(?)) AS distance
            FROM passages p
            JOIN videos v ON v.id = p.video_id
            LEFT JOIN video_shelby s ON s.video_id = v.id
           WHERE (v.owner_wallet = ? OR s.account_address = ?) AND v.status = 'ready' ${extra.join(" ")}
           ORDER BY distance ASC
           LIMIT ?`,
    args: [asBlob(q), wallet, wallet, ...extraArgs, limit],
  });
  const floor = minScore();
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    videoId: String(r.video_id), title: String(r.title ?? "Untitled"), category: r.category == null ? null : String(r.category),
    start: Number(r.start_sec), end: Number(r.end_sec), text: String(r.text ?? ""),
    score: Math.round((1 - Number(r.distance)) * 1000) / 1000,
  })).filter((h) => h.score >= floor);
}

/**
 * vm_search_page: how alike a passage must be to the search to count as a
 * match (cosine similarity, 0 to 1). Without it every search lists every
 * video. 0.15 is a first guess, to be checked on real lectures
 * (SEARCH_MIN_SCORE).
 */
export function minScore(): number {
  const v = Number(process.env.SEARCH_MIN_SCORE);
  return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.15;
}

export interface SearchResult {
  videoId: string; title: string; score: number; category?: string | null; thumbUrl?: string | null;
  matches: Array<{ time: number; end: number; text: string; score: number }>;
}

/** Hits grouped by video: the best video first, at most `perVideo` moments each, in order of relevance. */
export function groupHits(hits: Hit[], perVideo = 3, maxVideos = 10): SearchResult[] {
  const by = new Map<string, SearchResult>();
  for (const h of hits) {
    let r = by.get(h.videoId);
    if (!r) { if (by.size >= maxVideos) continue; r = { videoId: h.videoId, title: h.title, score: h.score, category: h.category ?? null, matches: [] }; by.set(h.videoId, r); }
    if (r.matches.length < perVideo) r.matches.push({ time: h.start, end: h.end, text: h.text, score: h.score });
  }
  return [...by.values()];
}

/** How many of a wallet's ready videos are not searchable yet (being indexed, or never transcribed). */
export async function notIndexed(wallet: string): Promise<number> {
  const res = await getDb().execute({
    sql: `SELECT COUNT(*) AS c FROM videos v
            LEFT JOIN video_shelby s ON s.video_id = v.id
           WHERE (v.owner_wallet = ? OR s.account_address = ?) AND v.status = 'ready'
             AND NOT EXISTS (SELECT 1 FROM passages p WHERE p.video_id = v.id)
             AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.video_id = v.id AND j.kind = ? AND j.status = 'succeeded')`,
    args: [wallet, wallet, EMBED],
  });
  return Number((res.rows[0] as Record<string, unknown>)?.c ?? 0);
}

