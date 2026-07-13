// src/services/learningService.ts
// Claude-powered learning paths + cross-video library assistant.
//
// Token strategy:
//  - Learning paths → only titles/summaries/tags sent (small payload)
//  - Library chat   → two-pass: Claude first picks relevant videos from
//                     summaries, then we send only those transcripts.

import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import type { VideoRecord } from "../types/video.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-opus-4-5";

// ── Types ───────────────────────────────────────────────────────────────────
export interface LearningPath {
  level: "Beginner" | "Intermediate" | "Advanced";
  title: string;
  description: string;
  steps: Array<{
    videoId: string;
    title: string;
    reason: string;
  }>;
}

export interface LibraryAnswer {
  answer: string;
  citations: Array<{
    videoId: string;
    videoTitle: string;
    time: number;
    quote: string;
  }>;
  videosUsed: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as T;
  } catch {
    console.error("[Learning] Failed to parse Claude JSON:", raw.slice(0, 300));
    return fallback;
  }
}

function textOf(msg: Anthropic.Message): string {
  return msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
}

// ═══════════════════════════════════════════════════════════════════════════
// LEARNING PATHS
// ═══════════════════════════════════════════════════════════════════════════
export async function generateLearningPaths(
  videos: VideoRecord[]
): Promise<LearningPath[]> {
  // Compact catalogue — no transcripts, keeps tokens tiny
  const catalogue = videos.map((v) => ({
    id: v.id,
    title: v.title,
    summary: v.ai?.summary ?? "",
    tags: v.ai?.tags ?? [],
    chapters: (v.ai?.chapters ?? []).map((c) => c.title),
    durationMinutes: v.meta.durationSeconds
      ? Math.round(v.meta.durationSeconds / 60)
      : null,
  }));

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: `You are a curriculum designer for VideoMind, an AI video knowledge platform.
Given a library of videos, design ordered learning paths that take someone from
zero knowledge to advanced mastery of the topics covered.
Respond with ONLY valid JSON — no markdown fences, no preamble.`,
    messages: [{
      role: "user",
      content: `Here is the user's video library:

${JSON.stringify(catalogue, null, 2)}

Design learning paths. Rules:
- Create 1-3 paths. Use "Beginner" first; add "Intermediate"/"Advanced" only if
  the library genuinely supports that depth.
- Every videoId in a step MUST exist in the catalogue above. Never invent IDs.
- A video may appear in more than one path if it genuinely fits both.
- Order steps so each builds on the last.
- "reason" explains WHY this video comes at this point in the path (1 sentence).
- If the library is too small or too unrelated to form a meaningful path,
  return a single Beginner path listing the videos in the most sensible order.

Return JSON:
{
  "paths": [
    {
      "level": "Beginner",
      "title": "Short path name",
      "description": "1-2 sentences on what this path teaches and who it's for",
      "steps": [
        { "videoId": "...", "title": "...", "reason": "Why this video, why now" }
      ]
    }
  ]
}`,
    }],
  });

  const parsed = parseJson<{ paths: LearningPath[] }>(textOf(msg), { paths: [] });

  // Defensive: strip any hallucinated video IDs
  const validIds = new Set(videos.map((v) => v.id));
  return (parsed.paths ?? []).map((p) => ({
    ...p,
    steps: (p.steps ?? []).filter((s) => validIds.has(s.videoId)),
  })).filter((p) => p.steps.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-VIDEO LIBRARY ASSISTANT  (two-pass)
// ═══════════════════════════════════════════════════════════════════════════
export async function askLibrary(
  question: string,
  videos: VideoRecord[]
): Promise<LibraryAnswer> {
  if (videos.length === 0) {
    return { answer: "You have no processed videos yet. Upload a video to get started.", citations: [], videosUsed: [] };
  }

  // ── PASS 1: which videos are relevant? (summaries only — cheap) ──────────
  const catalogue = videos.map((v) => ({
    id: v.id,
    title: v.title,
    summary: v.ai?.summary ?? "",
    tags: v.ai?.tags ?? [],
  }));

  const routeMsg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: "You route questions to relevant videos. Respond with ONLY valid JSON.",
    messages: [{
      role: "user",
      content: `Question: "${question}"

Video library:
${JSON.stringify(catalogue, null, 2)}

Which videos are likely to contain the answer? Pick at most 4, ordered by relevance.
If none seem relevant, return an empty array.

Return JSON: { "videoIds": ["id1", "id2"] }`,
    }],
  });

  const routed = parseJson<{ videoIds: string[] }>(textOf(routeMsg), { videoIds: [] });
  const validIds = new Set(videos.map((v) => v.id));
  let selectedIds = (routed.videoIds ?? []).filter((id) => validIds.has(id)).slice(0, 4);

  // Fallback — if routing found nothing, use the 3 most recent videos
  if (selectedIds.length === 0) {
    selectedIds = videos.slice(0, 3).map((v) => v.id);
  }

  const selected = videos.filter((v) => selectedIds.includes(v.id));

  // ── PASS 2: answer using only the selected transcripts ───────────────────
  const context = selected.map((v) => {
    const transcript = (v.ai?.transcript ?? [])
      .map((s) => `[${fmt(s.start)}] ${s.text}`)
      .join("\n");
    return `=== VIDEO ===
ID: ${v.id}
Title: ${v.title}

Transcript:
${transcript}`;
  }).join("\n\n");

  const answerMsg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: `You are VideoMind's library assistant. Answer questions using ONLY the
transcripts provided. Always cite the specific video and timestamp your answer
comes from. If the transcripts don't contain the answer, say so honestly —
never invent information. Respond with ONLY valid JSON.`,
    messages: [{
      role: "user",
      content: `Question: "${question}"

${context}

Answer the question drawing on these videos. Cite every claim.

Return JSON:
{
  "answer": "Your answer. Reference videos naturally, e.g. 'In your talk on X, the speaker explains...'",
  "citations": [
    {
      "videoId": "the exact ID from above",
      "videoTitle": "the exact title",
      "time": 123,
      "quote": "the relevant transcript excerpt (short)"
    }
  ]
}

Rules:
- videoId must be one of: ${selectedIds.join(", ")}
- time is in SECONDS (a number), not "mm:ss"
- If you cannot answer from these transcripts, set answer to explain that and
  return an empty citations array.`,
    }],
  });

  const parsed = parseJson<Omit<LibraryAnswer, "videosUsed">>(
    textOf(answerMsg),
    { answer: "Could not process that question. Please try again.", citations: [] }
  );

  // Defensive: drop citations with bad IDs
  const citations = (parsed.citations ?? []).filter((c) => validIds.has(c.videoId));

  return {
    answer: parsed.answer ?? "Could not find an answer.",
    citations,
    videosUsed: selectedIds,
  };
}
