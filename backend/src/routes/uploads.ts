// src/routes/uploads.ts
// vm_upload: resumable uploads. See src/lib/uploads.ts for how it works.
import { Router, type Request, type Response, type NextFunction } from "express";
import { limitUpload, limitPipeline, limitDelete, rateLimit } from "../lib/guard.js";
import { requireAuth, authOf, sameWallet } from "../lib/auth.js";
import { getStorage, storageHealth, checkStorage } from "../lib/storage.js";
import {
  createUpload, getUpload, uploadState, partUrls, completeUpload, abortUpload, listOpenUploads,
  checkLocalSignature, UploadError, PART_URL_SECONDS, type UploadRow,
} from "../lib/uploads.js";
// vm_info: the details typed in the upload form
import { parseInfo, InfoError } from "../lib/videoInfo.js";

const router = Router();

/** Asking for part addresses happens many times in one upload, so it has its own generous limit. */
const limitParts = rateLimit({
  name: "upload_parts",
  label: "upload requests",
  perClient: { max: Number(process.env.LIMIT_UPLOAD_PARTS_PER_CLIENT_10MIN) || 1200, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_UPLOAD_PARTS_GLOBAL_10MIN) || 12000,   windowMs: 10 * 60_000 },
});

/** Refuse a new upload while storage is not working. A failed check is tried again at most every 30 seconds. */
let lastRecheck = 0;
async function requireStorage(_req: Request, res: Response, next: NextFunction) {
  if (!storageHealth().ok && Date.now() - lastRecheck > 30_000) {
    lastRecheck = Date.now();
    await checkStorage().catch(() => false);
  }
  if (storageHealth().ok) return next();
  return res.status(503).json({
    error: "Video storage is not available right now. Please try again in a few minutes.",
    code: "storage_unavailable",
  });
}

function fail(res: Response, err: any) {
  if (err instanceof UploadError || err instanceof InfoError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
  console.error(`[uploads] ${err?.name ?? "Error"}: ${err?.message ?? err}`);
  return res.status(500).json({ error: "The upload service hit a problem. Please try again." });
}

/** Load the upload and check the caller owns it. Sends the error itself and returns null if not. */
async function owned(req: Request, res: Response): Promise<UploadRow | null> {
  const u = await getUpload(req.params.id);
  if (!u) { res.status(404).json({ error: "Upload not found.", code: "not_found" }); return null; }
  if (!sameWallet(u.ownerWallet, authOf(req)!.wallet)) {
    res.status(403).json({ error: "This upload belongs to a different wallet.", code: "not_owner" }); return null;
  }
  return u;
}

const describe = (u: UploadRow) => ({
  videoId: u.videoId, filename: u.filename, size: u.size, partSize: u.partSize, partCount: u.partCount, status: u.status,
});

// ── POST /api/uploads ───────────────────────────────────────────────────────
// Reserve a video and open its upload. No file bytes come through here.
router.post("/", limitUpload, requireAuth, requireStorage, async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const u = await createUpload({
      wallet: authOf(req)!.wallet,
      filename: String(b.filename ?? ""), size: Number(b.size),
      contentType: typeof b.contentType === "string" ? b.contentType : undefined,
      // A blank title is allowed here: it is then taken from the file name.
      info: parseInfo({ ...b, title: typeof b.title === "string" && b.title.trim() ? b.title : undefined }),
    });
    return res.status(201).json({ ...describe(u), title: u.title, videoBlobName: u.videoBlobName, done: [], uploadedBytes: 0 });
  } catch (err) { return fail(res, err); }
});

// ── GET /api/uploads ────────────────────────────────────────────────────────
// The caller's unfinished uploads, so they can be resumed from any browser.
router.get("/", requireAuth, async (req, res) => {
  try {
    const list = await listOpenUploads(authOf(req)!.wallet);
    return res.json({ uploads: list.map((u) => ({ ...describe(u), title: u.title, uploadedBytes: u.uploadedBytes, createdAt: u.createdAt })) });
  } catch (err) { return fail(res, err); }
});

// ── GET /api/uploads/:id ────────────────────────────────────────────────────
// Which parts have arrived.
router.get("/:id", limitParts, requireAuth, async (req, res) => {
  try {
    const u = await owned(req, res); if (!u) return;
    if (u.status === "aborted") return res.json({ ...describe(u), done: [], uploadedBytes: 0 });
    if (u.status !== "open") {
      // Being joined, or already joined: every part has arrived.
      return res.json({ ...describe(u), done: Array.from({ length: u.partCount }, (_, i) => i + 1), uploadedBytes: u.size });
    }
    const state = await uploadState(u);
    return res.json({ ...describe(u), done: state.done, uploadedBytes: state.uploadedBytes });
  } catch (err) { return fail(res, err); }
});

// ── POST /api/uploads/:id/parts ─────────────────────────────────────────────
// Addresses to send parts to. Body: { parts: [1, 2, 3] }, at most 100 at a time.
router.post("/:id/parts", limitParts, requireAuth, async (req, res) => {
  try {
    const u = await owned(req, res); if (!u) return;
    if (u.status !== "open") return res.status(409).json({ error: "This upload is already finished or discarded.", code: "not_open" });
    const parts = (req.body as { parts?: unknown })?.parts;
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > 100) {
      return res.status(400).json({ error: "parts must list 1 to 100 part numbers.", code: "bad_part" });
    }
    const urls = await partUrls(u, parts.map(Number));
    return res.json({ urls, expiresIn: PART_URL_SECONDS });
  } catch (err) { return fail(res, err); }
});

// ── PUT /api/uploads/:id/parts/:n ───────────────────────────────────────────
// Local disk storage only: the part comes through the API. With S3
// storage the browser sends parts straight to the bucket and this route
// answers 404. The signature in the address is the credential.
router.put("/:id/parts/:n", limitParts, async (req, res) => {
  try {
    const u = await getUpload(req.params.id);
    const n = Number(req.params.n);
    if (!u || u.status !== "open" || getStorage().driver !== "local") return res.status(404).json({ error: "Not found." });
    if (!Number.isInteger(n) || n < 1 || n > u.partCount) return res.status(400).json({ error: "No such part.", code: "bad_part" });
    if (!checkLocalSignature(u, n, Number(req.query.exp), String(req.query.sig ?? ""))) {
      return res.status(403).json({ error: "This upload address has expired. Ask for a new one.", code: "expired_url" });
    }
    const { size } = await getStorage().writePart(u.key, u.uploadId, n, req, u.partSize);
    return res.status(200).json({ part: n, size });
  } catch (err: any) {
    if (/larger than the part size/.test(String(err?.message))) return res.status(413).json({ error: err.message, code: "part_too_large" });
    return fail(res, err);
  }
});

// ── POST /api/uploads/:id/complete ──────────────────────────────────────────
router.post("/:id/complete", limitPipeline, requireAuth, async (req, res) => {
  try {
    const u = await owned(req, res); if (!u) return;
    return res.status(200).json(await completeUpload(u.videoId));
  } catch (err) { return fail(res, err); }
});

// ── DELETE /api/uploads/:id ─────────────────────────────────────────────────
// Discard an unfinished upload.
router.delete("/:id", limitDelete, requireAuth, async (req, res) => {
  try {
    const u = await owned(req, res); if (!u) return;
    if (u.status !== "open") return res.status(409).json({ error: "This upload is already finished. Delete the video instead.", code: "not_open" });
    await abortUpload(u.videoId);
    return res.json({ success: true });
  } catch (err) { return fail(res, err); }
});

export default router;
