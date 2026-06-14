// src/services/videoProcessor.ts
// AI-only pipeline. Raw video is uploaded to Shelby by the frontend wallet.
// AI artifacts (transcript, meta) are stored in Turso only — no backend
// Shelby uploads needed, so the backend account needs zero APT balance.
import fs from "fs/promises";
import { transcribeVideo, analyzeWithClaude } from "./aiPipeline.js";
import { store } from "../lib/store.js";
import { pendingFiles } from "../routes/videos.js";

export async function processVideoAI(
  videoId: string,
  tempFilePath: string,
  walletAddress: string
): Promise<void> {
  try {
    // ── 1. Transcribe with Whisper ───────────────────────────────────────
    await store.update(videoId, { status: "transcribing" });
    console.log(`[VideoMind] Transcribing ${tempFilePath}`);
    const transcript = await transcribeVideo(tempFilePath);

    await store.update(videoId, {
      status: "analyzing",
      ai: { transcript },
    });

    // ── 2. Analyze with Claude ───────────────────────────────────────────
    console.log(`[VideoMind] Analyzing with Claude for ${videoId}`);
    const videoRecord = await store.get(videoId);
    const aiData = await analyzeWithClaude(transcript, videoRecord?.title ?? "Untitled");

    // ── 3. Persist everything to Turso ───────────────────────────────────
    // transcript.json and meta.json are NOT uploaded to Shelby from the backend.
    // The raw video blob is already on Shelby (uploaded by the wallet on the frontend).
    // All AI outputs live in Turso — no backend APT needed.
    await store.update(videoId, {
      status: "ready",
      ai: { transcript, ...aiData },
    });

    // ── 4. Cleanup temp file ─────────────────────────────────────────────
    await fs.unlink(tempFilePath).catch(() => {});
    pendingFiles.delete(videoId);

    console.log(`[VideoMind] ✅ AI pipeline complete for ${videoId}`);
  } catch (err) {
    console.error(`[VideoMind] ❌ AI pipeline failed for ${videoId}:`, err);
    await store.update(videoId, { status: "error" }).catch(() => {});
    await fs.unlink(tempFilePath).catch(() => {});
    pendingFiles.delete(videoId);
  }
}
