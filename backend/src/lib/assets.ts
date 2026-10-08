// src/lib/assets.ts
// vm_storage: the files that belong to a video, and where each one is kept.
//
// Today there is one kind, the original upload. Renditions, thumbnails
// and captions join later as more rows in the same table.
//
// Every byte that enters or leaves storage is written to the usage
// ledger here, so no other code has to remember to do it.
import fs from "fs";
import crypto from "crypto";
import { getDb } from "./db.js";
import { getStorage } from "./storage.js";
import { recordUsage } from "./usage.js";

export interface MediaAsset {
  id: string; videoId: string; ownerWallet: string | null; kind: string;
  driver: string; key: string; bytes: number; contentType: string | null;
  sha256: string | null; createdAt: number;
}

const VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Video ids end up inside storage keys, so only real ids are accepted. */
export function isVideoId(v: unknown): v is string { return typeof v === "string" && VIDEO_ID.test(v); }

/** ".MP4" -> ".mp4". Anything unusual falls back to ".mp4". */
export function safeExt(ext: string | undefined): string {
  const e = (ext ?? "").toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(e) ? e : ".mp4";
}

function prefixOf(videoId: string): string {
  if (!isVideoId(videoId)) throw new Error("Invalid video id");
  return `videos/${videoId.toLowerCase()}/`;
}
export function originalKey(videoId: string, ext?: string): string {
  return `${prefixOf(videoId)}original${safeExt(ext)}`;
}

