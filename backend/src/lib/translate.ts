// src/lib/translate.ts
// vm_translate: a video's transcript in other languages (Part 18a).
//
// The owner picks a language in the video's workspace; the transcript is
// translated by Claude, line by line, with each line keeping the times of
// the line it came from. Captions are cut from the translated lines the
// same way they are cut from the spoken ones, so every viewer can choose
// them in the player, on the shared page and in Presentation Mode.
//
//   * Languages: the five the site speaks (en, es, fr, ar, pt), less the
//     one spoken in the video. Whisper names the spoken language when the
//     video is transcribed; for older videos Claude names it while it
//     translates, and a video already in the chosen language stops there,
//     with nothing charged.
//   * Paid by the owner, per minute of the video, once per language: the
//     price is held when the owner asks, charged when the translation is
//     done, and released when it fails for good or is removed.
//   * The work is saved after every batch of lines, so a restart repeats
//     one batch at most. The summary, chapters and key moments are
//     translated last, and again (free) when the owner edits the chapters.
import crypto from "node:crypto";
import { getDb } from "./db.js";
import { store } from "./store.js";
import { enqueueJob, type Job } from "./jobs.js";
import { nudgeRunner, PermanentJobError } from "./runner.js";
import { reserve, settle, release } from "./credits.js";
import { withUsage, ownerOf } from "./usage.js";
import { askClaude, obj, str, num, list, ClaudeError } from "../services/claude.js";
import type { Chapter, Highlight, TranscriptSegment, VideoRecord } from "../types/video.js";
import { billedLength } from "./videoLength.js";

export const TRANSLATE_JOB = "translate";
export const LANGS = ["en", "es", "fr", "ar", "pt"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

/** How each language is written, the same variants as the site's own (claude/language-plan.md). */
const WRITE_AS: Record<Lang, string> = {
  en: "English",
  es: "Spanish, written neutrally for Latin America (usted for formal address, no regional slang)",
  fr: "French, international (as written in France, without regional expressions)",
  ar: "Modern Standard Arabic, with Western digits (0 to 9) for numbers",
  pt: "Brazilian Portuguese",
};
export const LANG_NAME: Record<Lang, string> = { en: "English", es: "Spanish", fr: "French", ar: "Arabic", pt: "Portuguese" };

/** Whisper names the language in English words; the codes the rest of the site uses. */
const WHISPER: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", arabic: "ar", portuguese: "pt", german: "de", italian: "it", dutch: "nl",
  russian: "ru", ukrainian: "uk", polish: "pl", turkish: "tr", chinese: "zh", japanese: "ja", korean: "ko", hindi: "hi",
  urdu: "ur", bengali: "bn", indonesian: "id", malay: "ms", vietnamese: "vi", thai: "th", persian: "fa", hebrew: "he",
  swahili: "sw", yoruba: "yo", hausa: "ha", greek: "el", swedish: "sv", norwegian: "no", danish: "da", finnish: "fi",
  czech: "cs", romanian: "ro", hungarian: "hu", tagalog: "tl", tamil: "ta", telugu: "te", marathi: "mr", punjabi: "pa",
};
export function languageCode(name: unknown): string | null {
  const s = String(name ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^[a-z]{2}$/.test(s)) return s;
  return WHISPER[s] ?? null;
}

// ── the spoken language ─────────────────────────────────────────────────────

export async function spokenLanguage(videoId: string): Promise<string | null> {
  const r = await getDb().execute({ sql: "SELECT spoken FROM video_languages WHERE video_id = ?", args: [videoId] });
  return r.rows[0] ? (String((r.rows[0] as any).spoken ?? "") || null) : null;
}

export async function setSpokenLanguage(videoId: string, code: string | null, how: "whisper" | "claude"): Promise<void> {
  if (!code) return;
  await getDb().execute({
    sql: `INSERT INTO video_languages (video_id, spoken, how, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(video_id) DO UPDATE SET spoken = excluded.spoken, how = excluded.how, updated_at = excluded.updated_at`,
    args: [videoId, code, how, Date.now()],
  });
}

