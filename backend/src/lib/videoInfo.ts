// src/lib/videoInfo.ts
// vm_info: what the owner says about a video, and who may open it.
//
//   category     one of a fixed list, so the library can be filtered
//   collection   a group of videos, such as the lectures of one course
//   tags         the owner's own words for finding it again
//   visibility   private   only the owner, signed in
//                unlisted  anyone who has the link
//                public    anyone who has the link, and it may be listed
//                          on public pages once those exist
//
// Every check here is made against the signed in wallet, never against a
// value the caller sends.
import crypto from "crypto";
import type { InValue } from "@libsql/client";
import { getDb } from "./db.js";
import { sameWallet } from "./auth.js";
import type { VideoRecord } from "../types/video.js";

export const CATEGORIES = [
  "lecture", "seminar", "presentation", "conference", "tutorial",
  "interview", "podcast", "webinar", "demo", "livestream", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MAX_TAGS = 15;
export const MAX_TAG_LENGTH = 40;
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 5000;
const MAX_COLLECTION_NAME = 120;
const MAX_COLLECTIONS = 200;

export class InfoError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message); this.name = "InfoError";
  }
}

// ── who may do what ───────────────────────────────────────────────────────

/** True if this wallet created the video or its Shelby blob belongs to it. */
export function ownsVideo(video: VideoRecord, wallet: string | null | undefined): boolean {
  if (!wallet) return false;
  return sameWallet(video.ownerWallet, wallet) || sameWallet(video.shelby.accountAddress, wallet);
}

/** True if this caller may open the video. A private video opens only for its owner. */
export function canView(video: VideoRecord, wallet: string | null | undefined): boolean {
  return (video.visibility ?? "unlisted") !== "private" || ownsVideo(video, wallet);
}

export const PRIVATE_VIDEO = { error: "This video is private. Only its owner can open it.", code: "private" };

// ── reading what the caller sent ──────────────────────────────────────────

const clean = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const key = (s: string) => s.toLowerCase();

/**
 * Tags as the owner typed them: a list, or one string with commas.
 * A leading # is dropped, repeats are dropped whatever their case, and
 * the order is kept.
 */
export function normalizeTags(input: unknown): string[] {
  const raw: unknown[] = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[,\n]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const tag = clean(item).replace(/^#+\s*/, "").slice(0, MAX_TAG_LENGTH).trim();
    if (!tag || seen.has(key(tag))) continue;
    seen.add(key(tag)); out.push(tag);
  }
  if (out.length > MAX_TAGS) throw new InfoError(400, "too_many_tags", `A video can have up to ${MAX_TAGS} tags.`);
  return out;
}

export interface InfoPatch {
  title?: string;
  description?: string;
  category?: Category | null;
  visibility?: Visibility;
  tags?: string[];
  /** null takes the video out of its collection */
  collectionId?: string | null;
  /** put the video in the collection with this name, creating it if needed */
  newCollection?: string;
}

/** Check what the caller sent. Only the fields that were sent are returned, so a patch changes nothing else. */
export function parseInfo(body: unknown): InfoPatch {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: InfoPatch = {};

  if (b.title !== undefined) {
    const title = clean(b.title);
    if (typeof b.title !== "string" || !title) throw new InfoError(400, "bad_title", "The title cannot be empty.");
    patch.title = title.slice(0, MAX_TITLE);
  }
  if (b.description !== undefined) {
    if (b.description !== null && typeof b.description !== "string") throw new InfoError(400, "bad_description", "description must be text.");
    patch.description = String(b.description ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, MAX_DESCRIPTION);
  }
  if (b.category !== undefined) {
    if (b.category === null || b.category === "") patch.category = null;
    else if (typeof b.category === "string" && (CATEGORIES as readonly string[]).includes(b.category)) patch.category = b.category as Category;
    else throw new InfoError(400, "bad_category", `category must be one of: ${CATEGORIES.join(", ")}.`);
  }
  if (b.visibility !== undefined) {
    if (typeof b.visibility === "string" && (VISIBILITIES as readonly string[]).includes(b.visibility)) patch.visibility = b.visibility as Visibility;
    else throw new InfoError(400, "bad_visibility", "visibility must be private, unlisted or public.");
  }
  if (b.tags !== undefined) {
    if (b.tags !== null && !Array.isArray(b.tags) && typeof b.tags !== "string") throw new InfoError(400, "bad_tags", "tags must be a list.");
    patch.tags = normalizeTags(b.tags ?? []);
  }
  if (b.collectionId !== undefined) {
    if (b.collectionId === null || b.collectionId === "") patch.collectionId = null;
    else if (typeof b.collectionId === "string" && /^[\w-]{1,64}$/.test(b.collectionId)) patch.collectionId = b.collectionId;
    else throw new InfoError(400, "bad_collection", "collectionId is not valid.");
  }
  if (b.newCollection !== undefined && b.newCollection !== null && b.newCollection !== "") {
    patch.newCollection = collectionName(b.newCollection);
  }
  return patch;
}

