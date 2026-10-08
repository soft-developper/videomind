// src/lib/uploads.ts
// vm_upload: uploads that survive a broken connection.
//
// The browser cuts the file into equal parts and sends each part
// straight to storage. The server only hands out the addresses and keeps
// the record. A part that fails is sent again by itself; a part that
// arrived is never sent twice. Closing the tab or losing the network
// loses nothing: the next visit asks which parts are already there and
// continues from them.
//
//   create    reserve a video, open the upload, say how to cut the file
//   parts     addresses to send parts to (each valid for one hour)
//   state     which parts have arrived
//   complete  check every part, join them, start processing
//   abort     throw the parts away
import crypto from "crypto";
import path from "path";
import { getDb } from "./db.js";
import { store } from "./store.js";
import { getStorage, UploadMissingError, type PartInfo } from "./storage.js";
import { originalKey, registerOriginal, safeExt } from "./assets.js";
import { enqueueJob } from "./jobs.js";
import { nudgeRunner } from "./runner.js";
import type { VideoRecord } from "../types/video.js";
// vm_info: category, collection, tags and visibility given with the upload
import { applyInfo, type InfoPatch } from "./videoInfo.js";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Formats the rest of the pipeline can read. */
const ALLOWED_EXT = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);
/** How long a part address stays valid. The browser asks for new ones when they run out. */
export const PART_URL_SECONDS = 3600;
/** Uploads one wallet may have open at once. */
const MAX_OPEN_PER_WALLET = 5;

const envNumber = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** Largest file accepted. UPLOAD_MAX_BYTES overrides the 10 GB default. */
export const maxUploadBytes = () => envNumber("UPLOAD_MAX_BYTES", 10 * GIB);
/** An unfinished upload is thrown away after this long. R2 drops unfinished parts after 7 days too. */
const expireAfterMs = () => envNumber("UPLOAD_EXPIRE_DAYS", 7) * 24 * 60 * 60 * 1000;

/**
 * How to cut a file. Every part is the same size except the last, as
 * storage requires. 8 MiB keeps a retry cheap on a slow line; very large
 * files get bigger parts so the count stays under 10,000.
 */
export function planParts(size: number): { partSize: number; partCount: number } {
  const partSize = Math.max(8 * MIB, Math.ceil(size / 9000 / MIB) * MIB);
  return { partSize, partCount: Math.max(1, Math.ceil(size / partSize)) };
}

export class UploadError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message); this.name = "UploadError";
  }
}

export interface UploadRow {
  videoId: string; ownerWallet: string; uploadId: string; driver: string; key: string;
  filename: string; contentType: string | null; size: number; partSize: number; partCount: number;
  /** "completing" is held by the one request that is joining the parts */
  status: "open" | "completing" | "completed" | "aborted"; createdAt: number;
}

function rowToUpload(r: Record<string, unknown>): UploadRow {
  return {
    videoId: String(r.video_id), ownerWallet: String(r.owner_wallet), uploadId: String(r.upload_id),
    driver: String(r.storage_driver), key: String(r.storage_key), filename: String(r.filename),
    contentType: (r.content_type as string | null) ?? null, size: Number(r.size_bytes),
    partSize: Number(r.part_size), partCount: Number(r.part_count),
    status: String(r.status) as UploadRow["status"], createdAt: Number(r.created_at),
  };
}

export async function getUpload(videoId: string): Promise<UploadRow | null> {
  const res = await getDb().execute({ sql: "SELECT * FROM uploads WHERE video_id = ?", args: [videoId] });
  return res.rows[0] ? rowToUpload(res.rows[0] as Record<string, unknown>) : null;
}

/** The size the part with this number must have. */
function expectedSize(u: UploadRow, partNumber: number): number {
  return partNumber < u.partCount ? u.partSize : u.size - (u.partCount - 1) * u.partSize;
}

// ── create ────────────────────────────────────────────────────────────────

