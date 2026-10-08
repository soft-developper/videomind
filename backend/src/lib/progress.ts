// src/lib/progress.ts
// vm_progress: where a signed in viewer stopped in a video. One row per
// wallet and video, overwritten as they watch. Private to the wallet.
import { getDb } from "./db.js";

export interface Progress { videoId: string; positionSeconds: number; durationSeconds: number | null; updatedAt: number }

/** Closer than this to the start, nothing is worth resuming. */
export const RESUME_AFTER = 15;
/** Closer than this to the end of a video over a minute long (or past 95 percent), it counts as finished. */
export const DONE_BEFORE_END = 30;

export class ProgressError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "ProgressError"; }
}

/**
 * Has the viewer finished this video? Then it starts from the beginning
 * next time. The last 30 seconds count only for videos over a minute; a
 * short clip is finished at 95 percent.
 */
export function finished(position: number, duration: number | null | undefined): boolean {
  if (!duration || duration <= 0) return false;
  return position >= duration * 0.95 || (duration > 60 && position >= duration - DONE_BEFORE_END);
}

const rowTo = (r: Record<string, unknown>): Progress => ({
  videoId: String(r.video_id), positionSeconds: Number(r.position_sec),
  durationSeconds: r.duration_sec == null ? null : Number(r.duration_sec), updatedAt: Number(r.updated_at),
});

export async function saveProgress(wallet: string, videoId: string, body: any, length?: number | null): Promise<Progress> {
  const pos = body?.positionSeconds;
  if (typeof pos !== "number" || !Number.isFinite(pos) || pos < 0) throw new ProgressError("bad_time", "Say where in the video, in seconds.");
  let dur = body?.durationSeconds;
  if (dur != null && (typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0)) throw new ProgressError("bad_duration", "The length must be a number of seconds.");
  // The server's own length of the video wins over what the browser says.
  if (length && length > 0) dur = length;
  const position = Math.round(Math.min(pos, dur ?? pos) * 10) / 10;
  const now = Date.now();
  await getDb().execute({
    sql: `INSERT INTO watch_progress (wallet, video_id, position_sec, duration_sec, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(wallet, video_id) DO UPDATE SET position_sec = excluded.position_sec, duration_sec = excluded.duration_sec, updated_at = excluded.updated_at`,
    args: [wallet, videoId, position, dur ?? null, now],
  });
  return { videoId, positionSeconds: position, durationSeconds: dur ?? null, updatedAt: now };
}

export async function getProgress(wallet: string, videoId: string): Promise<Progress | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM watch_progress WHERE wallet = ? AND video_id = ?", args: [wallet, videoId] });
  return r.rows.length ? rowTo(r.rows[0] as Record<string, unknown>) : null;
}

/** Everything this wallet has started, most recent first. */
export async function listProgress(wallet: string, limit = 200): Promise<Progress[]> {
  const r = await getDb().execute({
    sql: "SELECT * FROM watch_progress WHERE wallet = ? ORDER BY updated_at DESC LIMIT ?",
    args: [wallet, limit],
  });
  return r.rows.map((x) => rowTo(x as Record<string, unknown>));
}

export async function clearProgress(wallet: string, videoId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM watch_progress WHERE wallet = ? AND video_id = ?", args: [wallet, videoId] });
}
