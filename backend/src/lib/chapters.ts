// src/lib/chapters.ts
// vm_chapters: the owner's own chapters. What the editor sends is checked
// here before it replaces the chapters the analysis suggested.
import type { Chapter } from "../types/video.js";

export const MAX_CHAPTERS = 100;
export const MAX_TITLE = 120;
export const MAX_SUMMARY = 1000;

export class ChapterError extends Error {
  constructor(public code: string, message: string, public index?: number) { super(message); this.name = "ChapterError"; }
}

/** 90 -> "1:30", 3725 -> "1:02:05" */
export function clock(sec: number): string {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Check and tidy a list of chapters. `length` is how long the video is,
 * when known: no chapter may start at or after its end. Returns the
 * chapters in order of their start.
 */
export function parseChapters(body: unknown, length?: number | null): Chapter[] {
  const list = (body as { chapters?: unknown })?.chapters;
  if (!Array.isArray(list)) throw new ChapterError("bad_chapters", "Send the chapters as a list.");
  if (list.length > MAX_CHAPTERS) throw new ChapterError("too_many", `A video can have at most ${MAX_CHAPTERS} chapters.`);
  const out: Chapter[] = list.map((c: any, i: number) => {
    const title = typeof c?.title === "string" ? c.title.replace(/\s+/g, " ").trim() : "";
    if (!title) throw new ChapterError("no_title", `Chapter ${i + 1} needs a title.`, i);
    if (title.length > MAX_TITLE) throw new ChapterError("title_too_long", `Chapter ${i + 1}: keep the title under ${MAX_TITLE} characters.`, i);
    const start = c?.startSeconds;
    if (typeof start !== "number" || !Number.isFinite(start) || start < 0) throw new ChapterError("bad_time", `Chapter ${i + 1} needs a start time.`, i);
    if (length && length > 0 && start >= length) {
      throw new ChapterError("after_end", `Chapter ${i + 1} starts at ${clock(start)}, after the video ends (${clock(length)}).`, i);
    }
    const summary = c?.summary == null ? "" : typeof c.summary === "string" ? c.summary.trim() : null;
    if (summary === null) throw new ChapterError("bad_summary", `Chapter ${i + 1}: the summary must be text.`, i);
    if (summary.length > MAX_SUMMARY) throw new ChapterError("summary_too_long", `Chapter ${i + 1}: keep the summary under ${MAX_SUMMARY} characters.`, i);
    return { title, startSeconds: Math.round(start * 10) / 10, summary };
  });
  const sorted = out.map((c, i) => ({ c, i })).sort((a, b) => a.c.startSeconds - b.c.startSeconds);
  for (let k = 1; k < sorted.length; k++) {
    if (Math.floor(sorted[k].c.startSeconds) === Math.floor(sorted[k - 1].c.startSeconds)) {
      throw new ChapterError("same_time", `Two chapters start at ${clock(sorted[k].c.startSeconds)}. Move one of them.`, sorted[k].i);
    }
  }
  return sorted.map((x) => x.c);
}