function collectionName(v: unknown): string {
  const name = clean(v);
  if (typeof v !== "string" || !name) throw new InfoError(400, "bad_name", "The collection needs a name.");
  if (name.length > MAX_COLLECTION_NAME) throw new InfoError(400, "bad_name", `A collection name can be up to ${MAX_COLLECTION_NAME} characters.`);
  return name;
}

// ── collections ───────────────────────────────────────────────────────────

export interface Collection {
  id: string; name: string; description: string | null;
  createdAt: number; updatedAt: number;
  /** videos in it, and how long they run together */
  videoCount: number; totalSeconds: number;
}

type Row = Record<string, unknown>;
const toCollection = (r: Row): Collection => ({
  id: String(r.id), name: String(r.name), description: (r.description as string | null) ?? null,
  createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  videoCount: Number(r.video_count ?? 0), totalSeconds: Number(r.total_seconds ?? 0),
});

const COLLECTION_SELECT = `
  SELECT c.*, COUNT(v.id) AS video_count, COALESCE(SUM(v.duration_sec), 0) AS total_seconds
    FROM collections c
    LEFT JOIN collection_items i ON i.collection_id = c.id
    LEFT JOIN videos v ON v.id = i.video_id`;

export async function listCollections(wallet: string): Promise<Collection[]> {
  const res = await getDb().execute({
    sql: `${COLLECTION_SELECT} WHERE c.owner_wallet = ? GROUP BY c.id ORDER BY c.name_key`,
    args: [wallet],
  });
  return res.rows.map((r) => toCollection(r as Row));
}

/** One of this wallet's collections, or null. Someone else's collection is "not found", not "forbidden". */
export async function getCollection(id: string, wallet: string): Promise<Collection | null> {
  const res = await getDb().execute({
    sql: `${COLLECTION_SELECT} WHERE c.id = ? AND c.owner_wallet = ? GROUP BY c.id`,
    args: [id, wallet],
  });
  return res.rows[0] ? toCollection(res.rows[0] as Row) : null;
}

async function findByName(wallet: string, name: string): Promise<string | null> {
  const res = await getDb().execute({
    sql: "SELECT id FROM collections WHERE owner_wallet = ? AND name_key = ?", args: [wallet, key(name)],
  });
  return res.rows[0] ? String((res.rows[0] as Row).id) : null;
}

/**
 * Create a collection. With reuse, a collection that already has this
 * name (whatever its case) is returned instead of an error: that is what
 * typing a name into the upload form should do.
 */
export async function createCollection(wallet: string, rawName: unknown, opts: { description?: unknown; reuse?: boolean } = {}): Promise<Collection> {
  const name = collectionName(rawName);
  const existing = await findByName(wallet, name);
  if (existing) {
    if (opts.reuse) return (await getCollection(existing, wallet))!;
    throw new InfoError(409, "exists", `You already have a collection called "${name}".`, { id: existing });
  }
  const count = await getDb().execute({ sql: "SELECT COUNT(*) AS c FROM collections WHERE owner_wallet = ?", args: [wallet] });
  if (Number((count.rows[0] as Row).c) >= MAX_COLLECTIONS) {
    throw new InfoError(409, "too_many", `A library can have up to ${MAX_COLLECTIONS} collections.`);
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const description = typeof opts.description === "string" ? opts.description.trim().slice(0, MAX_DESCRIPTION) || null : null;
  try {
    await getDb().execute({
      sql: "INSERT INTO collections (id, owner_wallet, name, name_key, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [id, wallet, name, key(name), description, now, now],
    });
  } catch (err: any) {
    // Two requests created the same name at the same moment: the other one won.
    const other = await findByName(wallet, name);
    if (!other) throw err;
    if (opts.reuse) return (await getCollection(other, wallet))!;
    throw new InfoError(409, "exists", `You already have a collection called "${name}".`, { id: other });
  }
  return (await getCollection(id, wallet))!;
}

export async function updateCollection(id: string, wallet: string, body: unknown): Promise<Collection> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const current = await getCollection(id, wallet);
  if (!current) throw new InfoError(404, "collection_not_found", "Collection not found.");
  const sets: string[] = []; const args: InValue[] = [];
  if (b.name !== undefined) {
    const name = collectionName(b.name);
    const other = await findByName(wallet, name);
    if (other && other !== id) throw new InfoError(409, "exists", `You already have a collection called "${name}".`, { id: other });
    sets.push("name = ?", "name_key = ?"); args.push(name, key(name));
  }
  if (b.description !== undefined) {
    sets.push("description = ?");
    args.push(typeof b.description === "string" ? b.description.trim().slice(0, MAX_DESCRIPTION) || null : null);
  }
  if (sets.length) {
    sets.push("updated_at = ?"); args.push(Date.now(), id, wallet);
    await getDb().execute({ sql: `UPDATE collections SET ${sets.join(", ")} WHERE id = ? AND owner_wallet = ?`, args });
  }
  return (await getCollection(id, wallet))!;
}

