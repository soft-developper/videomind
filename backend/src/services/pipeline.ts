// src/services/pipeline.ts
// vm_jobs: the processing stages, as job handlers.
//
//   transcribe  Whisper reads the stored original -> transcript saved
//   analyze     Claude reads the transcript      -> summary, chapters, highlights
//
// Each handler first checks whether its work is already saved and skips
// it if so. That makes a retry, or a job taken over after a crash, cost
// nothing for the parts that already finished.
import fs from "fs/promises";
import { transcribeVideo, analyzeWithClaude } from "./aiPipeline.js";
import { store } from "../lib/store.js";
import { enqueueJob, retryJob, type Job } from "../lib/jobs.js";
import { PermanentJobError, registerHandler, setFinalFailureHook, nudgeRunner } from "../lib/runner.js";
// vm_storage: the original is read from storage, and AI usage is attributed to the owner
import { getStorage, ObjectMissingError } from "../lib/storage.js";
import { getOriginal, deleteOriginal, keepOriginal } from "../lib/assets.js";
import { withUsage, ownerOf } from "../lib/usage.js";
import type { TranscriptSegment, VideoAIData } from "../types/video.js";

/** OpenAI's documented limit for one transcription file. */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Failure codes that no retry can fix. The retry button is hidden for
 * these. "bad_request" is NOT here on purpose: the queue does not retry it
 * by itself, but once the operator fixes the cause (an API key, a model
 * name) the owner must be able to run the stage again.
 */
export const NOT_RETRYABLE = new Set(["too_large", "source_missing", "video_gone", "no_transcript", "no_handler"]);

export interface PipelineDeps {
  transcribe: (filePath: string) => Promise<TranscriptSegment[]>;
  analyze: (transcript: TranscriptSegment[], title: string) => Promise<Omit<VideoAIData, "transcript">>;
}

/**
 * Turn an AI provider error into a retry decision. A 4xx answer means
 * the request itself is wrong (bad file, unknown model, bad key), so the
 * same request would fail again. Timeouts, rate limits and 5xx are worth
 * another try.
 */
function classify(err: any, stage: string): never {
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

    if (!video.ai?.transcript?.length) {
      // The original lives in storage. A video confirmed before storage
      // existed may still point at a file on this machine's disk.
      const original = await getOriginal(job.videoId);
      const diskPath = original ? "" : ((job.payload.filePath as string | undefined) ?? (await store.getSourcePath(job.videoId)) ?? "");
      const size = original ? original.bytes : (diskPath ? (await fs.stat(diskPath).catch(() => null))?.size : undefined);
      const gone = () => new PermanentJobError("source_missing", "The uploaded file is no longer in storage. Upload the video again.");
      if (size === undefined) throw gone();
      if (size > TRANSCRIBE_MAX_BYTES) {
        throw new PermanentJobError("too_large",
          `This file is ${(size / 1024 / 1024).toFixed(1)} MB, which is over the 25 MB transcription limit.`);
      }
      await store.update(job.videoId, { status: "transcribing" });
      const run = (filePath: string) => withUsage(
        { feature: "transcribe", ownerWallet: ownerOf(video), videoId: job.videoId, jobId: job.id },
        () => deps.transcribe(filePath));
      let transcript: TranscriptSegment[];
      try {
        transcript = original ? await getStorage().withLocalFile(original.key, run) : await run(diskPath);
      } catch (err) {
        if (err instanceof ObjectMissingError) throw gone();
        classify(err, "Transcription");
      }
      await store.update(job.videoId, { ai: { transcript: transcript! } });
    }

    // Hand over to analysis. If an analyze job is already there from an
    // earlier run: a failed one is restarted, a finished one means the
    // video is ready.
    const { job: next, created } = await enqueueJob({ videoId: job.videoId, kind: "analyze" });
    if (!created && next.status === "failed") await retryJob(job.videoId, "analyze");
    const done = !created && next.status === "succeeded";
    await store.update(job.videoId, { status: done ? "ready" : "analyzing" });
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
      // The current analyzer hides an unreadable answer behind a
      // placeholder. Treat that as a failure worth another attempt.
      if (!ai!.summary || (ai!.summary === "Analysis pending." && !ai!.chapters?.length)) {
        throw new Error("The analysis came back unreadable.");
      }
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
export function registerPipeline(deps: PipelineDeps = { transcribe: transcribeVideo, analyze: analyzeWithClaude }) {
  const h = makeHandlers(deps);
  registerHandler("transcribe", h.transcribe);
  registerHandler("analyze", h.analyze);
  // A stage that failed for good marks the video, so the page stops waiting.
  setFinalFailureHook(async (job) => {
    await store.update(job.videoId, { status: "error" }).catch(() => {});
  });
}

/** What the video's status should read while a given stage is waiting or running. */
export function statusForStage(kind: string): "transcribing" | "analyzing" {
  return kind === "analyze" ? "analyzing" : "transcribing";
}
