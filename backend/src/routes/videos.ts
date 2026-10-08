// src/routes/videos.ts
import { Router } from "express";
import fs from "fs/promises";
import crypto from "crypto";
import { store } from "../lib/store.js";
// vm_jobs: processing runs as durable jobs, not inside the request
import { listJobs, retryJob, deleteJobsForVideo } from "../lib/jobs.js";
import { nudgeRunner } from "../lib/runner.js";
import { NOT_RETRYABLE, statusForStage } from "../services/pipeline.js";
import { shelbyBlobUrl } from "../lib/shelbyClient.js";
import type { VideoRecord } from "../types/video.js";
// vm_apiguard: wallet checks and rate limits, see src/lib/guard.ts
import { limitUpload, limitPipeline, limitDelete, rateLimit } from "../lib/guard.js";
// vm_signin: the caller is the signed in wallet, never a value they send
import { requireAuth, optionalAuth, authOf, sameWallet } from "../lib/auth.js";
// vm_storage: every file of a video lives in storage
import { getStorage, ObjectMissingError, stableWindow } from "../lib/storage.js";
import { getOriginal, deleteAssetsForVideo, pictureKeys, PICTURE_KINDS, type PictureKind } from "../lib/assets.js";
// vm_upload: files arrive through /api/uploads (see src/routes/uploads.ts).
// The old reserve, prepare and confirm routes are gone.
import { abortUpload } from "../lib/uploads.js";
// vm_info: category, collection, tags, and who may open a video
import { ownsVideo, canView, parseInfo, applyInfo, InfoError, PRIVATE_VIDEO } from "../lib/videoInfo.js";
// vm_transcribe: how far a long transcription has come
import { transcriptionProgress } from "../services/transcribe.js";
// vm_captions
import { buildCues, toVtt, toSrt } from "../lib/captions.js";
// vm_chapters
import { parseChapters, ChapterError } from "../lib/chapters.js";
// vm_courses
import { courseOf } from "../lib/course.js";

/**
 * vm_transcribe: a library list needs chapters and a summary, not every
 * sentence of every video. A two hour lecture with word timing is close
 * to a megabyte, so the list leaves transcripts out.
 */
function forList(v: VideoRecord): VideoRecord {
  if (!v.ai?.transcript) return v;
  const { transcript: _t, ...ai } = v.ai;
  return { ...v, ai };
}
/** One video carries its sentences. The words in them are sent only when asked for (?words=1). */
function withoutWords(v: VideoRecord): VideoRecord {
  if (!v.ai?.transcript?.some((s) => s.words)) return v;
  return { ...v, ai: { ...v.ai, transcript: v.ai.transcript.map(({ words: _w, ...s }) => s) } };
}

const router = Router();

/** Remove a video's stored files, its jobs and any unfinished upload. Call before deleting the video. */
async function dropVideoWork(id: string): Promise<void> {
  const src = await store.getSourcePath(id);
  if (src) await fs.unlink(src).catch(() => {});
  await deleteJobsForVideo(id);
  await abortUpload(id, { keepVideo: true }).catch((err) =>
    console.error(`[uploads] could not discard the unfinished upload of ${id}: ${err?.message ?? err}`));
  // If storage cannot be reached the asset rows stay, and the hourly
  // sweep removes the files later. Deleting the video still succeeds.
  await deleteAssetsForVideo(id).catch((err) =>
    console.error(`[storage] could not delete the files of ${id} now, the sweep will retry: ${err?.message ?? err}`));
}

/** How long a playback address stays valid. */
const PLAY_URL_SECONDS = 12 * 60 * 60;

/** True once the owner has stored the file on Shelby. */
const onShelby = (v: VideoRecord) => !!v.shelby.accountAddress && !!v.shelby.videoTxHash;

const STAGE_LABEL: Record<string, string> = { transcribe: "Transcription", analyze: "Analysis" };

