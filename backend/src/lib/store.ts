// src/lib/store.ts
// Turso-backed persistent store, replaces the old in-memory Map.
// All operations are async and use libSQL via @libsql/client.

import { getDb } from "./db.js";
import type { InValue } from "@libsql/client";
import type { VideoRecord } from "../types/video.js";

// Cast helper, libSQL batch requires InValue[] not unknown[]
const args = (a: unknown[]): InValue[] => a as InValue[];

// ── Helpers ───────────────────────────────────────────────────────────────

/** Parse a JSON column safely, returning a fallback value on null/invalid. */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (!raw || typeof raw !== "string") return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

type Row = Record<string, unknown>;
/** vm_info: the owner's tags and collection of one video. */
interface Extra { tags: string[]; collection: { id: string; name: string; position: number } | null }
const NO_EXTRA: Extra = { tags: [], collection: null };

/** vm_info: group tag rows and collection rows by video. */
function extrasByVideo(tagRows: Row[], collectionRows: Row[]): Map<string, Extra> {
  const map = new Map<string, Extra>();
  const at = (id: string) => { let e = map.get(id); if (!e) { e = { tags: [], collection: null }; map.set(id, e); } return e; };
  for (const r of tagRows) at(String(r.video_id)).tags.push(String(r.tag));
  for (const r of collectionRows) at(String(r.video_id)).collection = { id: String(r.id), name: String(r.name), position: Number(r.position ?? 0) };
  return map;
}
const TAGS_SQL = "SELECT video_id, tag FROM video_tags";
const COLLECTION_SQL = "SELECT i.video_id AS video_id, i.position AS position, c.id AS id, c.name AS name FROM collection_items i JOIN collections c ON c.id = i.collection_id";

/** Map a raw libSQL row (object with string keys) → VideoRecord */
function rowToVideo(v: Record<string, unknown>, shelby: Record<string, unknown>, ai: Record<string, unknown> | null, extra: Extra = NO_EXTRA): VideoRecord {
  return {
    id:          v.id as string,
    title:       v.title as string,
    description: v.description as string | undefined,
    status:      v.status as VideoRecord["status"],
    createdAt:   Number(v.created_at),
    ownerWallet: (v.owner_wallet as string | null | undefined) ?? undefined,
    category:    (v.category as string | null | undefined) ?? null,
    visibility:  ((v.visibility as string | null | undefined) ?? "unlisted") as VideoRecord["visibility"],
    tags:        extra.tags,
    collection:  extra.collection,
    // vm_media
    media:       parseJson<VideoRecord["media"]>(v.media_json, undefined),
    meta: {
      sizeBytes:       Number(v.size_bytes),
      mimeType:        v.mime_type as string,
      durationSeconds: v.duration_sec != null ? Number(v.duration_sec) : undefined,
    },
    shelby: {
      videoBlobName:      shelby.video_blob_name as string,
      transcriptBlobName: shelby.transcript_blob as string | undefined,
      metaBlobName:       shelby.meta_blob as string | undefined,
      thumbnailBlobName:  shelby.thumbnail_blob as string | undefined,
      accountAddress:     shelby.account_address as string,
      videoTxHash:        shelby.video_tx_hash as string,
      expiresAt:          shelby.expires_at_micros != null ? Number(shelby.expires_at_micros) : undefined,
    },
    ai: ai ? {
      transcript: parseJson(ai.transcript, undefined),
      summary:    ai.summary as string | undefined,
      chapters:   parseJson(ai.chapters, undefined),
      highlights: parseJson(ai.highlights, undefined),
      tags:       parseJson(ai.tags, undefined),
      blogPost:   ai.blog_post as string | undefined,
      tweetThread:ai.tweet_thread as string | undefined,
    } : undefined,
  };
}

// ── Store API ─────────────────────────────────────────────────────────────

