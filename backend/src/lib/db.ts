// src/lib/db.ts
// Turso (libSQL) database client + schema migrations
import { createClient } from "@libsql/client";
import "dotenv/config";

// ── Client singleton ──────────────────────────────────────────────────────
let _db: ReturnType<typeof createClient> | null = null;

export function getDb() {
  if (_db) return _db;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) throw new Error("TURSO_DATABASE_URL not set in .env");

  _db = createClient({ url, authToken });
  return _db;
}

// ── Schema ────────────────────────────────────────────────────────────────
export async function migrate() {
  const db = getDb();

  await db.batch([
    // Core videos table
    `CREATE TABLE IF NOT EXISTS videos (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      description  TEXT,
      status       TEXT NOT NULL DEFAULT 'uploading',
      created_at   INTEGER NOT NULL,
      size_bytes   INTEGER NOT NULL DEFAULT 0,
      mime_type    TEXT NOT NULL DEFAULT 'video/mp4',
      duration_sec REAL
    )`,

    // Shelby storage metadata
    `CREATE TABLE IF NOT EXISTS video_shelby (
      video_id            TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      video_blob_name     TEXT NOT NULL DEFAULT '',
      transcript_blob     TEXT,
      meta_blob           TEXT,
      thumbnail_blob      TEXT,
      account_address     TEXT NOT NULL DEFAULT '',
      video_tx_hash       TEXT NOT NULL DEFAULT '',
      expires_at_micros   INTEGER
    )`,

    // AI outputs (stored as JSON columns for flexibility)
    `CREATE TABLE IF NOT EXISTS video_ai (
      video_id     TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      transcript   TEXT,   -- JSON array of TranscriptSegment
      summary      TEXT,
      chapters     TEXT,   -- JSON array of Chapter
      highlights   TEXT,   -- JSON array of Highlight
      tags         TEXT,   -- JSON array of strings
      blog_post    TEXT,
      tweet_thread TEXT
    )`,
  ], "write");

  console.log("[DB] Schema migrations applied ✓");
}
