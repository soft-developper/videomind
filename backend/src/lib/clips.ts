// src/lib/clips.ts
// vm_clips: clips cut from a video by its owner.
//
// Two kinds (decided by the founder, 8 Oct 2026):
//   cut     copied straight from the original, no encoding. Ready in
//           seconds, up to 10 minutes long. It starts at the keyframe at or
//           before the chosen start, so it may begin a moment early. Its
//           captions come as a separate .srt.
//   social  encoded for social sites: vertical (9:16), square (1:1) or
//           16:9, at most 720p, captions drawn in. Up to 90 seconds. Slow
//           on a small server, so it is made in the background.
//
// The file is a media asset of kind "clip": it counts as stored bytes in
// the ledger, and it is deleted with the video.
import crypto from "crypto";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import { buildCues, toSrt, type Cue } from "./captions.js";
import { CAPTION_LINE, type ClipFrame } from "./media.js";
import type { TranscriptSegment, VideoRecord } from "../types/video.js";

export type ClipKind = "cut" | "social";
export type ClipStatus = "queued" | "making" | "ready" | "failed";
export const CLIP_JOB = "clip";

export const LIMITS = {
  cut: Number(process.env.CLIP_CUT_MAX_SECONDS) || 600,
  social: Number(process.env.CLIP_SOCIAL_MAX_SECONDS) || 90,
  minSeconds: 1,
  perVideo: 50,
  /** social clips started per wallet per day: each one is minutes of encoding */
  socialPerDay: Number(process.env.CLIP_SOCIAL_PER_DAY) || 20,
};

export interface Clip {
  id: string; videoId: string; wallet: string; kind: ClipKind; frame: ClipFrame; captions: boolean;
  startSeconds: number; endSeconds: number; title: string; status: ClipStatus;
  note: string | null; error: string | null; assetId: string | null; sizeBytes: number | null; fileName: string | null;
  createdAt: number; updatedAt: number;
}