/** Remove a collection. Its videos stay in the library. */
export async function deleteCollection(id: string, wallet: string): Promise<boolean> {
  if (!(await getCollection(id, wallet))) return false;
  await getDb().batch([
    { sql: "DELETE FROM collection_items WHERE collection_id = ?", args: [id] },
    { sql: "DELETE FROM collections WHERE id = ? AND owner_wallet = ?", args: [id, wallet] },
  ], "write");
  return true;
}

// ── saving ────────────────────────────────────────────────────────────────

/**
 * Save a patch on one video. The caller has already checked that the
 * wallet owns the video. Everything except a newly created collection is
 * written in one batch, so a failure leaves the video as it was.
 */
export async function applyInfo(videoId: string, wallet: string, patch: InfoPatch): Promise<void> {
  // Settle the collection first: it can be refused, and nothing should change then.
  let collectionId: string | null | undefined;
  if (patch.newCollection) collectionId = (await createCollection(wallet, patch.newCollection, { reuse: true })).id;
  else if (patch.collectionId) {
    if (!(await getCollection(patch.collectionId, wallet))) {
      throw new InfoError(404, "collection_not_found", "That collection was not found in your library.");
    }
    collectionId = patch.collectionId;
  } else if (patch.collectionId === null) collectionId = null;

  const stmts: Array<{ sql: string; args: InValue[] }> = [];
  const now = Date.now();

  const sets: string[] = []; const args: InValue[] = [];
  if (patch.title !== undefined)       { sets.push("title = ?");       args.push(patch.title); }
  if (patch.description !== undefined) { sets.push("description = ?"); args.push(patch.description); }
  if (patch.category !== undefined)    { sets.push("category = ?");    args.push(patch.category); }
  if (patch.visibility !== undefined)  { sets.push("visibility = ?");  args.push(patch.visibility); }
  if (sets.length) stmts.push({ sql: `UPDATE videos SET ${sets.join(", ")} WHERE id = ?`, args: [...args, videoId] });

  if (patch.tags !== undefined) {
    stmts.push({ sql: "DELETE FROM video_tags WHERE video_id = ?", args: [videoId] });
    patch.tags.forEach((tag, i) => stmts.push({
      sql: "INSERT INTO video_tags (video_id, tag, tag_key, position) VALUES (?, ?, ?, ?)", args: [videoId, tag, key(tag), i],
    }));
  }

  if (collectionId !== undefined) {
    const inIt = collectionId === null ? null : await getDb().execute({
      sql: "SELECT 1 FROM collection_items WHERE collection_id = ? AND video_id = ?", args: [collectionId, videoId],
    });
    // Already in this collection: leave its place in the order alone.
    if (collectionId === null || !inIt!.rows.length) {
      stmts.push({ sql: "DELETE FROM collection_items WHERE video_id = ?", args: [videoId] });
      if (collectionId !== null) {
        stmts.push({
          sql: `INSERT INTO collection_items (collection_id, video_id, position, added_at)
                VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_items WHERE collection_id = ?), ?)`,
          args: [collectionId, videoId, collectionId, now],
        });
        stmts.push({ sql: "UPDATE collections SET updated_at = ? WHERE id = ?", args: [now, collectionId] });
      }
    }
  }

  if (stmts.length) await getDb().batch(stmts, "write");
}
