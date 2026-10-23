// src/lib/videoLength.ts
// vm_length (Part 22a): which length of a video to trust.
//
// The owner's browser may report a length (PATCH /api/videos/:id/duration),
// but that number is only a fallback for videos the server could not
// measure. Charges and limits never rest on it alone:
//
//   * lengthOf: the length the server measured with FFmpeg (media), else the
//     one reported, else where the transcript ends. For bounds: notes,
//     chapters, clips, watch places, views
//   * billedLength: what a price per minute or per 30 minutes is worked out
//     from. Never shorter than the transcript, which the server made itself,
//     so a short reported length cannot lower a charge
import type { VideoRecord } from "../types/video.js";

const positive = (n: unknown): number | null => {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : null;
};

/** Where the transcript ends, in seconds (0 without one). */
export function transcriptEnd(v: VideoRecord): number {
  let end = 0;
  for (const s of v.ai?.transcript ?? []) if (Number(s.end) > end) end = Number(s.end);
  return end;
}

/** The length FFmpeg measured on the server, if it did. */
export const measuredLength = (v: VideoRecord): number | null => positive(v.media?.durationSeconds);

/** The video's length for bounds, or null when nothing is known. */
export function lengthOf(v: VideoRecord): number | null {
  const end = transcriptEnd(v);
  return measuredLength(v) ?? positive(v.meta?.durationSeconds) ?? (end > 0 ? end + 1 : null);
}

/** The length charges are worked out from, in seconds. */
export function billedLength(v: VideoRecord): number {
  const known = measuredLength(v) ?? positive(v.meta?.durationSeconds) ?? 0;
  return Math.max(known, transcriptEnd(v));
}
