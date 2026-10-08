// src/routes/clips.ts
// vm_clips: the owner's clips of a video (see lib/clips.ts). Mounted at /api/videos.
//
//   GET    /:id/clips                      the clips, newest first
//   POST   /:id/clips                      make one { kind, frame?, captions?, startSeconds, endSeconds, title? }
//   POST   /:id/clips/:clipId/retry        try a failed clip again
//   DELETE /:id/clips/:clipId              delete a clip and its file
//   GET    /:id/clips/:clipId/download     a short lived address to download the file
//   GET    /:id/clips/:clipId/captions     the clip's captions as SubRip (.srt)
//   GET    /:id/clips/:clipId/file         local disk storage only, behind a signature
import { Router } from "express";
import crypto from "crypto";
import { store } from "../lib/store.js";
import { requireAuth, authOf } from "../lib/auth.js";
import { ownsVideo } from "../lib/videoInfo.js";
import { rateLimit } from "../lib/guard.js";
import { getStorage, ObjectMissingError } from "../lib/storage.js";
import { getOriginal, getAssetById, deleteAssetById } from "../lib/assets.js";
import { mediaHealth } from "../lib/media.js";
import { getDb } from "../lib/db.js";
import {
  parseClip, ClipError, addClip, getClip, listClips, countClips, socialToday, deleteClipRow, srtForClip, updateClip,
  fileNameFor, LIMITS, CLIP_JOB, type Clip,
} from "../lib/clips.js";
import { queueClip } from "../services/clip.js";
import { nudgeRunner } from "../lib/runner.js";

const router = Router();

const limitClips = rateLimit({
  name: "clips",
  label: "clip requests",
  perClient: { max: Number(process.env.LIMIT_CLIPS_PER_CLIENT_10MIN) || 60, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_CLIPS_GLOBAL_10MIN) || 1000, windowMs: 10 * 60_000 },
});

const NOT_OWNER = { error: "This video belongs to a different wallet.", code: "not_owner" };

const view = (c: Clip) => ({
  id: c.id, kind: c.kind, frame: c.frame, captions: c.captions, startSeconds: c.startSeconds, endSeconds: c.endSeconds,
  title: c.title, status: c.status, note: c.note, error: c.error, sizeBytes: c.sizeBytes, fileName: c.fileName,
  createdAt: c.createdAt, updatedAt: c.updatedAt,
});

/** The video, if the signed in wallet owns it. Otherwise the response is sent and null returned. */
async function ownVideo(req: any, res: any) {
  const video = await store.get(req.params.id);
  if (!video) { res.status(404).json({ error: "Video not found" }); return null; }
  if (!ownsVideo(video, authOf(req)!.wallet)) { res.status(403).json(NOT_OWNER); return null; }
  return video;
}
async function ownClip(req: any, res: any) {
  const video = await ownVideo(req, res);
  if (!video) return null;
  const clip = await getClip(req.params.clipId);
  if (!clip || clip.videoId !== video.id) { res.status(404).json({ error: "Clip not found" }); return null; }
  return { video, clip };
}