function rowToClip(r: Record<string, unknown>): Clip {
  return {
    id: String(r.id), videoId: String(r.video_id), wallet: String(r.wallet), kind: String(r.kind) as ClipKind,
    frame: String(r.frame) as ClipFrame, captions: Number(r.captions) === 1,
    startSeconds: Number(r.start_sec), endSeconds: Number(r.end_sec), title: String(r.title), status: String(r.status) as ClipStatus,
    note: r.note ? String(r.note) : null, error: r.error ? String(r.error) : null, assetId: r.asset_id ? String(r.asset_id) : null,
    sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
    fileName: r.file_name ? String(r.file_name) : null, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

export class ClipError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const clock = (sec: number) => {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

export interface ClipRequest { kind: ClipKind; frame: ClipFrame; captions: boolean; startSeconds: number; endSeconds: number; title: string }

/** Check what the owner asked for against the video. Throws ClipError with a reason the page can show. */
export function parseClip(body: unknown, video: VideoRecord): ClipRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind;
  if (kind !== "cut" && kind !== "social") throw new ClipError(400, "bad_kind", "Choose a quick cut or a social clip.");
  const frame = (b.frame ?? (kind === "cut" ? "original" : "vertical")) as ClipFrame;
  const frames: ClipFrame[] = kind === "cut" ? ["original"] : ["vertical", "square", "landscape"];
  if (!frames.includes(frame)) throw new ClipError(400, "bad_frame", kind === "cut" ? "A quick cut keeps the original frame." : "Choose vertical, square or 16:9.");
  const start = Number(b.startSeconds), end = Number(b.endSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new ClipError(400, "bad_range", "Give a start and an end.");
  const length = video.meta?.durationSeconds ?? null;
  if (start < 0 || end <= start) throw new ClipError(400, "bad_range", "The end must come after the start.");
  if (length !== null && end > length + 0.5) throw new ClipError(400, "past_end", `The video is ${clock(length)} long.`);
  const seconds = end - start;
  if (seconds < LIMITS.minSeconds) throw new ClipError(400, "too_short", "A clip must be at least a second long.");
  const max = kind === "cut" ? LIMITS.cut : LIMITS.social;
  if (seconds > max) throw new ClipError(400, "too_long", `${kind === "cut" ? "A quick cut" : "A social clip"} can be up to ${clock(max)} long.`);
  const rawTitle = typeof b.title === "string" ? b.title.replace(/\s+/g, " ").trim() : "";
  if (rawTitle.length > 120) throw new ClipError(400, "title_too_long", "Keep the clip title to 120 characters.");
  const captions = kind === "social" ? b.captions !== false : false;
  return {
    kind, frame, captions, startSeconds: Math.round(start * 1000) / 1000, endSeconds: Math.round(Math.min(end, length ?? end) * 1000) / 1000,
    title: rawTitle || `${video.title}, ${clock(start)} to ${clock(end)}`,
  };
}

/** A safe file name for the download: the title, then the kind. */
export function fileNameFor(title: string, kind: ClipKind, frame: ClipFrame, ext: string): string {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 80) || "clip";
  return `${base}${kind === "social" ? `-${frame}` : ""}${ext}`;
}

export async function addClip(videoId: string, wallet: string, c: ClipRequest): Promise<Clip> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await getDb().execute({
    sql: `INSERT INTO clips (id, video_id, wallet, kind, frame, captions, start_sec, end_sec, title, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    args: [id, videoId, normalizeWallet(wallet) ?? wallet, c.kind, c.frame, c.captions ? 1 : 0, c.startSeconds, c.endSeconds, c.title, now, now],
  });
  return (await getClip(id))!;
}
export async function getClip(id: string): Promise<Clip | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM clips WHERE id = ?", args: [id] });
  return r.rows[0] ? rowToClip(r.rows[0] as Record<string, unknown>) : null;
}
export async function listClips(videoId: string): Promise<Clip[]> {
  const r = await getDb().execute({ sql: "SELECT * FROM clips WHERE video_id = ? ORDER BY created_at DESC, rowid DESC", args: [videoId] });
  return r.rows.map((x) => rowToClip(x as Record<string, unknown>));
}
export async function countClips(videoId: string): Promise<number> {
  const r = await getDb().execute({ sql: "SELECT COUNT(*) AS n FROM clips WHERE video_id = ? AND status != 'failed'", args: [videoId] });
  return Number((r.rows[0] as any).n);
}
export async function socialToday(wallet: string): Promise<number> {
  const r = await getDb().execute({
    sql: "SELECT COUNT(*) AS n FROM clips WHERE wallet = ? AND kind = 'social' AND created_at >= ?",
    args: [normalizeWallet(wallet) ?? wallet, Date.now() - 86_400_000],
  });
  return Number((r.rows[0] as any).n);
}
export async function updateClip(id: string, patch: Partial<{ status: ClipStatus; note: string | null; error: string | null; asset_id: string | null; size_bytes: number | null; file_name: string | null }>): Promise<void> {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  await getDb().execute({
    sql: `UPDATE clips SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    args: [...keys.map((k) => (patch as any)[k]), Date.now(), id],
  });
}
export async function deleteClipRow(id: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM clips WHERE id = ?", args: [id] });
}
export async function deleteClipsForVideo(videoId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM clips WHERE video_id = ?", args: [videoId] });
}

/**
 * The captions inside a clip's range, timed from the clip's start. Lines
 * are as long as the clip's frame has room for.
 */
export function cuesForRange(transcript: TranscriptSegment[] | undefined, start: number, end: number, frame: ClipFrame): Cue[] {
  if (!transcript?.length) return [];
  return buildCues(transcript, { maxLine: CAPTION_LINE[frame] })
    .filter((c) => c.end > start && c.start < end)
    .map((c) => ({ start: Math.max(0, c.start - start), end: Math.min(end, c.end) - start, text: c.text }))
    .filter((c) => c.end - c.start > 0.05);
}
export const srtForClip = (transcript: TranscriptSegment[] | undefined, c: Pick<Clip, "startSeconds" | "endSeconds" | "frame">) =>
  toSrt(cuesForRange(transcript, c.startSeconds, c.endSeconds, c.frame));

/** Which container a straight copy can go into, from what the file holds. */
export function copyFormat(media: VideoRecord["media"]): { format: "mp4" | "webm" | "matroska"; ext: string; type: string } {
  const v = (media?.videoCodec ?? "").toLowerCase(), a = (media?.audioCodec ?? "").toLowerCase();
  const mp4ok = (!v || ["h264", "hevc", "av1", "mpeg4"].includes(v)) && (!a || ["aac", "mp3", "ac3", "eac3", "alac", "opus"].includes(a));
  const webmok = (!v || ["vp8", "vp9", "av1"].includes(v)) && (!a || ["opus", "vorbis"].includes(a));
  if (["mp4", "mov"].includes(media?.container ?? "") && mp4ok) return { format: "mp4", ext: ".mp4", type: "video/mp4" };
  if (media?.container === "webm" || (webmok && !mp4ok)) return { format: "webm", ext: ".webm", type: "video/webm" };
  if (mp4ok) return { format: "mp4", ext: ".mp4", type: "video/mp4" };
  return { format: "matroska", ext: ".mkv", type: "video/x-matroska" };
}
