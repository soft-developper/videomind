// src/lib/store.ts
// Turso-backed persistent store — replaces the old in-memory Map.
// All operations are async and use libSQL via @libsql/client.

import { getDb } from "./db.js";
import type { InValue } from "@libsql/client";
import type { VideoRecord } from "../types/video.js";

// Cast helper — libSQL batch requires InValue[] not unknown[]
const args = (a: unknown[]): InValue[] => a as InValue[];

// ── Helpers ───────────────────────────────────────────────────────────────

/** Parse a JSON column safely, returning a fallback value on null/invalid. */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (!raw || typeof raw !== "string") return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Map a raw libSQL row (object with string keys) → VideoRecord */
function rowToVideo(v: Record<string, unknown>, shelby: Record<string, unknown>, ai: Record<string, unknown> | null): VideoRecord {
  return {
    id:          v.id as string,
    title:       v.title as string,
    description: v.description as string | undefined,
    status:      v.status as VideoRecord["status"],
    createdAt:   Number(v.created_at),
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
        sql: `INSERT OR REPLACE INTO videos (id, title, description, status, created_at, size_bytes, mime_type, duration_sec)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          record.title,
          record.description ?? null,
          record.status,
          record.createdAt,
          record.meta.sizeBytes,
          record.meta.mimeType,
          record.meta.durationSeconds ?? null,
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

  /** Fetch a single video by ID. Returns undefined if not found. */
  async get(id: string): Promise<VideoRecord | undefined> {
    const db = getDb();

    const [vRes, sRes, aRes] = await db.batch([
      { sql: "SELECT * FROM videos WHERE id = ?", args: [id] },
      { sql: "SELECT * FROM video_shelby WHERE video_id = ?", args: [id] },
      { sql: "SELECT * FROM video_ai WHERE video_id = ?", args: [id] },
    ], "read");

    if (vRes.rows.length === 0) return undefined;

    const v = vRes.rows[0] as Record<string, unknown>;
    const s = sRes.rows[0] as Record<string, unknown> ?? {};
    const a = aRes.rows[0] as Record<string, unknown> | undefined ?? null;

    return rowToVideo(v, s, a);
  },

  /** Partial update — only supply what changed. */
  async update(id: string, partial: Partial<VideoRecord>): Promise<void> {
    const db = getDb();
    const stmts: Array<{ sql: string; args: import("@libsql/client").InValue[] }> = [];

    if (partial.status || partial.title || partial.description !== undefined || partial.meta) {
      const sets: string[] = [];
      const args: import("@libsql/client").InValue[] = [];

      if (partial.status)      { sets.push("status = ?");      args.push(partial.status); }
      if (partial.title)       { sets.push("title = ?");       args.push(partial.title); }
      if (partial.description !== undefined) { sets.push("description = ?"); args.push(partial.description ?? null); }
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

  /** Return all videos ordered newest-first. */
  /**
   * Return all videos, optionally filtered by wallet address.
   * When walletAddress is provided only videos uploaded by that wallet are returned.
   */
  async getAll(walletAddress?: string): Promise<VideoRecord[]> {
    const db = getDb();

    // If filtering by wallet, first get matching video_ids from video_shelby
    let videoIds: string[] | null = null;
    if (walletAddress) {
      const shelbyRes = await db.execute({
        sql: "SELECT video_id FROM video_shelby WHERE account_address = ?",
        args: [walletAddress],
      });
      videoIds = shelbyRes.rows.map((r) => (r as Record<string, unknown>).video_id as string);
      if (videoIds.length === 0) return []; // wallet has no videos
    }

    const videoSql = videoIds
      ? `SELECT * FROM videos WHERE id IN (${videoIds.map(() => "?").join(",")}) ORDER BY created_at DESC`
      : "SELECT * FROM videos ORDER BY created_at DESC";
    const videoArgs = videoIds ?? [];

    const [vRes, sRes, aRes] = await db.batch([
      { sql: videoSql, args: videoArgs },
      { sql: "SELECT * FROM video_shelby", args: [] },
      { sql: "SELECT * FROM video_ai", args: [] },
    ], "read");

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
      return rowToVideo(vid, s, a);
    });
  },

  /** Return only ready videos (optionally for a specific wallet). */
  async getReady(walletAddress?: string): Promise<VideoRecord[]> {
    const all = await store.getAll(walletAddress);
    return all.filter((v) => v.status === "ready");
  },

  /** Hard delete a single video (cascades via FK). */
  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.execute({ sql: "DELETE FROM videos WHERE id = ?", args: [id] });
  },

  /** Delete ALL videos (used for cleanup). Optionally scoped to a wallet. */
  async deleteAll(walletAddress?: string): Promise<number> {
    const db = getDb();
    if (walletAddress) {
      // Get IDs for this wallet first
      const shelbyRes = await db.execute({
        sql: "SELECT video_id FROM video_shelby WHERE account_address = ?",
        args: [walletAddress],
      });
      const ids = shelbyRes.rows.map((r) => (r as Record<string, unknown>).video_id as string);
      if (ids.length === 0) return 0;
      for (const id of ids) {
        await db.execute({ sql: "DELETE FROM videos WHERE id = ?", args: [id] });
      }
      return ids.length;
    }
    const res = await db.execute({ sql: "SELECT COUNT(*) as cnt FROM videos", args: [] });
    const count = Number((res.rows[0] as Record<string, unknown>).cnt ?? 0);
    await db.execute({ sql: "DELETE FROM videos", args: [] });
    return count;
  },
};