function rowToAsset(r: Record<string, unknown>): MediaAsset {
  return {
    id: String(r.id), videoId: String(r.video_id),
    ownerWallet: (r.owner_wallet as string | null) ?? null, kind: String(r.kind),
    driver: String(r.storage_driver), key: String(r.storage_key), bytes: Number(r.bytes),
    contentType: (r.content_type as string | null) ?? null,
    sha256: (r.sha256 as string | null) ?? null, createdAt: Number(r.created_at),
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * vm_upload: the original is kept. It is the copy the video plays from
 * and the one every later step is made from. STORAGE_KEEP_ORIGINAL=false
 * removes it after processing instead (the video then only plays once it
 * is on Shelby).
 */
export function keepOriginal(): boolean {
  return (process.env.STORAGE_KEEP_ORIGINAL ?? "").trim().toLowerCase() !== "false";
}

export async function listAssets(videoId: string): Promise<MediaAsset[]> {
  const res = await getDb().execute({ sql: "SELECT * FROM media_assets WHERE video_id = ? ORDER BY created_at", args: [videoId] });
  return res.rows.map((r) => rowToAsset(r as Record<string, unknown>));
}

/** vm_transcribe: the newest asset of one kind, or null. */
export async function getAsset(videoId: string, kind: string): Promise<MediaAsset | null> {
  const res = await getDb().execute({
    sql: "SELECT * FROM media_assets WHERE video_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1",
    args: [videoId, kind],
  });
  return res.rows[0] ? rowToAsset(res.rows[0] as Record<string, unknown>) : null;
}

export async function getOriginal(videoId: string): Promise<MediaAsset | null> {
  const res = await getDb().execute({
    sql: "SELECT * FROM media_assets WHERE video_id = ? AND kind = 'original' ORDER BY created_at DESC LIMIT 1",
    args: [videoId],
  });
  return res.rows[0] ? rowToAsset(res.rows[0] as Record<string, unknown>) : null;
}

/**
 * Move an uploaded file into storage as the video's original. A second
 * upload for the same video replaces the first. The source file is gone
 * afterwards.
 */
export async function saveOriginal(args: {
  videoId: string; filePath: string; ext?: string; contentType?: string; ownerWallet?: string | null;
}): Promise<MediaAsset> {
  const storage = getStorage();
  const key = originalKey(args.videoId, args.ext);
  const sha256 = await sha256File(args.filePath);
  const earlier = (await listAssets(args.videoId)).filter((a) => a.kind === "original");

  const { size } = await storage.moveIn(key, args.filePath, { contentType: args.contentType });
  for (const old of earlier) {
    if (old.key !== key) await storage.delete(old.key).catch((err) => console.error(`[storage] could not delete ${old.key}: ${err?.message ?? err}`));
  }

  const asset: MediaAsset = {
    id: crypto.randomUUID(), videoId: args.videoId, ownerWallet: args.ownerWallet ?? null, kind: "original",
    driver: storage.driver, key, bytes: size, contentType: args.contentType ?? null, sha256, createdAt: Date.now(),
  };
  await getDb().batch([
    { sql: "DELETE FROM media_assets WHERE video_id = ? AND kind = 'original'", args: [args.videoId] },
    {
      sql: `INSERT INTO media_assets (id, video_id, owner_wallet, kind, storage_driver, storage_key, bytes, content_type, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [asset.id, asset.videoId, asset.ownerWallet, asset.kind, asset.driver, asset.key, asset.bytes, asset.contentType, asset.sha256, asset.createdAt],
    },
  ], "write");

  await recordUsage([
    ...earlier.map((old) => removedEntry(old)),
    { feature: "storage", metric: "bytes_stored" as const, quantity: asset.bytes, ownerWallet: asset.ownerWallet, actorWallet: asset.ownerWallet,
      videoId: asset.videoId, provider: asset.driver, key: `stored:${asset.id}`, meta: { kind: asset.kind } },
  ]);
  return asset;
}

/**
 * vm_upload: record an original that is ALREADY in storage (it arrived
 * in parts, straight from the browser). Replaces any earlier original of
 * the same video and writes the bytes to the ledger.
 */
export async function registerOriginal(args: {
  videoId: string; key: string; bytes: number; contentType?: string | null; ownerWallet?: string | null;
}): Promise<MediaAsset> {
  const storage = getStorage();
  const earlier = (await listAssets(args.videoId)).filter((a) => a.kind === "original");
  // Recording the same file twice changes nothing and is counted once.
  const same = earlier.find((a) => a.key === args.key && a.bytes === args.bytes && a.driver === storage.driver);
  if (same) return same;
  for (const old of earlier) {
    if (old.key !== args.key) await storage.delete(old.key).catch((err) => console.error(`[storage] could not delete ${old.key}: ${err?.message ?? err}`));
  }
  const asset: MediaAsset = {
    id: crypto.randomUUID(), videoId: args.videoId, ownerWallet: args.ownerWallet ?? null, kind: "original",
    driver: storage.driver, key: args.key, bytes: args.bytes, contentType: args.contentType ?? null,
    // No hash yet: the bytes never passed through this server. A later step can read the object and fill it in.
    sha256: null, createdAt: Date.now(),
  };
  await getDb().batch([
    { sql: "DELETE FROM media_assets WHERE video_id = ? AND kind = 'original'", args: [args.videoId] },
    {
      sql: `INSERT INTO media_assets (id, video_id, owner_wallet, kind, storage_driver, storage_key, bytes, content_type, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [asset.id, asset.videoId, asset.ownerWallet, asset.kind, asset.driver, asset.key, asset.bytes, asset.contentType, asset.sha256, asset.createdAt],
    },
  ], "write");
  await recordUsage([
    ...earlier.map((old) => removedEntry(old)),
    { feature: "storage", metric: "bytes_stored" as const, quantity: asset.bytes, ownerWallet: asset.ownerWallet, actorWallet: asset.ownerWallet,
      videoId: asset.videoId, provider: asset.driver, key: `stored:${asset.id}`, meta: { kind: asset.kind } },
  ]);
  return asset;
}

/** vm_media: the pictures made from a video. */
export const PICTURE_KINDS = ["poster", "thumb"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

/** vm_transcribe: the sound of a video, taken out once for transcription. */
export type DerivedKind = PictureKind | "audio";
const DERIVED_EXT: Record<DerivedKind, string> = { poster: ".jpg", thumb: ".jpg", audio: ".m4a" };

/**
 * vm_media: move a file made FROM a video (a thumbnail, its sound) into
 * storage and record it. One asset per kind and video: a second one
 * replaces the first.
 */
export async function saveDerived(args: {
  videoId: string; kind: DerivedKind; filePath: string; contentType: string; ownerWallet?: string | null;
}): Promise<MediaAsset> {
  const storage = getStorage();
  const key = `${prefixOf(args.videoId)}${args.kind}${DERIVED_EXT[args.kind]}`;
  const earlier = (await listAssets(args.videoId)).filter((a) => a.kind === args.kind);
  const { size } = await storage.moveIn(key, args.filePath, { contentType: args.contentType });
  const asset: MediaAsset = {
    id: crypto.randomUUID(), videoId: args.videoId, ownerWallet: args.ownerWallet ?? null, kind: args.kind,
    driver: storage.driver, key, bytes: size, contentType: args.contentType, sha256: null, createdAt: Date.now(),
  };
  await getDb().batch([
    { sql: "DELETE FROM media_assets WHERE video_id = ? AND kind = ?", args: [args.videoId, args.kind] },
    {
      sql: `INSERT INTO media_assets (id, video_id, owner_wallet, kind, storage_driver, storage_key, bytes, content_type, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [asset.id, asset.videoId, asset.ownerWallet, asset.kind, asset.driver, asset.key, asset.bytes, asset.contentType, asset.sha256, asset.createdAt],
    },
  ], "write");
  await recordUsage([
    ...earlier.map((old) => removedEntry(old)),
    { feature: "storage", metric: "bytes_stored" as const, quantity: asset.bytes, ownerWallet: asset.ownerWallet, actorWallet: asset.ownerWallet,
      videoId: asset.videoId, provider: asset.driver, key: `stored:${asset.id}`, meta: { kind: asset.kind } },
  ]);
  return asset;
}

/** vm_media: where the pictures of these videos are kept. One query for a whole library. */
export async function pictureKeys(videoIds: string[]): Promise<Map<string, Partial<Record<PictureKind, string>>>> {
  const map = new Map<string, Partial<Record<PictureKind, string>>>();
  const driver = getStorage().driver;
  for (let i = 0; i < videoIds.length; i += 400) {
    const ids = videoIds.slice(i, i + 400);
    const res = await getDb().execute({
      sql: `SELECT video_id, kind, storage_key FROM media_assets
             WHERE kind IN ('poster', 'thumb') AND storage_driver = ? AND video_id IN (${ids.map(() => "?").join(",")})`,
      args: [driver, ...ids],
    });
    for (const r of res.rows as Array<Record<string, unknown>>) {
      const id = String(r.video_id);
      const entry = map.get(id) ?? {};
      entry[String(r.kind) as PictureKind] = String(r.storage_key);
      map.set(id, entry);
    }
  }
  return map;
}

function removedEntry(a: MediaAsset) {
  return { feature: "storage", metric: "bytes_deleted" as const, quantity: a.bytes, ownerWallet: a.ownerWallet,
    videoId: a.videoId, provider: a.driver, key: `deleted:${a.id}`, meta: { kind: a.kind } };
}

/**
 * Remove every stored file of a video and write the removal to the
 * ledger. If storage refuses, this throws and the rows stay, so the
 * sweep below tries again later. Returns how many assets were removed.
 */
export async function deleteAssetsForVideo(videoId: string): Promise<number> {
  const assets = await listAssets(videoId);
  if (!assets.length) return 0;
  await getStorage().deletePrefix(prefixOf(videoId));
  await getDb().execute({ sql: "DELETE FROM media_assets WHERE video_id = ?", args: [videoId] });
  await recordUsage(assets.map(removedEntry));
  return assets.length;
}

/** Remove only the original. Used after processing when originals are not kept. */
export async function deleteOriginal(videoId: string): Promise<boolean> {
  const asset = await getOriginal(videoId);
  if (!asset) return false;
  await getStorage().delete(asset.key);
  await getDb().execute({ sql: "DELETE FROM media_assets WHERE id = ?", args: [asset.id] });
  await recordUsage(removedEntry(asset));
  return true;
}

/**
 * Housekeeping, so storage never fills with files nobody can reach:
 *   1. uploads that were started but never confirmed (default: after 24 hours)
 *   2. files whose video was deleted while storage could not be reached
 * Returns how many videos were cleaned.
 */
export async function sweepStorage(abandonAfterMs = abandonAfterMsFromEnv()): Promise<number> {
  const res = await getDb().execute({
    sql: `SELECT DISTINCT m.video_id AS video_id
            FROM media_assets m LEFT JOIN videos v ON v.id = m.video_id
           WHERE v.id IS NULL OR (v.status = 'uploading' AND m.created_at < ?)`,
    args: [Date.now() - abandonAfterMs],
  });
  let cleaned = 0;
  for (const r of res.rows) {
    const id = String((r as Record<string, unknown>).video_id);
    try { if (await deleteAssetsForVideo(id)) cleaned++; }
    catch (err: any) { console.error(`[storage] sweep could not clean video ${id}: ${err?.message ?? err}`); }
  }
  if (cleaned) console.log(`[storage] sweep removed the files of ${cleaned} abandoned or deleted video(s)`);
  return cleaned;
}

function abandonAfterMsFromEnv(): number {
  const hours = Number(process.env.UPLOAD_ABANDON_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

/** Sweep shortly after startup and then once an hour. Returns a stop function. */
export function startHousekeeping(everyMs = 60 * 60 * 1000): () => void {
  const run = () => {
    sweepStorage().catch((err) => console.error(`[storage] sweep failed: ${err?.message ?? err}`));
    // vm_upload: uploads nobody came back to. Loaded here on demand because uploads.ts imports this file.
    import("./uploads.js").then((m) => m.sweepUploads()).catch((err) => console.error(`[uploads] sweep failed: ${err?.message ?? err}`));
    // vm_media: videos uploaded before thumbnails existed. Only when FFmpeg is there to make them.
    import("./media.js").then(async (m) => {
      if (!m.mediaHealth().ffmpeg) return;
      const { backfillInspect } = await import("../services/inspect.js");
      const { nudgeRunner } = await import("./runner.js");
      if (await backfillInspect()) nudgeRunner();
    }).catch((err) => console.error(`[media] backfill failed: ${err?.message ?? err}`));
  };
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, everyMs);
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