export const store = {
  /** Insert a brand-new VideoRecord (all three tables). */
  async set(id: string, record: VideoRecord): Promise<void> {
    const db = getDb();
    await db.batch([
      {
        sql: `INSERT OR REPLACE INTO videos (id, title, description, status, created_at, size_bytes, mime_type, duration_sec, owner_wallet, category, visibility)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          record.title,
          record.description ?? null,
          record.status,
          record.createdAt,
          record.meta.sizeBytes,
          record.meta.mimeType,
          record.meta.durationSeconds ?? null,
          record.ownerWallet ?? null,
          record.category ?? null,
          // vm_info: a new video is private until its owner says otherwise
          record.visibility ?? "private",
        ],
      },
      {
        sql: `INSERT OR REPLACE INTO video_shelby (video_id, video_blob_name, transcript_blob, meta_blob, thumbnail_blob, account_address, video_tx_hash, expires_at_micros)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          record.shelby.videoBlobName,
          record.shelby.transcriptBlobName ?? null,
          record.shelby.metaBlobName ?? null,
          record.shelby.thumbnailBlobName ?? null,
          record.shelby.accountAddress,
          record.shelby.videoTxHash,
          record.shelby.expiresAt ?? null,
        ],
      },
    ], "write");
  },

  /** vm_jobs: where the uploaded file sits until processing is done. */
  async setSourcePath(id: string, filePath: string | null): Promise<void> {
    await getDb().execute({ sql: "UPDATE videos SET source_path = ? WHERE id = ?", args: [filePath, id] });
  },

  async getSourcePath(id: string): Promise<string | null> {
    const r = await getDb().execute({ sql: "SELECT source_path FROM videos WHERE id = ?", args: [id] });
    const v = (r.rows[0] as Record<string, unknown> | undefined)?.source_path;
    return v ? String(v) : null;
  },

  /** Fetch a single video by ID. Returns undefined if not found. */
  async get(id: string): Promise<VideoRecord | undefined> {
    const db = getDb();

    const [vRes, sRes, aRes, tRes, cRes] = await db.batch([
      { sql: "SELECT * FROM videos WHERE id = ?", args: [id] },
      { sql: "SELECT * FROM video_shelby WHERE video_id = ?", args: [id] },
      { sql: "SELECT * FROM video_ai WHERE video_id = ?", args: [id] },
      { sql: `${TAGS_SQL} WHERE video_id = ? ORDER BY position`, args: [id] },
      { sql: `${COLLECTION_SQL} WHERE i.video_id = ?`, args: [id] },
    ], "read");

    if (vRes.rows.length === 0) return undefined;

    const v = vRes.rows[0] as Record<string, unknown>;
    const s = sRes.rows[0] as Record<string, unknown> ?? {};
    const a = aRes.rows[0] as Record<string, unknown> | undefined ?? null;

    return rowToVideo(v, s, a, extrasByVideo(tRes.rows as Row[], cRes.rows as Row[]).get(id));
  },

  /**
   * vm_media: save what FFmpeg found. The length it measured replaces
   * the one the browser reported, which can be off for some files.
   */
  async setMedia(id: string, media: NonNullable<VideoRecord["media"]>): Promise<void> {
    await getDb().execute({
      sql: "UPDATE videos SET media_json = ?, duration_sec = COALESCE(?, duration_sec) WHERE id = ?",
      args: [JSON.stringify(media), media.durationSeconds ?? null, id],
    });
  },

  /** Partial update, only supply what changed. */
  async update(id: string, partial: Partial<VideoRecord>): Promise<void> {
    const db = getDb();
    const stmts: Array<{ sql: string; args: import("@libsql/client").InValue[] }> = [];

    if (partial.status || partial.title || partial.description !== undefined || partial.meta
        || partial.category !== undefined || partial.visibility) {
      const sets: string[] = [];
      const args: import("@libsql/client").InValue[] = [];

      if (partial.status)      { sets.push("status = ?");      args.push(partial.status); }
      if (partial.title)       { sets.push("title = ?");       args.push(partial.title); }
      if (partial.description !== undefined) { sets.push("description = ?"); args.push(partial.description ?? null); }
      if (partial.category !== undefined)    { sets.push("category = ?");    args.push(partial.category ?? null); }
      if (partial.visibility)                { sets.push("visibility = ?");  args.push(partial.visibility); }
      if (partial.meta?.durationSeconds !== undefined) { sets.push("duration_sec = ?"); args.push(partial.meta.durationSeconds); }
      if (partial.meta?.sizeBytes)  { sets.push("size_bytes = ?"); args.push(partial.meta.sizeBytes); }
      if (partial.meta?.mimeType)   { sets.push("mime_type = ?");  args.push(partial.meta.mimeType); }

      if (sets.length > 0) {
        args.push(id);
        stmts.push({ sql: `UPDATE videos SET ${sets.join(", ")} WHERE id = ?`, args });
      }
    }

    if (partial.shelby) {
      const s = partial.shelby;
      stmts.push({
        sql: `INSERT INTO video_shelby (video_id, video_blob_name, transcript_blob, meta_blob, thumbnail_blob, account_address, video_tx_hash, expires_at_micros)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(video_id) DO UPDATE SET
                video_blob_name    = COALESCE(excluded.video_blob_name, video_blob_name),
                transcript_blob    = COALESCE(excluded.transcript_blob, transcript_blob),
                meta_blob          = COALESCE(excluded.meta_blob, meta_blob),
                thumbnail_blob     = COALESCE(excluded.thumbnail_blob, thumbnail_blob),
                account_address    = COALESCE(excluded.account_address, account_address),
                video_tx_hash      = COALESCE(excluded.video_tx_hash, video_tx_hash),
                expires_at_micros  = COALESCE(excluded.expires_at_micros, expires_at_micros)`,
        args: [
          id,
          s.videoBlobName ?? "",
          s.transcriptBlobName ?? null,
          s.metaBlobName ?? null,
          s.thumbnailBlobName ?? null,
          s.accountAddress ?? "",
          s.videoTxHash ?? "",
          s.expiresAt ?? null,
        ],
      });
    }

    if (partial.ai) {
      const a = partial.ai;
      stmts.push({
        sql: `INSERT INTO video_ai (video_id, transcript, summary, chapters, highlights, tags, blog_post, tweet_thread)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(video_id) DO UPDATE SET
                transcript   = COALESCE(excluded.transcript,   transcript),
                summary      = COALESCE(excluded.summary,      summary),
                chapters     = COALESCE(excluded.chapters,     chapters),
                highlights   = COALESCE(excluded.highlights,   highlights),
                tags         = COALESCE(excluded.tags,         tags),
                blog_post    = COALESCE(excluded.blog_post,    blog_post),
                tweet_thread = COALESCE(excluded.tweet_thread, tweet_thread)`,
        args: [
          id,
          a.transcript ? JSON.stringify(a.transcript) : null,
          a.summary ?? null,
          a.chapters ? JSON.stringify(a.chapters) : null,
          a.highlights ? JSON.stringify(a.highlights) : null,
          a.tags ? JSON.stringify(a.tags) : null,
          a.blogPost ?? null,
          a.tweetThread ?? null,
        ],
      });
    }

    if (stmts.length > 0) await db.batch(stmts, "write");
  },

  /**
   * vm_upload: the ids of a wallet's videos. A video belongs to the wallet
   * that created it, or whose Shelby account holds it. An entry still in
   * "uploading" only counts while its upload is open, so abandoned
   * reservations stay out of the library.
   */
  async idsFor(walletAddress: string): Promise<string[]> {
    const res = await getDb().execute({
      sql: `SELECT v.id AS id
              FROM videos v
              LEFT JOIN video_shelby s ON s.video_id = v.id
              LEFT JOIN uploads u ON u.video_id = v.id
             WHERE (v.owner_wallet = ? OR s.account_address = ?)
               AND (v.status != 'uploading' OR u.status IN ('open', 'completing'))`,
      args: [walletAddress, walletAddress],
    });
    return res.rows.map((r) => (r as Record<string, unknown>).id as string);
  },

  /**
   * Return all videos, newest first, optionally only one wallet's.
   */
  async getAll(walletAddress?: string): Promise<VideoRecord[]> {
    const db = getDb();

    let videoIds: string[] | null = null;
    if (walletAddress) {
      videoIds = await store.idsFor(walletAddress);
      if (videoIds.length === 0) return []; // wallet has no videos
    }

    // vm_info: every query is limited to this wallet's videos. Before,
    // the Shelby and AI rows of every video in the database were read.
    const marks = videoIds ? `(${videoIds.map(() => "?").join(",")})` : "";
    const only = (column: string) => (videoIds ? ` WHERE ${column} IN ${marks}` : "");
    const videoArgs = videoIds ?? [];

    const [vRes, sRes, aRes, tRes, cRes] = await db.batch([
      { sql: `SELECT * FROM videos${only("id")} ORDER BY created_at DESC`, args: videoArgs },
      { sql: `SELECT * FROM video_shelby${only("video_id")}`, args: videoArgs },
      { sql: `SELECT * FROM video_ai${only("video_id")}`, args: videoArgs },
      { sql: `${TAGS_SQL}${only("video_id")} ORDER BY video_id, position`, args: videoArgs },
      { sql: `${COLLECTION_SQL}${only("i.video_id")}`, args: videoArgs },
    ], "read");
    const extras = extrasByVideo(tRes.rows as Row[], cRes.rows as Row[]);

    const shelbyMap = new Map<string, Record<string, unknown>>();
    for (const row of sRes.rows) {
      shelbyMap.set((row as Record<string, unknown>).video_id as string, row as Record<string, unknown>);
    }

    const aiMap = new Map<string, Record<string, unknown>>();
    for (const row of aRes.rows) {
      aiMap.set((row as Record<string, unknown>).video_id as string, row as Record<string, unknown>);
    }

    return vRes.rows.map((v) => {
      const vid = v as Record<string, unknown>;
      const s = shelbyMap.get(vid.id as string) ?? {};
      const a = aiMap.get(vid.id as string) ?? null;
      return rowToVideo(vid, s, a, extras.get(vid.id as string));
    });
  },

  /** Return only ready videos (optionally for a specific wallet). */
  async getReady(walletAddress?: string): Promise<VideoRecord[]> {
    const all = await store.getAll(walletAddress);
    return all.filter((v) => v.status === "ready");
  },

  /** Hard delete a single video (cascades via FK), with its tags and its place in a collection. */
  async delete(id: string): Promise<void> {
    await getDb().batch([
      { sql: "DELETE FROM video_tags WHERE video_id = ?", args: [id] },
      { sql: "DELETE FROM collection_items WHERE video_id = ?", args: [id] },
      // vm_transcribe: the pieces of a transcription in progress
      { sql: "DELETE FROM transcript_chunks WHERE video_id = ?", args: [id] },
      // vm_search: the passages search reads
      { sql: "DELETE FROM passages WHERE video_id = ?", args: [id] },
      // vm_notes: everyone's bookmarks and notes on it
      { sql: "DELETE FROM video_notes WHERE video_id = ?", args: [id] },
      // vm_progress: where anyone stopped in it
      { sql: "DELETE FROM watch_progress WHERE video_id = ?", args: [id] },
      { sql: "DELETE FROM videos WHERE id = ?", args: [id] },
    ], "write");
  },

  /** Delete ALL videos (used for cleanup). Optionally scoped to a wallet. */
  async deleteAll(walletAddress?: string): Promise<number> {
    const db = getDb();
    if (walletAddress) {
      const ids = await store.idsFor(walletAddress);
      if (ids.length === 0) return 0;
      for (const id of ids) await store.delete(id);
      return ids.length;
    }
    const res = await db.execute({ sql: "SELECT COUNT(*) as cnt FROM videos", args: [] });
    const count = Number((res.rows[0] as Record<string, unknown>).cnt ?? 0);
    await db.batch([
      { sql: "DELETE FROM video_tags", args: [] },
      { sql: "DELETE FROM collection_items", args: [] },
      { sql: "DELETE FROM transcript_chunks", args: [] },
      { sql: "DELETE FROM passages", args: [] },
      { sql: "DELETE FROM video_notes", args: [] },
      { sql: "DELETE FROM watch_progress", args: [] },
      { sql: "DELETE FROM videos", args: [] },
    ], "write");
    return count;
  },
};
