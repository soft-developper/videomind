// src/services/aiPipeline.ts
import OpenAI from "openai";
import fsPromises from "fs/promises";
import path from "path";
import "dotenv/config";
import type { VideoAIData, TranscriptSegment, Chapter, Highlight } from "../types/video.js";
// vm_storage: every provider call reports what it used to the usage ledger
import { recordTranscriptionUsage } from "../lib/usage.js";
import type { PieceResult } from "./transcribe.js";

// vm_transcribe: one piece is about ten minutes of sound and comes back in
// well under a minute. A request that hangs is cut off after five minutes
// and tried once more by the SDK; after that the job's own retry takes
// over. Before, a hung request could hold a job for half an hour.
const openaiTranscribe = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5 * 60_000, maxRetries: 1 });
// vm_claude: Claude is called through src/services/claude.ts
import { askClaude, ClaudeError, obj, str, num, list, transcriptLines } from "./claude.js";

/**
 * vm_transcribe: one piece of sound (see src/services/transcribe.ts).
 * whisper-1 is the model that returns word and segment times, which the
 * transcript and captions need. `prompt` is the end of the text before
 * this piece, so a sentence or a name carries over the cut.
 */
export async function transcribePiece(filePath: string, prompt: string): Promise<PieceResult> {
  const buffer = await fsPromises.readFile(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const file = new File([arrayBuffer], path.basename(filePath), { type: "audio/mp4" });
  const response = await openaiTranscribe.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
    ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
  });
  await recordTranscriptionUsage(response.duration, "whisper-1");
  return {
    text: (response.text ?? "").trim(),
    segments: (response.segments ?? []).map((s) => ({ start: Number(s.start), end: Number(s.end), text: String(s.text ?? "") })),
    words: (response.words ?? []).map((w) => ({ text: String(w.word ?? ""), start: Number(w.start), end: Number(w.end) })),
    duration: Number(response.duration ?? 0),
    language: response.language ? String(response.language) : undefined,
  };
}

// ── Analysis ────────────────────────────────────────────────────────────────
// vm_claude: chapters, summary, key moments, tags, an article and a thread,
// as one structured answer.

const ANALYSIS_SCHEMA = obj({
  summary: str("Three or four sentences on what the video covers and what a viewer takes away."),
  chapters: list(obj({
    title: str("A short title, a few words."),
    startSeconds: num("The second the chapter starts, taken from the transcript."),
    summary: str("One or two sentences on what the chapter covers."),
  }), "Natural topic breaks in order. The first starts at or near 0."),
  highlights: list(obj({
    startSeconds: num(), endSeconds: num(),
    reason: str("Why this moment is worth returning to, in one sentence."),
    text: str("What is said, quoted from the transcript."),
  }), "The most insightful or quotable moments, in order."),
  tags: list(str(), "Topics the video is about, as short keywords."),
  blogPost: str("An article of 500 to 800 words based on the video, in plain prose with short headings."),
  tweetThread: str("A thread of 8 to 12 posts numbered 1/ 2/ and so on, each under 280 characters, separated by blank lines."),
});

interface RawAnalysis {
  summary: string;
  chapters: Array<{ title: string; startSeconds: number; summary: string }>;
  highlights: Array<{ startSeconds: number; endSeconds: number; reason: string; text: string }>;
  tags: string[];
  blogPost: string;
  tweetThread: string;
}

