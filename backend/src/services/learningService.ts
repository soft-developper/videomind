// src/services/learningService.ts
// Claude-powered learning paths + cross-video library assistant.
//
// Token strategy:
//  - Learning paths → only titles/summaries/tags sent (small payload)
//  - Library chat   → two-pass: Claude first picks relevant videos from
//                     summaries, then we send only those transcripts.

import "dotenv/config";
import type { VideoRecord } from "../types/video.js";
// vm_claude: Claude is called through src/services/claude.ts, which also
// writes every reply to the usage ledger. Answers are structured outputs.
import { askClaude, claudeFastModel, obj, str, num, list, transcriptLines } from "./claude.js";

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

// ── Schemas ─────────────────────────────────────────────────────────────────
const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;

const PATHS_SCHEMA = obj({
  paths: list(obj({
    level: { type: "string", enum: [...LEVELS] },
    title: str("A short name for the path."),
    description: str("One or two sentences on what the path teaches and who it is for."),
    steps: list(obj({ videoId: str("An id exactly as given."), title: str(), reason: str("One sentence on why this video comes at this point.") })),
  }), "One to three paths, Beginner first."),
});
const ROUTE_SCHEMA = obj({ videoIds: list(str("An id exactly as given."), "At most four, most relevant first. Empty when none fit.") });
const LIBRARY_ANSWER_SCHEMA = obj({
  answer: str("The answer, naming the videos it comes from. Say so plainly when the transcripts do not contain it."),
  citations: list(obj({
    videoId: str("An id exactly as given."), videoTitle: str(),
    time: num("Seconds, from the transcript."), quote: str("A short quote from the transcript."),
  })),
});

/** Enum values may come back with a different first letter. */
function levelOf(v: unknown): LearningPath["level"] {
  return LEVELS.find((l) => l.toLowerCase() === String(v ?? "").trim().toLowerCase()) ?? "Beginner";
}

// ═══════════════════════════════════════════════════════════════════════════
// LEARNING PATHS
// ═══════════════════════════════════════════════════════════════════════════
export async function generateLearningPaths(
  videos: VideoRecord[]
): Promise<LearningPath[]> {
  // Compact catalogue: no transcripts, keeps tokens tiny
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

  const parsed = await askClaude<{ paths: LearningPath[] }>({
    purpose: "design learning paths",
    system: `You are a curriculum designer for VideoMind. Given a library of videos, design ordered learning paths that take someone from
no knowledge of its topics to a deep understanding of them. Use only the videos given, with their ids exactly as given.`,
    user: `The library:

${JSON.stringify(catalogue, null, 2)}

Design learning paths.
- One to three paths. Beginner first; Intermediate or Advanced only if the library supports that depth.
- A video may appear in more than one path if it fits both.
- Order the steps so each builds on the one before.
- If the library is too small or too varied for a real path, give one Beginner path with the videos in the most sensible order.`,
    schema: PATHS_SCHEMA,
    maxTokens: 8_000,
  });

  // Defensive: strip any hallucinated video IDs
  const validIds = new Set(videos.map((v) => v.id));
  return (parsed.paths ?? []).map((p) => ({
    ...p,
    level: levelOf(p.level),
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

  // ── PASS 1: which videos are relevant? (summaries only, cheap) ──────────
  const catalogue = videos.map((v) => ({
    id: v.id,
    title: v.title,
    summary: v.ai?.summary ?? "",
    tags: v.ai?.tags ?? [],
  }));

  // The fast model is enough to pick videos from their summaries.
  const routed = await askClaude<{ videoIds: string[] }>({
    purpose: "choose the videos to read",
    model: claudeFastModel(),
    system: "You pick which videos in a library are likely to answer a question, from their titles, summaries and tags. Use ids exactly as given.",
    user: `Question: "${question}"\n\nThe library:\n${JSON.stringify(catalogue, null, 2)}`,
    schema: ROUTE_SCHEMA,
    maxTokens: 2_000,
  });
  const validIds = new Set(videos.map((v) => v.id));
  let selectedIds = (routed.videoIds ?? []).filter((id) => validIds.has(id)).slice(0, 4);

  // Fallback: if routing found nothing, use the 3 most recent videos
  if (selectedIds.length === 0) {
    selectedIds = videos.slice(0, 3).map((v) => v.id);
  }

  const selected = videos.filter((v) => selectedIds.includes(v.id));

  // ── PASS 2: answer using only the selected transcripts ───────────────────
  const context = selected.map((v) => `=== VIDEO ===
ID: ${v.id}
Title: ${v.title}

Transcript:
${transcriptLines(v.ai?.transcript ?? [])}`).join("\n\n");

  const parsed = await askClaude<Omit<LibraryAnswer, "videosUsed">>({
    purpose: "answer the question from the library",
    system: `You are VideoMind's library assistant. Answer using only the transcripts given, and never invent what is not in them.
Each transcript line starts with the second it is said at, in square brackets. Cite the video and the second every claim comes from.`,
    user: `Question: "${question}"

${context}

The video ids you may cite: ${selectedIds.join(", ")}.`,
    schema: LIBRARY_ANSWER_SCHEMA,
    maxTokens: 4_000,
  });

  // Only the videos that were read can be cited.
  const read = new Set(selectedIds);
  const citations = (parsed.citations ?? []).filter((c) => read.has(c.videoId));

  return {
    answer: parsed.answer ?? "Could not find an answer.",
    citations,
    videosUsed: selectedIds,
  };
}
