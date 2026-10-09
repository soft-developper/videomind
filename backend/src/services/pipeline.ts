// src/services/pipeline.ts
// vm_jobs: the processing stages, as job handlers.
//
//   transcribe  the sound is taken out, cut into pieces and transcribed
//               with word timing -> transcript saved (src/services/transcribe.ts)
//   analyze     Claude reads the transcript      -> summary, chapters, highlights
//
// Each handler first checks whether its work is already saved and skips
// it if so. That makes a retry, or a job taken over after a crash, cost
// nothing for the parts that already finished.
import fs from "fs/promises";
import { transcribePiece, analyzeWithClaude } from "./aiPipeline.js";
import { ClaudeError } from "./claude.js";
import { store } from "../lib/store.js";
import { enqueueJob, retryJob, type Job } from "../lib/jobs.js";
import { PermanentJobError, registerHandler, setFinalFailureHook, nudgeRunner } from "../lib/runner.js";
// vm_storage: the original is read from storage, and AI usage is attributed to the owner
import { getOriginal, deleteOriginal, keepOriginal } from "../lib/assets.js";
// vm_transcribe: recordings of any length, in pieces
import { transcribeLong, clearPieces, type TranscribeDeps } from "./transcribe.js";
import { extractSound, cutSound } from "../lib/media.js";
import { withUsage, ownerOf } from "../lib/usage.js";
import type { TranscriptSegment, VideoAIData } from "../types/video.js";
// vm_media: thumbnails and video facts, a job of its own next to these stages
import { INSPECT, makeInspectHandler } from "./inspect.js";
import { EMBED, embedHandler, queueEmbed } from "./search.js";
// vm_anchors: confirming a store on Shelby
import { ANCHOR_CHECK, anchorCheckHandler, anchorCheckGaveUp } from "./anchor.js";
// vm_clips
import { CLIP_JOB, clipHandler, clipGaveUp } from "./clip.js";
// vm_youtube
import { YOUTUBE_JOB, youtubeHandler, youtubeGaveUp } from "./youtube.js";

/**
 * Failure codes that no retry can fix. The retry button is hidden for
 * these. "bad_request" is NOT here on purpose: the queue does not retry it
 * by itself, but once the operator fixes the cause (an API key, a model
 * name) the owner must be able to run the stage again.
 */
export const NOT_RETRYABLE = new Set(["too_long", "source_missing", "video_gone", "no_transcript", "no_handler", "unreadable"]);

export interface PipelineDeps extends TranscribeDeps {
  analyze: (transcript: TranscriptSegment[], title: string) => Promise<Omit<VideoAIData, "transcript">>;
}

/**
 * Turn an AI provider error into a retry decision. A 4xx answer means
 * the request itself is wrong (bad file, unknown model, bad key), so the
 * same request would fail again. Timeouts, rate limits and 5xx are worth
 * another try.
 */
function classify(err: any, stage: string): never {
  // vm_claude: a refusal will not change on a retry. An answer that was
  // cut off or unreadable may come back whole next time.
  if (err instanceof ClaudeError && !err.retryable) throw new PermanentJobError(err.code, err.message);
  const status = Number(err?.status);
  if (status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
    throw new PermanentJobError("bad_request", `${stage} was refused by the AI provider (${status}): ${String(err?.message ?? "").slice(0, 300)}`);
  }
  throw err;
}