/** Keep only what fits the video: times inside it, in order, no empty titles, no repeated tags. */
export function cleanAnalysis(raw: RawAnalysis, transcript: TranscriptSegment[]): Omit<VideoAIData, "transcript"> {
  const end = Math.max(0, ...transcript.map((s) => s.end));
  const inside = (t: unknown) => typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= end + 1;
  const summary = String(raw?.summary ?? "").trim();
  if (!summary) throw new ClaudeError("invalid_output", "Claude's analysis came back without a summary.", true);

  const seen = new Set<number>();
  const chapters: Chapter[] = (Array.isArray(raw.chapters) ? raw.chapters : [])
    .filter((c) => String(c?.title ?? "").trim() && inside(c.startSeconds))
    .map((c) => ({ title: String(c.title).trim(), startSeconds: Math.round(Math.min(c.startSeconds, end) * 10) / 10, summary: String(c.summary ?? "").trim() }))
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .filter((c) => (seen.has(c.startSeconds) ? false : (seen.add(c.startSeconds), true)));

  const highlights: Highlight[] = (Array.isArray(raw.highlights) ? raw.highlights : [])
    .filter((h) => inside(h?.startSeconds) && typeof h.endSeconds === "number" && h.endSeconds > h.startSeconds && h.startSeconds < end && String(h.text ?? "").trim())
    .map((h) => ({ startSeconds: h.startSeconds, endSeconds: Math.min(h.endSeconds, end), reason: String(h.reason ?? "").trim(), text: String(h.text).trim() }))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  const tagKeys = new Set<string>();
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => String(t ?? "").replace(/^#+/, "").trim()).filter(Boolean)
    .filter((t) => (tagKeys.has(t.toLowerCase()) ? false : (tagKeys.add(t.toLowerCase()), true)))
    .slice(0, 10);

  return { summary, chapters, highlights, tags, blogPost: String(raw.blogPost ?? "").trim(), tweetThread: String(raw.tweetThread ?? "").trim() };
}

export async function analyzeWithClaude(transcript: TranscriptSegment[], videoTitle: string): Promise<Omit<VideoAIData, "transcript">> {
  const minutes = Math.round(Math.max(0, ...transcript.map((s) => s.end)) / 60);
  const raw = await askClaude<RawAnalysis>({
    purpose: "analyze the video",
    system: `You analyze recorded talks, lectures and meetings for VideoMind, a video library people search and learn from.
Work only from the transcript. Each transcript line starts with the second it is said at, in square brackets.
Every time you give back is a number of seconds taken from those brackets.`,
    user: `Title: "${videoTitle}"
Length: ${minutes < 1 ? "under a minute" : `about ${minutes} minute${minutes === 1 ? "" : "s"}`}

Transcript:
${transcriptLines(transcript)}

Analyze this recording.
- chapters: the natural topic breaks, about one for every five to fifteen minutes, at least two when the recording allows it.
- highlights: three to six moments of 30 to 90 seconds each that are most worth returning to.
- tags: five to ten topics.`,
    schema: ANALYSIS_SCHEMA,
    maxTokens: 16_000,
  });
  return cleanAnalysis(raw, transcript);
}

// ── Ask one video ───────────────────────────────────────────────────────────
// vm_claude: the transcript goes first in the system prompt and is marked
// for prompt caching, so the second and later questions about the same
// video read it from the cache.

const ANSWER_SCHEMA = obj({
  answer: str("The answer, in plain prose. Say so plainly when the transcript does not contain it."),
  sources: list(obj({ time: num("The second the quoted words start, from the transcript."), text: str("The words quoted from the transcript.") }),
    "The places in the transcript the answer comes from, up to six."),
});

export async function chatWithVideo(
  transcript: TranscriptSegment[],
  question: string,
  videoTitle: string
): Promise<{ answer: string; sources: Array<{ time: number; text: string }> }> {
  const end = Math.max(0, ...transcript.map((s) => s.end));
  const raw = await askClaude<{ answer: string; sources: Array<{ time: number; text: string }> }>({
    purpose: "answer the question",
    system: [
      { type: "text", text: `You answer questions about one recorded video for VideoMind. Use only its transcript, and never invent what is not in it.
Each transcript line starts with the second it is said at, in square brackets. Source times are those seconds.` },
      { type: "text", text: `Video: "${videoTitle}"\n\nTranscript:\n${transcriptLines(transcript)}`, cache_control: { type: "ephemeral" } },
    ],
    user: question,
    schema: ANSWER_SCHEMA,
    maxTokens: 4_000,
  });
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .filter((x) => typeof x?.time === "number" && Number.isFinite(x.time) && x.time >= 0 && x.time <= end + 1 && String(x.text ?? "").trim())
    .slice(0, 6).map((x) => ({ time: x.time, text: String(x.text).trim() }));
  return { answer: String(raw.answer ?? "").trim() || "No answer came back. Please ask again.", sources };
}

// ── Search across the library ───────────────────────────────────────────────
// vm_claude: unchanged in what it reads (the first 50 sentences of each
// video). Part 4c replaces it with search over every sentence.

const SEARCH_SCHEMA = obj({
  results: list(obj({
    videoId: str("An id exactly as given."),
    title: str(),
    matches: list(obj({ time: num("Seconds, from the transcript."), text: str("The matching words.") })),
  }), "Videos with moments that match, most relevant first."),
});

export async function semanticSearch(
  query: string,
  videos: Array<{ id: string; title: string; transcript: TranscriptSegment[] }>
): Promise<Array<{ videoId: string; title: string; matches: Array<{ time: number; text: string }> }>> {
  const raw = await askClaude<{ results: Array<{ videoId: string; title: string; matches: Array<{ time: number; text: string }> }> }>({
    purpose: "search the library",
    system: `You find the moments in a library of video transcripts that match a search. Each transcript line starts with the second it is said at, in square brackets.
Use only the videos given, with their ids exactly as given.`,
    user: `Search: "${query}"

${videos.map((v) => `Video id: ${v.id}\nTitle: ${v.title}\nTranscript:\n${transcriptLines(v.transcript.slice(0, 50))}`).join("\n\n---\n\n")}`,
    schema: SEARCH_SCHEMA,
    maxTokens: 4_000,
  });
  const byId = new Map(videos.map((v) => [v.id, v]));
  return (Array.isArray(raw.results) ? raw.results : [])
    .filter((r) => byId.has(r?.videoId))
    .map((r) => ({
      videoId: r.videoId, title: byId.get(r.videoId)!.title,
      matches: (Array.isArray(r.matches) ? r.matches : []).filter((m) => typeof m?.time === "number" && Number.isFinite(m.time) && m.time >= 0)
        .map((m) => ({ time: m.time, text: String(m.text ?? "").trim() })),
    }))
    .filter((r) => r.matches.length > 0);
}
