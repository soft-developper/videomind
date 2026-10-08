// src/lib/captions.ts
// vm_captions: captions made from the transcript's word timing.
//
// A Whisper sentence can run for 30 seconds, which is far too long to
// show as one caption. Here the transcript is cut again into captions a
// viewer can read:
//
//   * at most two lines of 42 characters, and at most 7 seconds
//   * a new caption at the end of a sentence, and wherever the speaker
//     pauses for 0.8 seconds or more
//   * each caption stays up for at least one second, unless the next one
//     starts sooner, and captions never overlap
//
// The words Whisper times carry no punctuation, so the text comes from
// the sentence and the times from its words, matched one to one. A
// sentence whose words do not match (or a transcript from before word
// timing) is timed by spreading its length over its characters.
import type { TranscriptSegment } from "../types/video.js";

export const MAX_LINE = 42;
const MAX_CHARS = MAX_LINE * 2;
const MAX_SECONDS = 7;
const MIN_SECONDS = 1;
const PAUSE = 0.8;

export interface Cue { start: number; end: number; text: string }
interface Token { text: string; start: number; end: number }

function tokensOf(seg: TranscriptSegment): Token[] {
  const parts = String(seg?.text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length || !Number.isFinite(seg.start)) return [];
  const words = Array.isArray(seg.words) ? seg.words : [];
  if (words.length === parts.length && words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end))) {
    return parts.map((text, i) => ({ text, start: words[i].start, end: Math.max(words[i].end, words[i].start) }));
  }
  const end = Number.isFinite(seg.end) && seg.end > seg.start ? seg.end : seg.start + parts.length * 0.3;
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  let at = 0;
  return parts.map((text) => {
    const s = seg.start + ((end - seg.start) * at) / total;
    at += text.length + 1;
    return { text, start: s, end: seg.start + ((end - seg.start) * at) / total };
  });
}

/** Two lines of about equal length when the text does not fit on one. */
export function wrap(text: string): string {
  if (text.length <= MAX_LINE) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) {
    if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  }
  return best === -1 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

const endsSentence = (t: string) => /[.?!…]["')\]]?$/.test(t);

export function buildCues(transcript: TranscriptSegment[]): Cue[] {
  const tokens = [...(Array.isArray(transcript) ? transcript : [])]
    .sort((a, b) => a.start - b.start)
    .flatMap(tokensOf);
  const cues: Cue[] = [];
  let cur: Token[] = [];
  const flush = () => {
    if (cur.length) cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: wrap(cur.map((t) => t.text).join(" ")) });
    cur = [];
  };
  for (const t of tokens) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const length = cur.reduce((a, x) => a + x.text.length + 1, 0) + t.text.length;
      if (length > MAX_CHARS || t.end - cur[0].start > MAX_SECONDS || t.start - last.end >= PAUSE) flush();
    }
    cur.push(t);
    // A sentence ends the caption, unless the caption would be only a word or two.
    if (endsSentence(t.text) && cur.reduce((a, x) => a + x.text.length + 1, 0) >= 16) flush();
  }
  flush();

  // Long enough to read, never over the next one.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1]?.start ?? Infinity;
    let end = Math.max(cues[i].end, cues[i].start + MIN_SECONDS);
    end = Math.min(end, next);
    if (end <= cues[i].start) end = Math.min(cues[i].start + 0.5, next > cues[i].start ? next : cues[i].start + 0.5);
    cues[i].end = end;
  }
  return cues.filter((c) => c.end > c.start);
}

const pad = (n: number, size = 2) => String(n).padStart(size, "0");
function stamp(sec: number, sep: "." | ","): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** WebVTT, for the player. "&", "<" and ">" are written as entities, as the format requires. */
export function toVtt(cues: Cue[]): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return "WEBVTT\n\n" + cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${esc(c.text)}\n`).join("\n");
}

/** SubRip, for editors and upload sites. */
export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
}