router.get("/:id/clips", requireAuth, async (req, res) => {
  try {
    const video = await ownVideo(req, res); if (!video) return;
    return res.json({
      clips: (await listClips(video.id)).map(view),
      limits: { cutSeconds: LIMITS.cut, socialSeconds: LIMITS.social },
      canMake: !!mediaHealth().ffmpeg, captionsDrawn: mediaHealth().captions,
    });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.post("/:id/clips", limitClips, requireAuth, async (req, res) => {
  try {
    const video = await ownVideo(req, res); if (!video) return;
    if (video.status !== "ready") return res.status(409).json({ error: "Clips can be made once the video is ready.", code: "not_ready" });
    if (!mediaHealth().ffmpeg) return res.status(503).json({ error: "This server cannot make clips right now (FFmpeg is missing).", code: "no_ffmpeg" });
    if (!(await getOriginal(video.id))) return res.status(409).json({ error: "The original file is not in VideoMind's storage, so clips cannot be cut from it.", code: "no_original" });
    const c = parseClip(req.body, video);
    if ((await countClips(video.id)) >= LIMITS.perVideo) return res.status(409).json({ error: `A video can have up to ${LIMITS.perVideo} clips. Delete some first.`, code: "too_many" });
    if (c.kind === "social" && (await socialToday(authOf(req)!.wallet)) >= LIMITS.socialPerDay) {
      return res.status(429).json({ error: `You can start ${LIMITS.socialPerDay} social clips a day. Quick cuts are not limited this way.`, code: "social_limit" });
    }
    const clip = await addClip(video.id, authOf(req)!.wallet, c);
    await queueClip(video.id, clip.id);
    return res.status(202).json({ clip: view(clip) });
  } catch (err: any) {
    if (err instanceof ClipError) return res.status(err.status).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  }
});

router.post("/:id/clips/:clipId/retry", limitClips, requireAuth, async (req, res) => {
  try {
    const own = await ownClip(req, res); if (!own) return;
    if (own.clip.status !== "failed") return res.status(409).json({ error: "Only a clip that failed can be tried again.", code: "not_failed" });
    const now = Date.now();
    await getDb().execute({
      sql: `UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, error = NULL, error_code = NULL, finished_at = NULL, updated_at = ?
             WHERE idempotency_key = ? AND status = 'failed'`,
      args: [now, now, `${own.video.id}:${CLIP_JOB}:${own.clip.id}`],
    });
    await updateClip(own.clip.id, { status: "queued", error: null });
    nudgeRunner();
    return res.json({ clip: view((await getClip(own.clip.id))!) });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.delete("/:id/clips/:clipId", limitClips, requireAuth, async (req, res) => {
  try {
    const own = await ownClip(req, res); if (!own) return;
    if (own.clip.assetId) await deleteAssetById(own.clip.assetId);
    await deleteClipRow(own.clip.id);
    // A clip still waiting is not made.
    await getDb().execute({ sql: "DELETE FROM jobs WHERE idempotency_key = ? AND status != 'running'", args: [`${own.video.id}:${CLIP_JOB}:${own.clip.id}`] });
    return res.json({ deleted: own.clip.id });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

// Local disk storage has no signed addresses of its own: this API serves the file behind one.
const secret = crypto.randomBytes(32);
const sign = (id: string, exp: number) => crypto.createHmac("sha256", secret).update(`clip|${id}|${exp}`).digest("hex");
const DOWNLOAD_SECONDS = 60 * 60;

router.get("/:id/clips/:clipId/download", requireAuth, async (req, res) => {
  try {
    const own = await ownClip(req, res); if (!own) return;
    const asset = own.clip.status === "ready" && own.clip.assetId ? await getAssetById(own.clip.assetId) : null;
    if (!asset) return res.status(409).json({ error: "This clip is not ready yet.", code: "not_ready" });
    const url = await getStorage().signedUrl(asset.key, DOWNLOAD_SECONDS);
    if (url) return res.json({ url, fileName: own.clip.fileName });
    const exp = Date.now() + DOWNLOAD_SECONDS * 1000;
    return res.json({ url: `/api/videos/${own.video.id}/clips/${own.clip.id}/file?exp=${exp}&sig=${sign(own.clip.id, exp)}`, fileName: own.clip.fileName });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.get("/:id/clips/:clipId/file", async (req, res) => {
  try {
    const exp = Number(req.query.exp), sig = String(req.query.sig ?? "");
    const want = Buffer.from(sign(req.params.clipId, exp), "hex"), got = Buffer.from(sig, "hex");
    if (!Number.isFinite(exp) || exp < Date.now() || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      return res.status(403).json({ error: "This download address is not valid or has run out." });
    }
    const clip = await getClip(req.params.clipId);
    const asset = clip?.assetId && clip.videoId === req.params.id ? await getAssetById(clip.assetId) : null;
    if (!clip || !asset || getStorage().driver !== "local") return res.status(404).json({ error: "Not found" });
    await getStorage().withLocalFile(asset.key, (filePath) => new Promise<void>((resolve, reject) => {
      res.download(filePath, clip.fileName ?? "clip", (err) => (err && !res.headersSent ? reject(err) : resolve()));
    }));
  } catch (err: any) {
    if (err instanceof ObjectMissingError) return res.status(404).json({ error: "Not found" });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

router.get("/:id/clips/:clipId/captions", requireAuth, async (req, res) => {
  try {
    const own = await ownClip(req, res); if (!own) return;
    const text = srtForClip(own.video.ai?.transcript, own.clip);
    res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileNameFor(own.clip.title, own.clip.kind, own.clip.frame, ".srt")}"`);
    return res.send(text);
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

export default router;
