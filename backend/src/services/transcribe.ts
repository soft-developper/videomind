// src/services/transcribe.ts
// vm_transcribe: transcription of a recording of any length.
//
//   1. The sound is taken out of the video once, as small mono audio,
//      and kept in storage next to the original (videos/<id>/audio.m4a).
//      The same pass notes every pause.
//   2. The sound is planned as pieces of about ten minutes, each ending in
//      a pause, so no sentence is cut in two (OpenAI's advice for long
//      recordings). One piece is about 4 MB, far below the 25 MB a
//      transcription request may carry.
//   3. Each piece is cut, sent to whisper-1 with word timing, and saved
//      the moment it comes back. The end of the piece before is passed
//      along as context. A restart, a deploy or Render putting the
//      service to sleep only repeats the piece that was in progress.
//   4. When every piece is in, they are joined into one transcript, with
//      every word at its time in the video.
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { InValue } from "@libsql/client";
import { getDb } from "../lib/db.js";
import { getStorage, ObjectMissingError } from "../lib/storage.js";
import { getAsset, saveDerived, type MediaAsset } from "../lib/assets.js";
import { extractSound, cutSound, MediaError, type Pause } from "../lib/media.js";
import { PermanentJobError } from "../lib/runner.js";
import type { TranscriptSegment, TranscriptWord } from "../types/video.js";

/** What one transcription request returns, with times from the start of the piece. */
export interface PieceResult {
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  words: Array<{ text: string; start: number; end: number }>;
  /** seconds the provider billed */
  duration: number;
  language?: string;
}

export interface TranscribeDeps {
  extractSound: typeof extractSound;
  cutSound: typeof cutSound;
  /** Transcribe one piece of sound. prompt is the end of the text before it. */
  transcribePiece: (filePath: string, prompt: string) => Promise<PieceResult>;
}

export function pieceSeconds(): number {
  const n = Number(process.env.TRANSCRIBE_CHUNK_SECONDS);
  return Number.isFinite(n) && n >= 10 ? n : 600;
}
export function maxSeconds(): number {
  const h = Number(process.env.TRANSCRIBE_MAX_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 4) * 3600;
}
const READ_SECONDS = 30 * 60;
/** How much of the text before a piece is passed along with it. Whisper reads only the end of a prompt. */
const PROMPT_CHARS = 500;

// ── planning ──────────────────────────────────────────────────────────────

export interface Piece { start: number; end: number }

/**
 * Cut [0, duration] into pieces of about `target` seconds. Each cut is
 * placed in the longest pause found in the `lookback` seconds before
 * the target (the later one when two are as long), and only where there
 * is no pause is the sound cut at the target itself. The last piece may run up to a minute over, rather than
 * leave a few seconds on their own.
 */
export function planPieces(duration: number, pauses: Pause[], target = pieceSeconds(), lookback = Math.min(120, target / 3)): Piece[] {
  if (!(duration > 0)) return [];
  const out: Piece[] = [];
  let start = 0;
  const slack = Math.min(60, target / 5);
  while (duration - start > target + slack) {
    const ideal = start + target;
    let best: Pause | null = null;
    for (const p of pauses) {
      const mid = (p.start + p.end) / 2;
      if (mid <= start + target / 2 || mid > ideal || mid < ideal - lookback) continue;
      // The longest pause wins; between pauses of the same length, the one nearer the target.
      if (!best || p.end - p.start >= best.end - best.start) best = p;
    }
    const cut = best ? round((best.start + best.end) / 2) : round(ideal);
    out.push({ start: round(start), end: cut });
    start = cut;
  }
  out.push({ start: round(start), end: round(duration) });
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── joining ───────────────────────────────────────────────────────────────

/**
 * Join the pieces into one transcript. Times move from "seconds into the
 * piece" to "seconds into the video". Every word is placed in the
 * segment it is spoken in; a word whisper put between segments goes to
 * the nearest one.
 */
export function joinPieces(pieces: Array<{ start: number; result: PieceResult }>): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const { start, result } of pieces) {
    const segs: TranscriptSegment[] = result.segments
      .map((s) => ({ start: r2(start + s.start), end: r2(start + s.end), text: s.text.trim(), words: [] as TranscriptWord[] }))
      .filter((s) => s.text.length > 0)
      .sort((a, b) => a.start - b.start);
    const words = result.words
      .map((w) => ({ text: w.text.trim(), start: r2(start + w.start), end: r2(start + w.end) }))
      .filter((w) => w.text.length > 0)
      .sort((a, b) => a.start - b.start);
    if (segs.length) {
      for (const w of words) {
        const mid = (w.start + w.end) / 2;
        let at = segs.findIndex((s) => mid >= s.start && mid < s.end);
        if (at < 0) {
          let gap = Infinity;
          segs.forEach((s, i) => { const d = mid < s.start ? s.start - mid : mid - s.end; if (d < gap) { gap = d; at = i; } });
        }
        segs[at].words!.push(w);
      }
    }
    for (const s of segs) if (!s.words!.length) delete s.words;
    out.push(...segs);
  }
  return out;
}