export function makeHandlers(deps: PipelineDeps) {
  async function transcribe(job: Job) {
    const video = await store.get(job.videoId);
    if (!video) throw new PermanentJobError("video_gone", "The video was deleted.");

    // vm_transcribe: an empty transcript is a finished one (a video with no sound or no speech)
    if (!Array.isArray(video.ai?.transcript)) {
      // The original lives in storage. A video confirmed before storage
      // existed may still point at a file on this machine's disk.
      const original = await getOriginal(job.videoId);
      const diskPath = original ? undefined : ((job.payload.filePath as string | undefined) ?? (await store.getSourcePath(job.videoId)) ?? undefined);
      if (!original && !diskPath) throw new PermanentJobError("source_missing", "The uploaded file is no longer in storage. Upload the video again.");
      await store.update(job.videoId, { status: "transcribing" });
      let transcript: TranscriptSegment[];
      try {
        transcript = await withUsage(
          { feature: "transcribe", ownerWallet: ownerOf(video), videoId: job.videoId, jobId: job.id },
          () => transcribeLong({ videoId: job.videoId, original, diskPath, ownerWallet: ownerOf(video), deps }));
      } catch (err) {
        if (err instanceof PermanentJobError) throw err;
        classify(err, "Transcription");
      }
      await store.update(job.videoId, { ai: { transcript: transcript! } });
      await clearPieces(job.videoId);
    }

    // vm_transcribe: nothing was said, so there is nothing to analyze. The video is ready as it is.
    if (!(await store.get(job.videoId))?.ai?.transcript?.length) {
      await store.update(job.videoId, { status: "ready" });
      return;
    }

    // Hand over to analysis. If an analyze job is already there from an
    // earlier run: a failed one is restarted, a finished one means the
    // video is ready.
    const { job: next, created } = await enqueueJob({ videoId: job.videoId, kind: "analyze" });
    if (!created && next.status === "failed") await retryJob(job.videoId, "analyze");
    const done = !created && next.status === "succeeded";
    await store.update(job.videoId, { status: done ? "ready" : "analyzing" });
    // vm_search: make the transcript searchable. Queued after the analysis,
    // which the page waits for; search is not a step the page lists.
    await queueEmbed(job.videoId).catch((err) => console.error(`[search] could not queue ${job.videoId}: ${err?.message ?? err}`));
    nudgeRunner();
  }

  async function analyze(job: Job) {
    const video = await store.get(job.videoId);
    if (!video) throw new PermanentJobError("video_gone", "The video was deleted.");
    const transcript = video.ai?.transcript;
    if (!transcript?.length) throw new PermanentJobError("no_transcript", "There is no transcript to analyze.");

    if (!video.ai?.summary) {
      await store.update(job.videoId, { status: "analyzing" });
      let ai: Omit<VideoAIData, "transcript">;
      try {
        ai = await withUsage(
          { feature: "analyze", ownerWallet: ownerOf(video), videoId: job.videoId, jobId: job.id },
          () => deps.analyze(transcript, video.title ?? "Untitled"));
      } catch (err) { classify(err, "Analysis"); }
      // vm_claude: the analyzer checks its own answer and throws when it
      // is unusable. An empty summary is still never saved.
      if (!ai!.summary?.trim()) throw new Error("The analysis came back without a summary.");
      await store.update(job.videoId, { ai: ai! });
    }

    await store.update(job.videoId, { status: "ready" });

    // The original is kept: it is the copy the video plays from and the
    // one later steps (playback files, clips, storing on Shelby) are made from.
    if (!keepOriginal()) {
      await deleteOriginal(job.videoId).catch((err) => console.error(`[storage] could not remove the original of ${job.videoId}: ${err?.message ?? err}`));
    }
    const src = await store.getSourcePath(job.videoId);
    if (src) {
      await fs.unlink(src).catch(() => {});
      await store.setSourcePath(job.videoId, null);
    }
  }

  return { transcribe, analyze };
}

/** Register the real handlers. Called once at startup. */
export function registerPipeline(deps: PipelineDeps = { extractSound, cutSound, transcribePiece, analyze: analyzeWithClaude }) {
  const h = makeHandlers(deps);
  registerHandler("transcribe", h.transcribe);
  registerHandler("analyze", h.analyze);
  registerHandler(INSPECT, makeInspectHandler());
  registerHandler(EMBED, embedHandler);
  registerHandler(ANCHOR_CHECK, anchorCheckHandler);
  registerHandler(CLIP_JOB, clipHandler);
  registerHandler(YOUTUBE_JOB, youtubeHandler);
  // A stage that failed for good marks the video, so the page stops waiting.
  setFinalFailureHook(async (job, f) => {
    // vm_media: a video without a thumbnail is not a failed video.
    if (job.kind === INSPECT) return;
    // vm_search: nor is a video that cannot be searched yet.
    if (job.kind === EMBED) return;
    // vm_anchors: nor is a video whose store on Shelby could not be confirmed.
    if (job.kind === ANCHOR_CHECK) { await anchorCheckGaveUp(job, f).catch(() => {}); return; }
    // vm_clips: a clip that could not be made is a failed clip, not a failed video.
    if (job.kind === CLIP_JOB) { await clipGaveUp(job, f).catch(() => {}); return; }
    // vm_youtube: a publication that failed is not a failed video.
    if (job.kind === YOUTUBE_JOB) { await youtubeGaveUp(job, f).catch(() => {}); return; }
    await store.update(job.videoId, { status: "error" }).catch(() => {});
  });
}

/** What the video's status should read while a given stage is waiting or running. */
export function statusForStage(kind: string): "transcribing" | "analyzing" {
  return kind === "analyze" ? "analyzing" : "transcribing";
}