// vm_media: thumbnails. An address stays the same for six hours, so the
// browser keeps the picture instead of loading it again every time the
// library refreshes. A private video's pictures are as private as it is:
// the address is only ever given to someone allowed to open the video.
const PICTURE_WINDOW_SECONDS = 6 * 3600;
/** vm_search_page: card pictures for other lists (search results), same addresses as the library's. */
export async function thumbUrls(videoIds: string[]): Promise<Map<string, string | null>> {
  const keys = await pictureKeys(videoIds).catch(() => new Map<string, Partial<Record<PictureKind, string>>>());
  const out = new Map<string, string | null>();
  for (const id of videoIds) out.set(id, await pictureUrl(id, "thumb", keys.get(id)?.thumb));
  return out;
}
async function pictureUrl(videoId: string, kind: PictureKind, key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const signed = await getStorage().signedUrlStable(key, PICTURE_WINDOW_SECONDS).catch(() => null);
  if (signed) return signed;
  // Local disk storage: through this API, under a signature of our own.
  const exp = stableWindow(PICTURE_WINDOW_SECONDS).end;
  return `/api/videos/${videoId}/picture/${kind}?exp=${exp}&sig=${fileSignature(`${videoId}|${kind}`, exp)}`;
}

/** Saving a video's details is cheap, but it is still a write. */
const limitEdit = rateLimit({
  name: "video_edit",
  label: "edits",
  perClient: { max: Number(process.env.LIMIT_EDIT_PER_CLIENT_10MIN) || 120, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_EDIT_GLOBAL_10MIN) || 3000,    windowMs: 10 * 60_000 },
});

// vm_info: with local disk storage the player reads the file through this
// API, and a video element cannot send a session token. The address
// carries a signature that runs out instead, the same way an address
// into the bucket does. The secret lives only in this process.
const fileSecret = crypto.randomBytes(32);
const fileSignature = (id: string, exp: number) =>
  crypto.createHmac("sha256", fileSecret).update(`${id}|${exp}`).digest("hex");
function signedFilePath(id: string, seconds: number): string {
  const exp = Date.now() + seconds * 1000;
  return `/api/videos/${id}/file?exp=${exp}&sig=${fileSignature(id, exp)}`;
}
function fileSignatureOk(id: string, exp: number, sig: unknown): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() || typeof sig !== "string") return false;
  const want = Buffer.from(fileSignature(id, exp), "hex");
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const NOT_OWNER = { error: "This video belongs to a different wallet.", code: "not_owner" };