/**
 * Called once a transcription is complete, before its pieces are cleared:
 * the language Whisper heard in most of the pieces (by their length).
 */
export async function rememberSpokenLanguage(videoId: string): Promise<void> {
  const r = await getDb().execute({
    sql: `SELECT language, SUM(end_sec - start_sec) AS secs FROM transcript_chunks
          WHERE video_id = ? AND status = 'done' AND language IS NOT NULL GROUP BY language ORDER BY secs DESC LIMIT 1`,
    args: [videoId],
  });
  const code = r.rows[0] ? languageCode((r.rows[0] as any).language) : null;
  await setSpokenLanguage(videoId, code, "whisper");
}

// ── rows ─────────────────────────────────────────────────────────────────

export type TranslationStatus = "queued" | "translating" | "done" | "failed";
export interface Translation {
  videoId: string; lang: Lang; status: TranslationStatus;
  segments: TranscriptSegment[]; summary: string | null; chapters: Chapter[] | null; highlights: Highlight[] | null;
  chaptersOf: string | null; done: number; total: number;
  wallet: string | null; holdId: string | null; error: string | null; errorCode: string | null;
  round: number; createdAt: number; updatedAt: number;
}

const parse = <T>(v: unknown, d: T): T => { try { return v == null ? d : (JSON.parse(String(v)) as T); } catch { return d; } };
function rowTo(r: any): Translation {
  return {
    videoId: String(r.video_id), lang: String(r.lang) as Lang, status: String(r.status) as TranslationStatus,
    segments: parse(r.segments_json, []), summary: r.summary == null ? null : String(r.summary),
    chapters: parse(r.chapters_json, null), highlights: parse(r.highlights_json, null),
    chaptersOf: r.chapters_of == null ? null : String(r.chapters_of),
    done: Number(r.done ?? 0), total: Number(r.total ?? 0),
    wallet: r.wallet == null ? null : String(r.wallet), holdId: r.hold_id == null ? null : String(r.hold_id),
    error: r.error == null ? null : String(r.error), errorCode: r.error_code == null ? null : String(r.error_code),
    round: Number(r.round ?? 0), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

export async function getTranslation(videoId: string, lang: string): Promise<Translation | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM transcript_translations WHERE video_id = ? AND lang = ?", args: [videoId, lang] });
  return r.rows[0] ? rowTo(r.rows[0]) : null;
}

export async function listTranslations(videoId: string): Promise<Translation[]> {
  const r = await getDb().execute({ sql: "SELECT * FROM transcript_translations WHERE video_id = ? ORDER BY created_at", args: [videoId] });
  return r.rows.map(rowTo);
}

async function patch(videoId: string, lang: string, round: number, f: Record<string, unknown>): Promise<boolean> {
  const keys = Object.keys(f);
  const r = await getDb().execute({
    sql: `UPDATE transcript_translations SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE video_id = ? AND lang = ? AND round = ?`,
    args: [...keys.map((k) => f[k] as any), Date.now(), videoId, lang, round],
  });
  return r.rowsAffected > 0;
}

/** A fingerprint of the chapters and key moments, so translated ones that no longer match are not shown. */
export function insightsOf(v: VideoRecord): string {
  const a = v.ai ?? {};
  return crypto.createHash("sha1").update(JSON.stringify([a.summary ?? "", a.chapters ?? [], a.highlights ?? []])).digest("hex").slice(0, 16);
}

/** The length the owner pays for (vm_length: the measured length, never shorter than the transcript). */
export function minutesOf(v: VideoRecord): number {
  return billedLength(v) / 60;
}

// ── asking for one ──────────────────────────────────────────────────────────

export class TranslateError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** A translation is held for this long; a long video in a busy queue still finishes well inside it. */
const HOLD_MS = 3 * 24 * 3600_000;

/**
 * The owner asks for a language. Holds its price (CreditsError 402 when the
 * owner cannot pay), saves the row and queues the work. A language already
 * being made or made is given back as it is; a failed one starts again.
 */
export async function startTranslation(video: VideoRecord, wallet: string, lang: unknown): Promise<Translation> {
  if (!isLang(lang)) throw new TranslateError(400, "bad_language", "Choose English, Spanish, French, Arabic or Portuguese.");
  if (video.removed) throw new TranslateError(409, "removed", "This video was taken down, so it cannot be translated.");
  if (video.status !== "ready") throw new TranslateError(409, "not_ready", "A video can be translated once it is ready.");
  const transcript = video.ai?.transcript ?? [];
  if (!transcript.some((s) => s.text?.trim())) throw new TranslateError(409, "no_transcript", "Nothing is said in this video, so there is nothing to translate.");
  if ((await spokenLanguage(video.id)) === lang) throw new TranslateError(409, "same_language", `This video is already in ${LANG_NAME[lang]}.`);

  const have = await getTranslation(video.id, lang);
  if (have && have.status !== "failed") return have;

  const now = Date.now();
  const round = (have?.round ?? 0) + 1;
  const r = await reserve({
    wallet, action: "translate", quantity: minutesOf(video), videoId: video.id,
    key: `translate:${video.id}:${lang}:${round}`, ttlMs: HOLD_MS,
  });
  const holdId = r.free ? null : r.hold.id;
  try {
    const total = transcript.length;
    if (have) {
      await getDb().execute({
        sql: `UPDATE transcript_translations SET status = 'queued', round = ?, wallet = ?, hold_id = ?, error = NULL, error_code = NULL,
                segments_json = NULL, summary = NULL, chapters_json = NULL, highlights_json = NULL, chapters_of = NULL,
                done = 0, total = ?, minutes = ?, created_at = ?, updated_at = ? WHERE video_id = ? AND lang = ?`,
        args: [round, wallet, holdId, total, minutesOf(video), now, now, video.id, lang],
      });
    } else {
      await getDb().execute({
        sql: `INSERT INTO transcript_translations (video_id, lang, status, round, wallet, hold_id, done, total, minutes, created_at, updated_at)
              VALUES (?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?, ?)`,
        args: [video.id, lang, round, wallet, holdId, total, minutesOf(video), now, now],
      });
    }
    await enqueueJob({ videoId: video.id, kind: TRANSLATE_JOB, key: `${video.id}:${TRANSLATE_JOB}:${lang}:${round}`, payload: { lang, round }, maxAttempts: 3 });
  } catch (e) {
    if (holdId) await release(holdId).catch(() => {});
    throw e;
  }
  nudgeRunner();
  return (await getTranslation(video.id, lang))!;
}

/** The owner removes a language. Anything held for it is released; a batch in progress stops at the next save. */
export async function removeTranslation(videoId: string, lang: string): Promise<boolean> {
  const t = await getTranslation(videoId, lang);
  if (!t) return false;
  if (t.status !== "done" && t.holdId) await release(t.holdId).catch(() => {});
  await getDb().execute({ sql: "DELETE FROM transcript_translations WHERE video_id = ? AND lang = ?", args: [videoId, lang] });
  return true;
}

/** The video is deleted: release what is held and remove every language. */
export async function dropTranslations(videoId: string): Promise<void> {
  for (const t of await listTranslations(videoId)) if (t.status !== "done" && t.holdId) await release(t.holdId).catch(() => {});
  await getDb().batch([
    { sql: "DELETE FROM transcript_translations WHERE video_id = ?", args: [videoId] },
    { sql: "DELETE FROM video_languages WHERE video_id = ?", args: [videoId] },
  ], "write");
}

/** The owner changed the chapters: each finished language gets them again, free. */
export async function refreshInsights(video: VideoRecord): Promise<void> {
  const fp = insightsOf(video);
  for (const t of await listTranslations(video.id)) {
    if (t.status !== "done" || t.chaptersOf === fp) continue;
    await enqueueJob({ videoId: video.id, kind: TRANSLATE_JOB, key: `${video.id}:${TRANSLATE_JOB}:${t.lang}:insights:${fp}`, payload: { lang: t.lang, round: t.round, part: "insights" }, maxAttempts: 2 });
  }
  nudgeRunner();
}

// ── what is shown ───────────────────────────────────────────────────────────

/** For the list route: everything to the owner, finished languages to anyone else. */
export function publicView(t: Translation, owner: boolean) {
  return {
    lang: t.lang, status: t.status, done: t.done, total: t.total,
    ...(owner ? { error: t.error, errorCode: t.errorCode, updatedAt: t.updatedAt } : {}),
  };
}

/** A finished language for the page: the lines, and the summary and chapters while they match the video's. */
export function contentOf(t: Translation, video: VideoRecord) {
  const fresh = t.chaptersOf === insightsOf(video);
  return {
    lang: t.lang, transcript: t.segments,
    summary: fresh ? t.summary : null, chapters: fresh ? t.chapters : null, highlights: fresh ? t.highlights : null,
  };
}

// ── the job ─────────────────────────────────────────────────────────────────

export type Ask = <T>(o: { purpose: string; system: string; user: string; schema: Record<string, unknown>; maxTokens: number }) => Promise<T>;

/** A batch is at most this many lines and about this many characters, so each answer is quick and a restart repeats little. */
const BATCH_LINES = 60;
const BATCH_CHARS = 5000;

function batches(transcript: TranscriptSegment[], from: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = from;
  while (i < transcript.length) {
    let j = i, chars = 0;
    while (j < transcript.length && j - i < BATCH_LINES && (j === i || chars + transcript[j].text.length <= BATCH_CHARS)) { chars += transcript[j].text.length; j++; }
    out.push([i, j]); i = j;
  }
  return out;
}

const SYSTEM_LINES = (to: Lang, title: string) => `You translate the transcript of a video into ${WRITE_AS[to]}. The video is titled "${title.replace(/"/g, "'")}".

Each line is one sentence or phrase as it was spoken, led by its number in square brackets. Translate every line you are given and return it with the same number.
- One line in, one line out: never merge, split, drop or reorder lines, because each line is shown on screen at the moment it was said.
- Keep the speaker's meaning, register and tone, as natural speech in the target language. Do not explain, summarize, censor or add notes.
- Keep as they are: names of people, products and places that have no usual translation, code, commands, web addresses, numbers and units.
- A line that is already in the target language, or that is only a sound or a name, comes back unchanged.
- Lines inside <before> are the lines just before, with their translations, for context only. Do not return them.
Also say which language the lines are spoken in, as a two letter ISO 639-1 code ("en", "es", "fr", "ar", "pt", "de" and so on).`;

const LINES_SCHEMA = obj({
  spoken: str("The language the lines are spoken in, as a two letter ISO 639-1 code."),
  lines: list(obj({ n: num("The line's number."), text: str("The line, translated.") }), "Every line given, in order."),
});

const SYSTEM_INSIGHTS = (to: Lang) => `You translate the notes written about a video into ${WRITE_AS[to]}: its summary, its chapters (a title and a short summary each) and its key moments (why the moment matters, and what is said). Translate each item and return it with its number. Keep chapter titles short, as titles. Keep names, code, numbers and units as they are. Do not add, drop or reorder items.`;

const INSIGHTS_SCHEMA = obj({
  summary: str("The summary, translated."),
  chapters: list(obj({ n: num(), title: str(), summary: str() })),
  highlights: list(obj({ n: num(), reason: str(), text: str() })),
});

type RawLines = { spoken: string; lines: Array<{ n: number; text: string }> };
type RawInsights = { summary: string; chapters: Array<{ n: number; title: string; summary: string }>; highlights: Array<{ n: number; reason: string; text: string }> };

function classify(err: any): never {
  if (err instanceof ClaudeError && !err.retryable) throw new PermanentJobError("refused", "Claude declined to translate this transcript.");
  const status = Number(err?.status);
  if (status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
    throw new PermanentJobError("bad_request", `The translation was refused by the AI provider (${status}): ${String(err?.message ?? "").slice(0, 300)}`);
  }
  throw err;
}

async function translateLines(ask: Ask, to: Lang, title: string, transcript: TranscriptSegment[], done: TranscriptSegment[], a: number, b: number): Promise<{ lines: string[]; spoken: string | null }> {
  const want = transcript.slice(a, b);
  const before = done.slice(Math.max(0, a - 3), a).map((t, k) => {
    const src = transcript[Math.max(0, a - 3) + k];
    return `${src.text.trim()}\n=> ${t.text}`;
  });
  const body = (idx: number[]) => idx.map((i) => `[${i}] ${transcript[i].text.replace(/\s+/g, " ").trim()}`).join("\n");
  const call = (idx: number[]) => ask<RawLines>({
    purpose: "translate a transcript", system: SYSTEM_LINES(to, title),
    user: `${before.length ? `<before>\n${before.join("\n")}\n</before>\n\n` : ""}<lines>\n${body(idx)}\n</lines>`,
    schema: LINES_SCHEMA,
    // Arabic and other scripts take more tokens than English; askClaude doubles this once if it is not enough.
    maxTokens: Math.min(16_000, 1500 + Math.ceil(want.reduce((x, s) => x + s.text.length, 0) * 1.2)),
  });
  const idx = want.map((_, k) => a + k);
  const got = new Map<number, string>();
  let spoken: string | null = null;
  const take = (r: RawLines) => {
    spoken ??= languageCode(r?.spoken);
    for (const l of Array.isArray(r?.lines) ? r.lines : []) {
      const n = Math.round(Number(l?.n));
      if (n >= a && n < b && typeof l?.text === "string" && l.text.trim()) got.set(n, l.text.replace(/\s+/g, " ").trim());
    }
  };
  take(await call(idx));
  // Lines that did not come back are asked for once more on their own.
  const missing = idx.filter((i) => !got.has(i) && transcript[i].text.trim());
  if (missing.length) take(await call(missing));
  // A line still missing keeps its spoken words rather than leaving a gap on screen.
  return { lines: idx.map((i) => got.get(i) ?? transcript[i].text.trim()), spoken };
}

async function translateInsights(ask: Ask, to: Lang, v: VideoRecord): Promise<{ summary: string | null; chapters: Chapter[] | null; highlights: Highlight[] | null }> {
  const a = v.ai ?? {};
  const chapters = a.chapters ?? [], highlights = a.highlights ?? [];
  if (!a.summary && !chapters.length && !highlights.length) return { summary: null, chapters: null, highlights: null };
  const user = [
    `<summary>\n${a.summary ?? ""}\n</summary>`,
    `<chapters>\n${chapters.map((c, i) => `[${i}] ${c.title}\n${c.summary ?? ""}`).join("\n\n")}\n</chapters>`,
    `<key_moments>\n${highlights.map((h, i) => `[${i}] Why: ${h.reason}\nSaid: ${h.text}`).join("\n\n")}\n</key_moments>`,
  ].join("\n\n");
  const r = await ask<RawInsights>({ purpose: "translate a video's summary and chapters", system: SYSTEM_INSIGHTS(to), user, schema: INSIGHTS_SCHEMA, maxTokens: 6000 });
  const ch = new Map((r?.chapters ?? []).map((c) => [Math.round(Number(c.n)), c]));
  const hl = new Map((r?.highlights ?? []).map((h) => [Math.round(Number(h.n)), h]));
  return {
    summary: a.summary ? (String(r?.summary ?? "").trim() || a.summary) : null,
    chapters: chapters.map((c, i) => ({ ...c, title: String(ch.get(i)?.title ?? "").trim() || c.title, summary: String(ch.get(i)?.summary ?? "").trim() || c.summary })),
    highlights: highlights.map((h, i) => ({ ...h, reason: String(hl.get(i)?.reason ?? "").trim() || h.reason, text: String(hl.get(i)?.text ?? "").trim() || h.text })),
  };
}

export function makeTranslateHandler(ask: Ask = askClaude) {
  return async function translateHandler(job: Job): Promise<void> {
    const lang = String(job.payload.lang ?? "");
    const round = Number(job.payload.round ?? 0);
    const t = await getTranslation(job.videoId, lang);
    if (!t || !isLang(lang) || t.round !== round) return;           // removed, or asked for again since
    const video = await store.get(job.videoId);
    if (!video) return;                                              // the video was deleted
    const usage = { feature: "translate", ownerWallet: ownerOf(video), videoId: video.id, jobId: job.id };

    if (job.payload.part === "insights") {
      if (t.status !== "done") return;
      const fp = insightsOf(video);
      if (t.chaptersOf === fp) return;
      try {
        const ins = await withUsage(usage, () => translateInsights(ask, lang, video));
        await patch(video.id, lang, round, { summary: ins.summary, chapters_json: JSON.stringify(ins.chapters), highlights_json: JSON.stringify(ins.highlights), chapters_of: fp });
      } catch (e) { classify(e); }
      return;
    }
    if (t.status === "done" || t.status === "failed") return;

    const transcript = video.ai?.transcript ?? [];
    const done = t.segments.slice(0, transcript.length);
    await patch(video.id, lang, round, { status: "translating", total: transcript.length });
    try {
      for (const [a, b] of batches(transcript, done.length)) {
        const got: { lines: string[]; spoken: string | null } = await withUsage(usage, () => translateLines(ask, lang, video.title ?? "Untitled", transcript, done, a, b));
        const { lines, spoken } = got;
        // The first answer names the spoken language. A video already in the chosen one stops here, charged nothing.
        if (a === 0 && spoken) {
          if (!(await spokenLanguage(video.id))) await setSpokenLanguage(video.id, spoken, "claude");
          if (spoken === lang && (await spokenLanguage(video.id)) === lang) {
            throw new PermanentJobError("same_language", `This video is already in ${LANG_NAME[lang]}.`);
          }
        }
        for (let k = a; k < b; k++) done.push({ start: transcript[k].start, end: transcript[k].end, text: lines[k - a] });
        // Saved after every batch. A row that was removed or asked for again stops the work here.
        if (!(await patch(video.id, lang, round, { segments_json: JSON.stringify(done), done: done.length }))) return;
      }
      const fp = insightsOf(video);
      const ins = await withUsage(usage, () => translateInsights(ask, lang, video));
      const finished = await patch(video.id, lang, round, {
        status: "done", summary: ins.summary, chapters_json: JSON.stringify(ins.chapters), highlights_json: JSON.stringify(ins.highlights), chapters_of: fp,
      });
      if (finished && t.holdId) await settle(t.holdId).catch((e) => console.error(`[translate] settling ${video.id} ${lang}: ${e?.message ?? e}`));
      // Edited while this ran: translate the new chapters too.
      const now = await store.get(video.id);
      if (finished && now && insightsOf(now) !== fp) await refreshInsights(now);
    } catch (e) {
      if (e instanceof PermanentJobError) throw e;
      classify(e);
    }
  };
}

/** For the cost per unit on the admin Credits page: the minutes translated in the last 30 days. */
export async function minutesTranslated(since: number): Promise<number> {
  const r = await getDb().execute({ sql: "SELECT COALESCE(SUM(minutes), 0) AS m FROM transcript_translations WHERE status = 'done' AND updated_at >= ?", args: [since] });
  return Number((r.rows[0] as any).m) || 0;
}

/** The job failed for good: the language is marked failed and nothing is charged. */
export async function translationGaveUp(job: Job, f: { error: string; code: string }): Promise<void> {
  const lang = String(job.payload.lang ?? ""), round = Number(job.payload.round ?? 0);
  if (job.payload.part === "insights") return;                    // the language itself is still fine
  const t = await getTranslation(job.videoId, lang);
  if (!t || t.round !== round || t.status === "done") return;
  await patch(job.videoId, lang, round, { status: "failed", error: f.error.slice(0, 500), error_code: f.code });
  if (t.holdId) await release(t.holdId).catch(() => {});
}