export async function createUpload(args: {
  wallet: string; filename: string; size: number; contentType?: string;
  /** vm_info: already checked by parseInfo */
  info?: InfoPatch;
}): Promise<UploadRow & { videoBlobName: string; title: string }> {
  const info = args.info ?? {};
  const filename = path.basename(String(args.filename ?? "")).slice(0, 200);
  const ext = path.extname(filename).toLowerCase();
  if (!filename || !ALLOWED_EXT.has(ext)) {
    throw new UploadError(415, "bad_type", "Unsupported file type. Use MP4, WebM, MOV, AVI or MKV.");
  }
  const size = Number(args.size);
  if (!Number.isInteger(size) || size <= 0) throw new UploadError(400, "bad_size", "size must be the file's size in bytes.");
  const max = maxUploadBytes();
  if (size > max) {
    throw new UploadError(413, "too_large", `That file is ${(size / GIB).toFixed(1)} GB. The largest upload is ${(max / GIB).toFixed(0)} GB.`);
  }
  const open = await getDb().execute({ sql: "SELECT COUNT(*) AS c FROM uploads WHERE owner_wallet = ? AND status = 'open'", args: [args.wallet] });
  if (Number((open.rows[0] as Record<string, unknown>).c) >= MAX_OPEN_PER_WALLET) {
    throw new UploadError(409, "too_many_open", `You have ${MAX_OPEN_PER_WALLET} unfinished uploads. Finish or discard one first.`);
  }

  const storage = getStorage();
  const videoId = crypto.randomUUID();
  const key = originalKey(videoId, ext);
  const contentType = /^video\/[\w.+-]+$/.test(args.contentType ?? "") ? args.contentType! : "video/mp4";
  const title = (String(info.title ?? "").trim() || path.basename(filename, path.extname(filename)).replace(/[-_]+/g, " ")).slice(0, 300);
  const { partSize, partCount } = planParts(size);
  const videoBlobName = `videomind/videos/${videoId}/raw${safeExt(ext)}`;

  let uploadId: string;
  try { uploadId = await storage.createMultipart(key, { contentType }); }
  catch (err: any) {
    console.error(`[uploads] storage would not open an upload: ${err?.name ?? "Error"}: ${err?.message ?? err}`);
    throw new UploadError(503, "storage_unavailable", "Video storage is not available right now. Please try again in a few minutes.");
  }
  const now = Date.now();
  const record: VideoRecord = {
    id: videoId, title, description: String(info.description ?? "").slice(0, 5000), createdAt: now, status: "uploading",
    ownerWallet: args.wallet,
    // vm_info: private unless the owner chose otherwise
    category: info.category ?? null, visibility: info.visibility ?? "private",
    // The Shelby name is reserved now and used when the owner stores the file there.
    shelby: { videoBlobName, accountAddress: "", videoTxHash: "" },
    meta: { sizeBytes: size, mimeType: contentType },
  };
  try {
    await store.set(videoId, record);
    await getDb().execute({
      sql: `INSERT INTO uploads (video_id, owner_wallet, upload_id, storage_driver, storage_key, filename, content_type,
                                 size_bytes, part_size, part_count, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      args: [videoId, args.wallet, uploadId, storage.driver, key, filename, contentType, size, partSize, partCount, now, now],
    });
    // Tags and collection. A collection that is not the caller's is refused here, and the catch below undoes the rest.
    await applyInfo(videoId, args.wallet, { tags: info.tags, collectionId: info.collectionId, newCollection: info.newCollection });
  } catch (err) {
    await storage.abortMultipart(key, uploadId).catch(() => {});
    await store.delete(videoId).catch(() => {});
    throw err;
  }
  return { ...(await getUpload(videoId))!, videoBlobName, title };
}

// ── state ─────────────────────────────────────────────────────────────────

export interface UploadState { done: number[]; uploadedBytes: number; parts: PartInfo[] }

/** Which parts have arrived whole. A part of the wrong size does not count and is sent again. */
export async function uploadState(u: UploadRow): Promise<UploadState> {
  let parts: PartInfo[];
  try { parts = await getStorage().listParts(u.key, u.uploadId); }
  catch (err) {
    if (err instanceof UploadMissingError) throw new UploadError(410, "expired", "This upload has expired in storage. Start it again.");
    throw err;
  }
  const good = parts.filter((p) => p.partNumber >= 1 && p.partNumber <= u.partCount && p.size === expectedSize(u, p.partNumber));
  return { done: good.map((p) => p.partNumber), uploadedBytes: good.reduce((n, p) => n + p.size, 0), parts: good };
}

// ── part addresses ────────────────────────────────────────────────────────

// For the local driver, parts come through this API. The address carries a
// short lived signature so the request needs no other credentials, the
// same way an S3 address does. The secret lives only in this process.
const localSecret = crypto.randomBytes(32);
function localSignature(u: UploadRow, partNumber: number, exp: number): string {
  return crypto.createHmac("sha256", localSecret).update(`${u.videoId}|${u.uploadId}|${partNumber}|${exp}`).digest("hex");
}
export function checkLocalSignature(u: UploadRow, partNumber: number, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = Buffer.from(localSignature(u, partNumber, exp), "hex");
  const got = Buffer.from(String(sig ?? ""), "hex");
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Addresses to PUT the given parts to. A relative address means "this API". */
export async function partUrls(u: UploadRow, partNumbers: number[]): Promise<Record<number, string>> {
  const storage = getStorage();
  const out: Record<number, string> = {};
  for (const n of partNumbers) {
    if (!Number.isInteger(n) || n < 1 || n > u.partCount) {
      throw new UploadError(400, "bad_part", `Part ${n} does not exist. This upload has parts 1 to ${u.partCount}.`);
    }
    const direct = await storage.signPart(u.key, u.uploadId, n, PART_URL_SECONDS);
    if (direct) { out[n] = direct; continue; }
    const exp = Date.now() + PART_URL_SECONDS * 1000;
    out[n] = `/api/uploads/${u.videoId}/parts/${n}?exp=${exp}&sig=${localSignature(u, n, exp)}`;
  }
  return out;
}

// ── complete ──────────────────────────────────────────────────────────────

/** How long one request may hold an upload while joining it, before another may take over. */
const CLAIM_MS = 60_000;

/**
 * Only one request may join an upload. This takes it in a single
 * statement, so two requests arriving together cannot both win. A claim
 * left behind by a request that died can be taken over after a minute.
 */
async function claim(videoId: string): Promise<boolean> {
  const now = Date.now();
  const r = await getDb().execute({
    sql: `UPDATE uploads SET status = 'completing', updated_at = ?
           WHERE video_id = ? AND (status = 'open' OR (status = 'completing' AND updated_at < ?))`,
    args: [now, videoId, now - CLAIM_MS],
  });
  return r.rowsAffected === 1;
}
const release = (videoId: string) =>
  getDb().execute({ sql: "UPDATE uploads SET status = 'open', updated_at = ? WHERE video_id = ? AND status = 'completing'", args: [Date.now(), videoId] });

/**
 * Check that every part arrived whole, join them, record the file and
 * start processing. Safe to call twice, or from two requests at once:
 * the file is joined, recorded and queued exactly once.
 */
export async function completeUpload(videoId: string): Promise<{ id: string; status: string }> {
  for (let waited = 0; ; waited += 250) {
    const u = await getUpload(videoId);
    if (!u) throw new UploadError(404, "not_found", "Upload not found.");
    if (u.status === "aborted") throw new UploadError(410, "aborted", "This upload was discarded.");
    if (u.status === "completed") return finish(u);
    if (await claim(videoId)) break;
    // Another request is joining it right now. Wait for that one.
    if (waited >= 30_000) throw new UploadError(409, "busy", "This upload is being finished by another request. Try again in a moment.");
    await new Promise((r) => setTimeout(r, 250));
  }

  const u = (await getUpload(videoId))!;
  const storage = getStorage();
  try {
    // An earlier request may have joined the parts and died before
    // recording it. Then the parts are gone but the whole file is there.
    const wholeFileIsThere = async () => {
      const whole = await storage.head(u.key).catch(() => null);
      return !!whole && whole.size === u.size;
    };

    let state: UploadState | null = null;
    try { state = await uploadState(u); }
    catch (err) { if (!(await wholeFileIsThere())) throw err; }

    if (state) {
      if (state.done.length !== u.partCount) {
        const have = new Set(state.done);
        const missing = Array.from({ length: u.partCount }, (_, i) => i + 1).filter((n) => !have.has(n));
        throw new UploadError(409, "incomplete", `${missing.length} of ${u.partCount} parts have not arrived yet.`, { missing: missing.slice(0, 1000) });
      }
      try {
        await storage.completeMultipart(u.key, u.uploadId, state.parts);
      } catch (err) {
        if (!(await wholeFileIsThere())) {
          if (err instanceof UploadMissingError) throw new UploadError(410, "expired", "This upload has expired in storage. Start it again.");
          throw err;
        }
      }
    }
    const head = await storage.head(u.key);
    if (!head || head.size !== u.size) {
      await storage.delete(u.key).catch(() => {});
      throw new UploadError(502, "size_mismatch", "The stored file does not have the expected size. Upload it again.");
    }
    await registerOriginal({ videoId, key: u.key, bytes: u.size, contentType: u.contentType, ownerWallet: u.ownerWallet });
    const now = Date.now();
    await getDb().execute({ sql: "UPDATE uploads SET status = 'completed', completed_at = ?, updated_at = ? WHERE video_id = ?", args: [now, now, videoId] });
  } catch (err) {
    await release(videoId).catch(() => {});
    throw err;
  }
  return finish((await getUpload(videoId))!);
}

/** Queue processing for a completed upload. One job per video, however often this runs. */
async function finish(u: UploadRow): Promise<{ id: string; status: string }> {
  // vm_media: thumbnail and video facts (see src/services/inspect.ts). Queued
  // first because it is short: the card gets its picture while transcription runs.
  await enqueueJob({ videoId: u.videoId, kind: "inspect" });
  const { created } = await enqueueJob({ videoId: u.videoId, kind: "transcribe" });
  if (created) await store.update(u.videoId, { status: "transcribing" });
  nudgeRunner();
  const video = await store.get(u.videoId);
  return { id: u.videoId, status: video?.status ?? "transcribing" };
}

// ── abort ─────────────────────────────────────────────────────────────────

/** Discard an unfinished upload and the video entry reserved for it. */
export async function abortUpload(videoId: string, opts: { keepVideo?: boolean } = {}): Promise<boolean> {
  const u = await getUpload(videoId);
  if (!u || u.status !== "open") return false;
  await getStorage().abortMultipart(u.key, u.uploadId);
  await getDb().execute({ sql: "UPDATE uploads SET status = 'aborted', updated_at = ? WHERE video_id = ?", args: [Date.now(), videoId] });
  if (!opts.keepVideo) await store.delete(videoId);
  return true;
}

// ── lists and housekeeping ────────────────────────────────────────────────

export async function listOpenUploads(wallet: string): Promise<Array<UploadRow & { title: string; uploadedBytes: number }>> {
  const res = await getDb().execute({
    sql: `SELECT u.*, v.title AS title FROM uploads u JOIN videos v ON v.id = u.video_id
           WHERE u.owner_wallet = ? AND u.status = 'open' ORDER BY u.created_at DESC`,
    args: [wallet],
  });
  const out: Array<UploadRow & { title: string; uploadedBytes: number }> = [];
  for (const r of res.rows) {
    const u = rowToUpload(r as Record<string, unknown>);
    const state = await uploadState(u).catch(() => null);
    if (!state) continue;                        // expired in storage: the sweep removes it
    out.push({ ...u, title: String((r as Record<string, unknown>).title ?? u.filename), uploadedBytes: state.uploadedBytes });
  }
  return out;
}

/** Discard uploads nobody came back to. Returns how many were removed. */
export async function sweepUploads(): Promise<number> {
  // A claim nobody finished or released (the server died mid join) goes back to open first.
  await getDb().execute({ sql: "UPDATE uploads SET status = 'open' WHERE status = 'completing' AND updated_at < ?", args: [Date.now() - 10 * CLAIM_MS] });
  const res = await getDb().execute({ sql: "SELECT video_id FROM uploads WHERE status = 'open' AND created_at < ?", args: [Date.now() - expireAfterMs()] });
  let n = 0;
  for (const r of res.rows) {
    const id = String((r as Record<string, unknown>).video_id);
    try { if (await abortUpload(id)) n++; }
    catch (err: any) { console.error(`[uploads] could not discard expired upload ${id}: ${err?.message ?? err}`); }
  }
  if (n) console.log(`[uploads] discarded ${n} upload(s) that were never finished`);
  return n;
}
