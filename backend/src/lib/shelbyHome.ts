// src/lib/shelbyHome.ts
// vm_shelbyhome: public videos live on Shelby (Part 16d1).
//
// The founder's choice (21 Oct 2026): a public video plays from Shelby
// only. It is uploaded to VideoMind's storage as before (the upload can be
// resumed, and processing reads it from there). The owner's wallet then
// stores it on Shelby. Once Shelby has confirmed that store, the video is
// ready and public, and the bytes Shelby serves are the bytes in storage,
// VideoMind's copy (the original) is deleted. From then on the video plays
// from Shelby, and clips and YouTube read it from Shelby too.
//
// What that means, said plainly to the owner in the site: Shelby's test
// network is reset about once a week and a store is paid for 30 days. A
// reset or a lapse makes such a video unplayable until the owner stores it
// again from their own copy of the file. VideoMind keeps no other copy.
//
// Reading from Shelby: https://api.shelbynet.shelby.xyz/shelby/v1/blobs/...
// answers without an API key, with ranges, CORS and no time limit on a long
// read (probe 4, 21 Oct 2026). That is the address the player already uses.
//
// PUBLIC_ON_SHELBY_ONLY=off on the server keeps every copy (nothing is
// deleted); the default is on.
import { store } from "./store.js";
import { getStorage } from "./storage.js";
import { getOriginal, deleteOriginal, type MediaAsset } from "./assets.js";
import { listAnchors, latest, type Anchor } from "./anchors.js";
import { shelbyBlobUrl } from "./shelbyClient.js";
import { sameWallet } from "./auth.js";
import { getDb } from "./db.js";
import type { VideoRecord } from "../types/video.js";

export const shelbyOnlyOn = () => (process.env.PUBLIC_ON_SHELBY_ONLY ?? "").trim().toLowerCase() !== "off";

