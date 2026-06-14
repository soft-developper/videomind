// src/services/aiPipeline.ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import "dotenv/config";
import type { VideoAIData, TranscriptSegment, Chapter, Highlight } from "../types/video.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helper: read a stream into a Buffer ─────────────────────────────────────
async function fileToBuffer(filePath: string): Promise<Buffer> {
  return fsPromises.readFile(filePath);
}

// ── Transcription with Whisper ──────────────────────────────────────────────
export async function transcribeVideo(videoFilePath: string): Promise<TranscriptSegment[]> {
  // Read the file into a Buffer and wrap in a File object so OpenAI SDK
  // sends the correct filename in the multipart upload. Whisper uses the
  // filename extension to detect format — without it you get a 400 error.
  const buffer = await fileToBuffer(videoFilePath);
  const fileName = path.basename(videoFilePath); // e.g. "abc123.mp4"
  const file = new File([buffer], fileName);

  const response = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments: TranscriptSegment[] = (response.segments ?? []).map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text.trim(),
  }));

  return segments;
}

// ── Claude AI Analysis ──────────────────────────────────────────────────────
export async function analyzeWithClaude(
  transcript: TranscriptSegment[],
  videoTitle: string
): Promise<Omit<VideoAIData, "transcript">> {
  const fullText = transcript.map((s) => `[${formatTime(s.start)}] ${s.text}`).join("\n");

  const systemPrompt = `You are an expert video intelligence analyst for VideoMind, an AI-first video knowledge platform.
Analyze video transcripts and extract rich, actionable intelligence.
Always respond with ONLY valid JSON — no markdown, no preamble.`;

  const userPrompt = `Video Title: "${videoTitle}"

Transcript:
${fullText}

Return a JSON object with EXACTLY these fields:
{
  "summary": "A comprehensive 3-4 sentence summary of the video content",
  "chapters": [
    {
      "title": "Chapter title",
      "startSeconds": 0,
      "summary": "What this chapter covers in 1-2 sentences"
    }
  ],
  "highlights": [
    {
      "startSeconds": 0,
      "endSeconds": 30,
      "reason": "Why this moment is notable",
      "text": "The transcript text for this highlight"
    }
  ],
  "tags": ["tag1", "tag2", "tag3"],
  "blogPost": "A complete, well-structured blog post (500-800 words) based on this video's content",
  "tweetThread": "A Twitter/X thread (8-12 tweets, each numbered 1/ 2/ etc.) summarizing key insights"
}

Rules:
- chapters: identify 3-8 natural topic breaks in the video
- highlights: pick 3-6 most insightful or quotable moments (30-90 seconds each)
- tags: 5-10 relevant keywords/topics
- All timestamps must match actual transcript times`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4000,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "{}";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      summary: parsed.summary ?? "",
      chapters: parsed.chapters ?? [],
      highlights: parsed.highlights ?? [],
      tags: parsed.tags ?? [],
      blogPost: parsed.blogPost ?? "",
      tweetThread: parsed.tweetThread ?? "",
    };
  } catch {
    console.error("Failed to parse Claude response:", rawText);
    return { summary: "Analysis pending.", chapters: [], highlights: [], tags: [] };
  }
}

// ── Chat Q&A ────────────────────────────────────────────────────────────────
export async function chatWithVideo(
  transcript: TranscriptSegment[],
  question: string,
  videoTitle: string
): Promise<{ answer: string; sources: Array<{ time: number; text: string }> }> {
  const fullText = transcript.map((s) => `[${formatTime(s.start)}] ${s.text}`).join("\n");

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1000,
    system: `You are a video intelligence assistant for VideoMind. Answer questions about video content using the transcript.
Always cite specific timestamps when referencing content. Respond with ONLY valid JSON.`,
    messages: [
      {
        role: "user",
        content: `Video: "${videoTitle}"

Transcript:
${fullText}

Question: ${question}

Return JSON:
{
  "answer": "Your detailed answer here",
  "sources": [
    { "time": 123, "text": "relevant transcript excerpt" }
  ]
}`,
      },
    ],
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "{}";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return { answer: parsed.answer ?? "Could not find an answer.", sources: parsed.sources ?? [] };
  } catch {
    return { answer: "Could not process the question. Please try again.", sources: [] };
  }
}

// ── Semantic search ──────────────────────────────────────────────────────────
export async function semanticSearch(
  query: string,
  videos: Array<{ id: string; title: string; transcript: TranscriptSegment[] }>
): Promise<Array<{ videoId: string; title: string; matches: Array<{ time: number; text: string }> }>> {
  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2000,
    system: "You are a semantic search engine for video content. Respond with ONLY valid JSON.",
    messages: [
      {
        role: "user",
        content: `Search query: "${query}"

Videos:
${videos
  .map(
    (v) =>
      `Video ID: ${v.id}\nTitle: ${v.title}\nTranscript:\n${v.transcript
        .slice(0, 50)
        .map((s) => `[${formatTime(s.start)}] ${s.text}`)
        .join("\n")}`
  )
  .join("\n\n---\n\n")}

Find the most relevant moments across all videos that match the query.
Return JSON:
{
  "results": [
    {
      "videoId": "...",
      "title": "...",
      "matches": [
        { "time": 123, "text": "relevant excerpt" }
      ]
    }
  ]
}`,
      },
    ],
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "{}";
  try {
    const parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    return parsed.results ?? [];
  } catch {
    return [];
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