// ── pieces in the database ────────────────────────────────────────────────

interface PieceRow { idx: number; start: number; end: number; status: "pending" | "done"; text: string; result: PieceResult | null }

async function loadPieces(videoId: string): Promise<PieceRow[]> {
  const res = await getDb().execute({ sql: "SELECT * FROM transcript_chunks WHERE video_id = ? ORDER BY idx", args: [videoId] });
  return (res.rows as Array<Record<string, unknown>>).map((r) => {
    const done = String(r.status) === "done";
    let result: PieceResult | null = null;
    if (done) {
      try {
        result = {
          text: String(r.text ?? ""),
          segments: JSON.parse(String(r.segments_json ?? "[]")),
          words: JSON.parse(String(r.words_json ?? "[]")),
          duration: Number(r.billed_seconds ?? 0),
          language: r.language ? String(r.language) : undefined,
        };
      } catch { result = null; }
    }
    return { idx: Number(r.idx), start: Number(r.start_sec), end: Number(r.end_sec), status: done && result ? "done" : "pending", text: String(r.text ?? ""), result };
  });
}

/** Progress for the page: pieces done out of pieces planned. Null before the plan exists. */
export async function transcriptionProgress(videoId: string): Promise<{ done: number; total: number } | null> {
  const res = await getDb().execute({
    sql: "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done FROM transcript_chunks WHERE video_id = ?",
    args: [videoId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  const total = Number(row?.total ?? 0);
  return total ? { done: Number(row?.done ?? 0), total } : null;
}

async function savePlan(videoId: string, plan: Piece[]) {
  const now = Date.now();
  const stmts: Array<{ sql: string; args: InValue[] }> = [{ sql: "DELETE FROM transcript_chunks WHERE video_id = ?", args: [videoId] }];
  plan.forEach((p, idx) => stmts.push({
    sql: "INSERT INTO transcript_chunks (video_id, idx, start_sec, end_sec, status, updated_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    args: [videoId, idx, p.start, p.end, now],
  }));
  await getDb().batch(stmts, "write");
}

async function savePiece(videoId: string, idx: number, r: PieceResult) {
  await getDb().execute({
    sql: `UPDATE transcript_chunks SET status = 'done', text = ?, segments_json = ?, words_json = ?, language = ?, billed_seconds = ?, updated_at = ?
           WHERE video_id = ? AND idx = ?`,
    args: [r.text, JSON.stringify(r.segments), JSON.stringify(r.words), r.language ?? null, r.duration, Date.now(), videoId, idx],
  });
}

/** The pieces are no longer needed once the transcript is saved. */
export async function clearPieces(videoId: string) {
  await getDb().execute({ sql: "DELETE FROM transcript_chunks WHERE video_id = ?", args: [videoId] });
}

// ── the whole run ─────────────────────────────────────────────────────────

function rethrow(err: unknown): never {
  if (err instanceof ObjectMissingError) throw new PermanentJobError("source_missing", "The uploaded file is no longer in storage. Upload the video again.");
  if (err instanceof MediaError) {
    if (err.code === "no_audio") throw err;                                  // handled by the caller: a silent video is not a failure
    if (!err.retryable) throw new PermanentJobError(err.code, err.message);
  }
  throw err;
}

/** 14460 -> "4 hours 1 minute" */
export function spokenLength(seconds: number): string {
  const total = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(total / 60), m = total % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return h ? (m ? `${part(h, "hour")} ${part(m, "minute")}` : part(h, "hour")) : part(m, "minute");
}

/**
 * Transcribe the video whose original is `original` (or, for a video
 * from before storage existed, the file at `diskPath`). Returns the
 * joined transcript, or an empty one for a video without sound.
 * `transcribePiece` is called inside the caller's usage context, so
 * every billed second lands on the video's owner.
 */
export async function transcribeLong(args: {
  videoId: string; original: MediaAsset | null; diskPath?: string; ownerWallet: string | null; deps: TranscribeDeps;
}): Promise<TranscriptSegment[]> {
  const { videoId, deps } = args;
  const storage = getStorage();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vm-transcribe-"));
  try {
    // 1. The sound, unless it is already in storage and planned.
    let sound = await getAsset(videoId, "audio");
    let pieces = await loadPieces(videoId);
    if (sound && sound.driver !== storage.driver) sound = null;
    if (!sound || !pieces.length) {
      const out = path.join(dir, "audio.m4a");
      let extracted;
      try {
        if (args.original) {
          const url = await storage.signedUrl(args.original.key, READ_SECONDS);
          extracted = url ? await deps.extractSound(url, out) : await storage.withLocalFile(args.original.key, (p) => deps.extractSound(p, out));
        } else if (args.diskPath) {
          extracted = await deps.extractSound(args.diskPath, out);
        } else {
          throw new PermanentJobError("source_missing", "The uploaded file is no longer in storage. Upload the video again.");
        }
      } catch (err) {
        if (err instanceof MediaError && err.code === "no_audio") return [];
        rethrow(err);
      }
      if (extracted!.durationSeconds > maxSeconds()) {
        throw new PermanentJobError("too_long",
          `This video is ${spokenLength(extracted!.durationSeconds)} long. Transcription is limited to ${spokenLength(maxSeconds())} per video.`);
      }
      if (!(extracted!.durationSeconds > 0)) return [];
      sound = await saveDerived({ videoId, kind: "audio", filePath: out, contentType: "audio/mp4", ownerWallet: args.ownerWallet });
      // A plan that already exists stays: its pieces are times in the video, and some may be done.
      if (!pieces.length) {
        await savePlan(videoId, planPieces(extracted!.durationSeconds, extracted!.pauses));
        pieces = await loadPieces(videoId);
      }
    }

    // 2. Every piece that is not done yet, in order.
    for (const p of pieces) {
      if (p.status === "done") continue;
      const before = pieces.filter((q) => q.idx < p.idx && q.status === "done").pop();
      const prompt = (before?.text ?? "").slice(-PROMPT_CHARS);
      const file = path.join(dir, `piece-${p.idx}.m4a`);
      try {
        const url = await storage.signedUrl(sound.key, READ_SECONDS);
        if (url) await deps.cutSound(url, p.start, p.end - p.start, file);
        else await storage.withLocalFile(sound.key, (src) => deps.cutSound(src, p.start, p.end - p.start, file));
      } catch (err) {
        // Read from disk, a missing file is ObjectMissingError; read through a signed address, it is a 404.
        if (err instanceof ObjectMissingError || (err instanceof MediaError && err.code === "source_missing")) {
          // The sound went missing from storage (not the original: that was read when the sound was taken out). Take it out again on the next attempt; finished pieces are kept.
          await getDb().execute({ sql: "DELETE FROM media_assets WHERE id = ?", args: [sound.id] });
          throw new Error("The sound of this video was missing from storage. It will be taken out again.");
        }
        rethrow(err);
      }
      const result = await deps.transcribePiece(file, prompt);
      await fs.rm(file, { force: true }).catch(() => {});
      await savePiece(videoId, p.idx, result);
      p.status = "done"; p.result = result; p.text = result.text;
    }

    // 3. Join.
    return joinPieces(pieces.map((p) => ({ start: p.start, result: p.result! })));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