/** Reading a range of bytes. Tests pass their own. */
export type FetchRange = (url: string, start: number, end: number) => Promise<Buffer>;
export const httpRange: FetchRange = async (url, start, end) => {
  const r = await fetch(url, { headers: { range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(60_000) });
  if (r.status !== 206 && r.status !== 200) throw new Error(`${new URL(url).host} answered ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  return r.status === 200 ? b.subarray(start, end + 1) : b;
};

/** The store on Shelby a video plays from: the newest one, confirmed, under the video's owner. */
export async function confirmedStore(video: VideoRecord): Promise<Anchor | null> {
  const cur = latest(await listAnchors(video.id));
  if (!cur || cur.state !== "anchored") return null;
  if (!sameWallet(cur.wallet, video.ownerWallet ?? video.shelby?.accountAddress)) return null;
  return cur;
}

/** The public Shelby address of a store. */
export const shelbyUrlOf = (a: Pick<Anchor, "blobName" | "wallet">) => shelbyBlobUrl(a.blobName, a.wallet);

/** A range of the original in VideoMind's storage. */
async function storedRange(asset: MediaAsset, start: number, end: number, fetchRange: FetchRange): Promise<Buffer> {
  const storage = getStorage();
  const url = await storage.signedUrl(asset.key, 600);
  if (url) return fetchRange(url, start, end);
  const fs = await import("fs/promises");
  return storage.withLocalFile(asset.key, async (p) => {
    const fh = await fs.open(p, "r");
    try { const b = Buffer.alloc(end - start + 1); const { bytesRead } = await fh.read(b, 0, b.length, start); return b.subarray(0, bytesRead); }
    finally { await fh.close(); }
  });
}

/** Do Shelby and storage give the same bytes at the start, the middle and the end? */
export async function sameBytes(asset: MediaAsset, shelbyUrl: string, fetchRange: FetchRange = httpRange): Promise<boolean> {
  const size = asset.bytes, piece = Math.min(65_536, size);
  const starts = [...new Set([0, Math.max(0, Math.floor(size / 2) - piece / 2), Math.max(0, size - piece)])];
  for (const s of starts) {
    const e = Math.min(size, s + piece) - 1;
    const [a, b] = await Promise.all([storedRange(asset, s, e, fetchRange), fetchRange(shelbyUrl, s, e)]);
    if (a.length !== e - s + 1 || !a.equals(b)) return false;
  }
  return true;
}

export type MoveResult =
  | "moved" | "off" | "gone" | "not_public" | "not_ready" | "removed" | "no_original"
  | "not_on_shelby" | "other_file" | "ending_soon" | "different_bytes" | "unreachable";

/**
 * Delete VideoMind's copy of a public video once Shelby holds the same file.
 * Safe to call any time and more than once: it only deletes when every
 * condition holds, and says which one did not.
 */
export async function moveToShelbyIfReady(videoId: string, fetchRange: FetchRange = httpRange, now = Date.now()): Promise<MoveResult> {
  if (!shelbyOnlyOn()) return "off";
  const video = await store.get(videoId);
  if (!video) return "gone";
  if ((video.visibility ?? "unlisted") !== "public") return "not_public";
  if (video.status !== "ready") return "not_ready";
  if (video.removed) return "removed";
  const original = await getOriginal(videoId);
  if (!original) return "no_original";
  const a = await confirmedStore(video);
  if (!a) return "not_on_shelby";
  // The store must be this exact file, and the video must point at it.
  if (a.sizeBytes !== original.bytes || video.shelby?.videoBlobName !== a.blobName) return "other_file";
  // A store about to lapse is not a home: wait for the owner to store it again.
  if (a.paidUntil !== null && a.paidUntil - now < 2 * 86_400_000) return "ending_soon";
  let same: boolean;
  try { same = await sameBytes(original, shelbyUrlOf(a), fetchRange); }
  catch (e: any) { console.warn(`[shelbyhome] ${videoId}: could not compare with Shelby: ${e?.message ?? e}`); return "unreachable"; }
  if (!same) { console.warn(`[shelbyhome] ${videoId}: Shelby serves different bytes; the copy is kept`); return "different_bytes"; }
  await deleteOriginal(videoId);
  console.log(`[shelbyhome] ${videoId}: VideoMind's copy deleted; it plays from Shelby (${a.blobName})`);
  return "moved";
}

/** Run after anything that can make a video ready to move. Never throws. */
export function afterChange(videoId: string): void {
  void moveToShelbyIfReady(videoId).catch((e) => console.error(`[shelbyhome] ${videoId}: ${e?.message ?? e}`));
}

/** Hourly: public videos confirmed on Shelby that still have a copy. */
export async function sweepToShelby(limit = 20): Promise<number> {
  if (!shelbyOnlyOn()) return 0;
  const r = await getDb().execute({
    sql: `SELECT DISTINCT v.id FROM videos v
            JOIN media_assets m ON m.video_id = v.id AND m.kind = 'original'
            JOIN anchors a ON a.video_id = v.id AND a.state = 'anchored'
           WHERE v.visibility = 'public' AND v.status = 'ready' AND v.removed_at IS NULL
           LIMIT ?`,
    args: [limit],
  });
  let moved = 0;
  for (const row of r.rows as any[]) if ((await moveToShelbyIfReady(String(row.id)).catch(() => "unreachable")) === "moved") moved++;
  return moved;
}

/**
 * Where a step that needs the whole video (a clip, YouTube) reads it: the
 * original in storage, or else the confirmed store on Shelby.
 */
export async function videoSource(video: VideoRecord): Promise<
  | { from: "storage"; asset: MediaAsset }
  | { from: "shelby"; url: string; bytes: number; anchor: Anchor }
  | null
> {
  const original = await getOriginal(video.id);
  if (original) return { from: "storage", asset: original };
  const a = await confirmedStore(video);
  if (a && a.sizeBytes) return { from: "shelby", url: shelbyUrlOf(a), bytes: a.sizeBytes, anchor: a };
  return null;
}

/**
 * Why a video with no copy in storage cannot play: its store on Shelby was
 * reset, lapsed, or was never confirmed. Null when it can play.
 */
export async function shelbyGone(video: VideoRecord): Promise<"missing" | "lapsed" | "unconfirmed" | null> {
  const cur = latest(await listAnchors(video.id));
  if (!cur) return null;
  if (cur.state === "missing") return "missing";
  if (cur.state === "lapsed") return "lapsed";
  if (cur.state === "unverified") return "unconfirmed";
  return null;
}