// ── POST /api/videos/:id/anchor ──────────────────────────────────────────────
// vm_upload: the owner's wallet has stored the file on Shelby. Record
// where, so the ownership proof can be shown. Storing on Shelby is its
// own step after the upload, and can be done or repeated at any time.
router.post("/:id/anchor", limitUpload, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const { accountAddress, txHash } = (req.body ?? {}) as { accountAddress?: string; txHash?: string };
    if (!accountAddress || !txHash) return res.status(400).json({ error: "accountAddress and txHash are required" });
    // The Shelby blob must belong to the signed in wallet.
    if (!sameWallet(accountAddress, wallet)) {
      return res.status(403).json({ error: "accountAddress must be the signed in wallet.", code: "not_owner" });
    }
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, wallet)) return res.status(403).json(NOT_OWNER);
    if (video.status === "uploading") return res.status(409).json({ error: "Finish the upload first.", code: "not_uploaded" });

    await store.update(video.id, {
      shelby: { videoBlobName: video.shelby.videoBlobName, accountAddress: wallet, videoTxHash: String(txHash).slice(0, 200) },
    });
    return res.json({ id: video.id, onShelby: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos?wallet=0x... ─────────────────────────────────────────────
// Returns the signed in wallet's videos. Any wallet value sent by the
// caller is ignored.
router.get("/", requireAuth, async (req, res) => {
  try {
    const list = await store.getAll(authOf(req)!.wallet);
    // vm_media: each card's thumbnail. One query for the keys; signing needs no network.
    const keys = await pictureKeys(list.map((v) => v.id)).catch(() => new Map());
    const videos = await Promise.all(list.map(async (v) => ({ ...forList(v), thumbUrl: await pictureUrl(v.id, "thumb", keys.get(v.id)?.thumb) })));
    return res.json({ videos });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id ─────────────────────────────────────────────────────
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    // vm_info: a private video opens only for its owner. Nothing about it is sent to anyone else.
    const wallet = authOf(req)?.wallet;
    if (!canView(video, wallet)) return res.status(403).json(PRIVATE_VIDEO);

    // vm_upload: play from our own storage when the original is there,
    // otherwise from Shelby. Storage is the copy made for delivery.
    const original = video.status === "uploading" ? null : await getOriginal(video.id);
    let streamUrl: string | null = null;
    let source: "storage" | "shelby" | null = null;
    if (original) {
      streamUrl = (await getStorage().signedUrl(original.key, PLAY_URL_SECONDS).catch(() => null))
        ?? signedFilePath(video.id, PLAY_URL_SECONDS);   // local disk storage has no signed addresses of its own
      source = "storage";
    } else if (onShelby(video) && video.shelby.videoBlobName) {
      streamUrl = shelbyBlobUrl(video.shelby.videoBlobName, video.shelby.accountAddress);
      source = "shelby";
    }

    // vm_media: the picture shown before playback starts, and the small one for cards
    const pics = (await pictureKeys([video.id]).catch(() => new Map())).get(video.id);
    const posterUrl = await pictureUrl(video.id, "poster", pics?.poster);
    const thumbUrl = await pictureUrl(video.id, "thumb", pics?.thumb);

    const body = req.query.words === "1" ? video : withoutWords(video);
    // vm_courses: its place in its course, among the lessons this wallet may open
    const course = await courseOf(video, wallet).catch(() => null);
    return res.json({ ...body, streamUrl, source, posterUrl, thumbUrl, onShelby: onShelby(video), isOwner: ownsVideo(video, wallet), course });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id/file ────────────────────────────────────────────────
// vm_upload: local disk storage only (development). Streams the original
// with range support so the player can seek. With S3 storage the player
// gets a signed address to the bucket instead and this answers 404.
// vm_info: only with the signature that GET /api/videos/:id hands out.
router.get("/:id/file", async (req, res) => {
  try {
    if (!fileSignatureOk(req.params.id, Number(req.query.exp), req.query.sig)) {
      return res.status(403).json({ error: "This playback address is not valid or has run out. Reload the page." });
    }
    const storage = getStorage();
    const original = storage.driver === "local" ? await getOriginal(req.params.id) : null;
    if (!original) return res.status(404).json({ error: "Not found" });
    await storage.withLocalFile(original.key, (filePath) => new Promise<void>((resolve, reject) => {
      res.type(original.contentType ?? "video/mp4");
      res.sendFile(filePath, { acceptRanges: true }, (err) => (err && !res.headersSent ? reject(err) : resolve()));
    }));
  } catch (err: any) {
    if (err instanceof ObjectMissingError) return res.status(404).json({ error: "Not found" });
    if (!res.headersSent) return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id/picture/:kind ───────────────────────────────────────
// vm_media: local disk storage only. With S3 storage the page gets a
// signed address to the bucket instead and this answers 404.
router.get("/:id/picture/:kind", async (req, res) => {
  try {
    const kind = req.params.kind as PictureKind;
    if (!PICTURE_KINDS.includes(kind)) return res.status(404).json({ error: "Not found" });
    if (!fileSignatureOk(`${req.params.id}|${kind}`, Number(req.query.exp), req.query.sig)) {
      return res.status(403).json({ error: "This picture address is not valid or has run out." });
    }
    const storage = getStorage();
    const key = storage.driver === "local" ? (await pictureKeys([req.params.id])).get(req.params.id)?.[kind] : undefined;
    if (!key) return res.status(404).json({ error: "Not found" });
    await storage.withLocalFile(key, async (filePath) => {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(await fs.readFile(filePath));
    });
  } catch (err: any) {
    if (!res.headersSent) res.status(404).json({ error: "Not found" });
  }
});

// ── GET /api/videos/:id/cover ────────────────────────────────────────────────
// vm_knowledge: the picture link previews show (Open Graph and Twitter).
// A page names this one stable address; it sends the reader on to a
// fresh signed address for the poster, or the thumbnail if there is no
// poster. Private videos have no cover here, as nothing about them is
// given to anyone but the owner.
router.get("/:id/cover", async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video || (video.visibility ?? "unlisted") === "private") return res.status(404).json({ error: "Not found" });
    const pics = (await pictureKeys([video.id]).catch(() => new Map())).get(video.id);
    const kind: PictureKind | null = pics?.poster ? "poster" : pics?.thumb ? "thumb" : null;
    const url = kind ? await pictureUrl(video.id, kind, pics?.[kind]) : null;
    if (!url) return res.status(404).json({ error: "Not found" });
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.redirect(302, url);
  } catch (err: any) {
    if (!res.headersSent) res.status(404).json({ error: "Not found" });
  }
});

// ── GET /api/videos/:id/captions ──────────────────────────────────────────────
// vm_captions: captions cut from the transcript for reading on screen.
// WebVTT by default (the player), ?format=srt for SubRip, ?download=1 to
// save it as a file. Anyone who can watch the video can read them.
router.get("/:id/captions", optionalAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!canView(video, authOf(req)?.wallet)) return res.status(403).json(PRIVATE_VIDEO);
    const cues = buildCues(video.ai?.transcript ?? []);
    if (!cues.length) return res.status(404).json({ error: "This video has no captions.", code: "no_captions" });
    const srt = req.query.format === "srt";
    res.setHeader("Content-Type", srt ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8");
    // Captions change only when the video is transcribed again. Private ones are never kept by shared caches.
    res.setHeader("Cache-Control", "private, max-age=300");
    if (req.query.download === "1") {
      const name = (video.title ?? "captions").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "captions";
      res.setHeader("Content-Disposition", `attachment; filename="${name}.${srt ? "srt" : "vtt"}"`);
    }
    return res.send(srt ? toSrt(cues) : toVtt(cues));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id/status ──────────────────────────────────────────────
router.get("/:id/status", optionalAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!canView(video, authOf(req)?.wallet)) return res.status(403).json(PRIVATE_VIDEO);
    return res.json({ id: video.id, status: video.status });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/videos/:id/jobs ──────────────────────────────────────────────────
// vm_jobs: the processing stages of one video and where each stands.
// Anyone with the link sees the stages. Only the owner sees the failure
// text and is offered a retry.
router.get("/:id/jobs", optionalAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    const wallet = authOf(req)?.wallet;
    if (!canView(video, wallet)) return res.status(403).json(PRIVATE_VIDEO);
    const owner = !!wallet && ownsVideo(video, wallet);
    // vm_transcribe: a long transcription says how many of its pieces are done
    const progress = await transcriptionProgress(req.params.id).catch(() => null);
    // vm_media: the thumbnail job is not a step anyone waits for, so it is not listed
    const jobs = (await listJobs(req.params.id)).filter((j) => STAGE_LABEL[j.kind]).map((j) => ({
      progress: j.kind === "transcribe" && j.status !== "succeeded" ? progress : null,
      kind: j.kind,
      label: STAGE_LABEL[j.kind] ?? j.kind,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      nextAttemptAt: j.status === "queued" && j.attempts > 0 ? j.runAfter : null,
      error: owner ? j.error : null,
      // vm_upload: lets the page give the right advice for this kind of failure
      errorCode: owner ? j.errorCode ?? null : null,
      canRetry: owner && j.status === "failed" && !NOT_RETRYABLE.has(j.errorCode ?? ""),
    }));
    return res.json({ id: video.id, status: video.status, jobs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/videos/:id/jobs/:kind/retry ──────────────────────────────────────
// vm_jobs: run one failed stage again. Stages that already finished are
// not repeated.
router.post("/:id/jobs/:kind/retry", limitPipeline, requireAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, authOf(req)!.wallet)) return res.status(403).json(NOT_OWNER);

    if (!STAGE_LABEL[req.params.kind]) return res.status(404).json({ error: "There is no such step." });
    const failed = (await listJobs(video.id)).find((j) => j.kind === req.params.kind && j.status === "failed");
    if (!failed) return res.status(409).json({ error: "That step is not in a failed state." });
    if (NOT_RETRYABLE.has(failed.errorCode ?? "")) {
      return res.status(409).json({ error: failed.error ?? "That step cannot be retried." });
    }

    const job = await retryJob(video.id, req.params.kind);
    if (!job) return res.status(409).json({ error: "That step is not in a failed state." });
    await store.update(video.id, { status: statusForStage(job.kind) });
    nudgeRunner();
    return res.status(202).json({ id: video.id, status: statusForStage(job.kind) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/videos/:id/chapters ─────────────────────────────────────────────
// vm_chapters: the owner replaces the video's chapters with their own.
// Body: { chapters: [{ title, startSeconds, summary? }] }. An empty list
// removes them all. The answer is the chapters as saved, in order.
router.put("/:id/chapters", limitEdit, requireAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, authOf(req)!.wallet)) return res.status(403).json(NOT_OWNER);
    if (video.status !== "ready") return res.status(409).json({ error: "Chapters can be edited once the video is ready.", code: "not_ready" });
    const transcriptEnd = Math.max(0, ...(video.ai?.transcript ?? []).map((s) => s.end));
    const length = video.meta?.durationSeconds ?? video.media?.durationSeconds ?? (transcriptEnd > 0 ? transcriptEnd + 1 : null);
    const chapters = parseChapters(req.body, length);
    await store.update(video.id, { ai: { chapters } });
    return res.json({ chapters });
  } catch (err: any) {
    if (err instanceof ChapterError) return res.status(400).json({ error: err.message, code: err.code, index: err.index });
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/videos/:id ────────────────────────────────────────────────────
// vm_info: the owner changes the video's details. Only the fields that
// are sent change. Body: any of title, description, category, visibility,
// tags, collectionId (null takes it out), newCollection (a name).
router.patch("/:id", limitEdit, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, wallet)) return res.status(403).json(NOT_OWNER);
    await applyInfo(video.id, wallet, parseInfo(req.body));
    const v = (await store.get(video.id))!;
    return res.json({
      id: v.id, title: v.title, description: v.description ?? "", category: v.category ?? null,
      visibility: v.visibility, tags: v.tags ?? [], collection: v.collection ?? null,
    });
  } catch (err: any) {
    if (err instanceof InfoError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/videos/:id/duration ───────────────────────────────────────────
// Called once by the frontend player when video metadata loads.
router.patch("/:id/duration", requireAuth, async (req, res) => {
  try {
    const { durationSeconds } = req.body as { durationSeconds: number };
    if (typeof durationSeconds !== "number" || !isFinite(durationSeconds) || durationSeconds <= 0) {
      return res.status(400).json({ error: "durationSeconds must be a positive number" });
    }

    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, authOf(req)!.wallet)) return res.status(403).json(NOT_OWNER);

    await store.update(req.params.id, {
      meta: { ...video.meta, durationSeconds },
    });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/videos/all?wallet=0x... ─────────────────────────────────────
// Deletes all of the signed in wallet's videos. Any wallet value sent by
// the caller is ignored.
router.delete("/all", limitDelete, requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    for (const v of await store.getAll(wallet)) await dropVideoWork(v.id);
    const count = await store.deleteAll(wallet);
    return res.json({
      success: true,
      deleted: count,
      message: `Deleted ${count} video(s) for wallet ${wallet.slice(0, 8)}...`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/videos/:id ───────────────────────────────────────────────────
router.delete("/:id", limitDelete, requireAuth, async (req, res) => {
  try {
    const video = await store.get(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    if (!ownsVideo(video, authOf(req)!.wallet)) return res.status(403).json(NOT_OWNER);
    await dropVideoWork(req.params.id);
    await store.delete(req.params.id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
