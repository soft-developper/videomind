// src/lib/migrations.ts
// vm_signin: ordered, run once schema migrations.
//
// The original schema in db.ts uses CREATE TABLE IF NOT EXISTS, which is
// fine for creating tables but cannot change one. Each migration here
// runs exactly once, in order, and is recorded in schema_migrations in
// the same write batch as its statements, so a failed migration leaves
// nothing half applied.
import type { Client } from "@libsql/client";

interface Migration { id: string; statements: string[] }

const MIGRATIONS: Migration[] = [
  {
    id: "001_signin",
    statements: [
      `CREATE TABLE users (
        id              TEXT PRIMARY KEY,
        wallet_address  TEXT NOT NULL UNIQUE,
        role            TEXT NOT NULL DEFAULT 'creator',
        created_at      INTEGER NOT NULL,
        last_seen_at    INTEGER NOT NULL
      )`,
      `CREATE TABLE sessions (
        token_hash      TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        wallet_address  TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        expires_at      INTEGER NOT NULL,
        revoked_at      INTEGER
      )`,
      `CREATE INDEX sessions_user_idx ON sessions(user_id)`,
      `CREATE TABLE auth_nonces (
        nonce           TEXT PRIMARY KEY,
        created_at      INTEGER NOT NULL,
        expires_at      INTEGER NOT NULL,
        used_at         INTEGER
      )`,
      // Who reserved the upload. Set at /reserve, before any Shelby write,
      // so ownership exists from the first request.
      `ALTER TABLE videos ADD COLUMN owner_wallet TEXT`,
      `CREATE INDEX videos_owner_idx ON videos(owner_wallet)`,
    ],
  },
  {
    // vm_jobs: the durable job queue (see src/lib/jobs.ts)
    id: "002_jobs",
    statements: [
      `CREATE TABLE jobs (
        id               TEXT PRIMARY KEY,
        video_id         TEXT NOT NULL,
        kind             TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'queued',
        attempts         INTEGER NOT NULL DEFAULT 0,
        max_attempts     INTEGER NOT NULL DEFAULT 3,
        run_after        INTEGER NOT NULL,
        locked_by        TEXT,
        locked_until     INTEGER,
        idempotency_key  TEXT NOT NULL UNIQUE,
        payload          TEXT,
        error            TEXT,
        error_code       TEXT,
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL,
        started_at       INTEGER,
        finished_at      INTEGER
      )`,
      `CREATE INDEX jobs_due_idx ON jobs(status, run_after)`,
      `CREATE INDEX jobs_video_idx ON jobs(video_id)`,
      // Where the uploaded file sits until processing is done. This used
      // to be an in memory map, lost on every restart.
      `ALTER TABLE videos ADD COLUMN source_path TEXT`,
    ],
  },
  {
    // vm_storage: where each video's files are kept, and the usage ledger
    // (see src/lib/assets.ts and src/lib/usage.ts)
    id: "003_storage_usage",
    statements: [
      `CREATE TABLE media_assets (
        id              TEXT PRIMARY KEY,
        video_id        TEXT NOT NULL,
        owner_wallet    TEXT,
        kind            TEXT NOT NULL,
        storage_driver  TEXT NOT NULL,
        storage_key     TEXT NOT NULL,
        bytes           INTEGER NOT NULL,
        content_type    TEXT,
        sha256          TEXT,
        created_at      INTEGER NOT NULL
      )`,
      `CREATE INDEX media_assets_video_idx ON media_assets(video_id, kind)`,
      // Quantities only, never money. Rows are only ever added.
      `CREATE TABLE usage_ledger (
        id               TEXT PRIMARY KEY,
        created_at       INTEGER NOT NULL,
        owner_wallet     TEXT,
        actor_wallet     TEXT,
        video_id         TEXT,
        feature          TEXT NOT NULL,
        metric           TEXT NOT NULL,
        quantity         REAL NOT NULL,
        unit             TEXT NOT NULL,
        provider         TEXT,
        model            TEXT,
        job_id           TEXT,
        idempotency_key  TEXT UNIQUE,
        meta             TEXT
      )`,
      `CREATE INDEX usage_owner_idx ON usage_ledger(owner_wallet, created_at)`,
      `CREATE INDEX usage_video_idx ON usage_ledger(video_id)`,
    ],
  },
  {
    // vm_upload: uploads sent in parts straight to storage (see src/lib/uploads.ts)
    id: "004_uploads",
    statements: [
      `CREATE TABLE uploads (
        video_id        TEXT PRIMARY KEY,
        owner_wallet    TEXT NOT NULL,
        upload_id       TEXT NOT NULL,
        storage_driver  TEXT NOT NULL,
        storage_key     TEXT NOT NULL,
        filename        TEXT NOT NULL,
        content_type    TEXT,
        size_bytes      INTEGER NOT NULL,
        part_size       INTEGER NOT NULL,
        part_count      INTEGER NOT NULL,
        status          TEXT NOT NULL DEFAULT 'open',
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        completed_at    INTEGER
      )`,
      `CREATE INDEX uploads_owner_idx ON uploads(owner_wallet, status)`,
    ],
  },
  {
    // vm_info: category, visibility, tags and collections (see src/lib/videoInfo.ts).
    // Videos that exist already become "unlisted", which is how they have
    // behaved so far: anyone with the link can open them.
    id: "005_video_info",
    statements: [
      `ALTER TABLE videos ADD COLUMN category TEXT`,
      `ALTER TABLE videos ADD COLUMN visibility TEXT NOT NULL DEFAULT 'unlisted'`,
      `CREATE TABLE collections (
        id            TEXT PRIMARY KEY,
        owner_wallet  TEXT NOT NULL,
        name          TEXT NOT NULL,
        name_key      TEXT NOT NULL,
        description   TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      )`,
      `CREATE UNIQUE INDEX collections_owner_name_idx ON collections(owner_wallet, name_key)`,
      `CREATE TABLE collection_items (
        collection_id TEXT NOT NULL,
        video_id      TEXT NOT NULL,
        position      INTEGER NOT NULL DEFAULT 0,
        added_at      INTEGER NOT NULL,
        PRIMARY KEY (collection_id, video_id)
      )`,
      `CREATE INDEX collection_items_video_idx ON collection_items(video_id)`,
      `CREATE TABLE video_tags (
        video_id  TEXT NOT NULL,
        tag       TEXT NOT NULL,
        tag_key   TEXT NOT NULL,
        position  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (video_id, tag_key)
      )`,
      `CREATE INDEX video_tags_key_idx ON video_tags(tag_key)`,
    ],
  },
  {
    // vm_media: the facts FFmpeg reads from a file (length, size, codecs),
    // kept as one JSON value. Thumbnails are rows in media_assets and
    // need no new table. The table of the FFmpeg measurement goes: it
    // has done its job.
    id: "006_media",
    statements: [
      `ALTER TABLE videos ADD COLUMN media_json TEXT`,
      `DROP TABLE IF EXISTS media_probe_steps`,
    ],
  },
  {
    // vm_transcribe: long recordings are transcribed in pieces of about ten
    // minutes, cut where nobody is speaking. Each piece is saved the moment
    // it is done, so a restart only repeats the piece that was in progress.
    id: "007_transcription",
    statements: [
      `CREATE TABLE transcript_chunks (
        video_id        TEXT NOT NULL,
        idx             INTEGER NOT NULL,
        start_sec       REAL NOT NULL,
        end_sec         REAL NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        text            TEXT,
        segments_json   TEXT,
        words_json      TEXT,
        language        TEXT,
        billed_seconds  REAL,
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (video_id, idx)
      )`,
      // Videos that were refused only for being over 25 MB are transcribed now.
      `UPDATE videos SET status = 'transcribing'
        WHERE id IN (SELECT video_id FROM jobs WHERE kind = 'transcribe' AND status = 'failed' AND error_code = 'too_large')`,
      `UPDATE jobs SET status = 'queued', attempts = 0, run_after = 0, error = NULL, error_code = NULL, finished_at = NULL,
              updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
        WHERE kind = 'transcribe' AND status = 'failed' AND error_code = 'too_large'`,
    ],
  },
  {
    // vm_search: transcripts cut into passages of about a minute, each with
    // its embedding (text-embedding-3-small, 1536 numbers) as a libSQL
    // vector column. Search compares a question with every passage of the
    // wallet's videos. Videos transcribed before this part are queued by
    // the hourly housekeeping.
    id: "008_search",
    statements: [
      `CREATE TABLE passages (
        id          INTEGER PRIMARY KEY,
        video_id    TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        start_sec   REAL NOT NULL,
        end_sec     REAL NOT NULL,
        text        TEXT NOT NULL,
        embedding   F32_BLOB(1536) NOT NULL
      )`,
      `CREATE INDEX passages_video ON passages(video_id, seq)`,
    ],
  },
  {
    // vm_notes: each signed in viewer's own bookmarks and notes on a video,
    // at a moment in it. Private to the wallet that wrote them.
    id: "009_notes",
    statements: [
      `CREATE TABLE video_notes (
        id          TEXT PRIMARY KEY,
        video_id    TEXT NOT NULL,
        wallet      TEXT NOT NULL,
        kind        TEXT NOT NULL,
        at_sec      REAL NOT NULL,
        text        TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      )`,
      `CREATE INDEX video_notes_mine ON video_notes(wallet, video_id, at_sec)`,
      `CREATE INDEX video_notes_video ON video_notes(video_id)`,
    ],
  },
  {
    // vm_progress: where each signed in viewer stopped in each video, so
    // the video opens there again and Home can offer "Continue watching".
    id: "010_progress",
    statements: [
      `CREATE TABLE watch_progress (
        wallet        TEXT NOT NULL,
        video_id      TEXT NOT NULL,
        position_sec  REAL NOT NULL,
        duration_sec  REAL,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (wallet, video_id)
      )`,
      `CREATE INDEX watch_progress_recent ON watch_progress(wallet, updated_at)`,
      `CREATE INDEX watch_progress_video ON watch_progress(video_id)`,
    ],
  },
  {
    // vm_anchors: each time a video is stored on Shelby, and what the
    // chain says about it. A row is added when the owner's wallet reports
    // a store, and the server confirms it from the Shelby object index.
    // Rows are kept when a store lapses or the network is reset, so the
    // history and the first commitment stay.
    id: "011_anchors",
    statements: [
      `CREATE TABLE anchors (
        id            TEXT PRIMARY KEY,
        video_id      TEXT NOT NULL,
        wallet        TEXT NOT NULL,
        network       TEXT NOT NULL,
        blob_name     TEXT NOT NULL,
        object_name   TEXT NOT NULL,
        state         TEXT NOT NULL,
        blob_uid      TEXT,
        commitment    TEXT,
        size_bytes    INTEGER,
        paid_until    INTEGER,
        committed_at  INTEGER,
        same_as_first INTEGER,
        error         TEXT,
        created_at    INTEGER NOT NULL,
        checked_at    INTEGER,
        updated_at    INTEGER NOT NULL
      )`,
      `CREATE INDEX anchors_video ON anchors(video_id, created_at)`,
      `CREATE INDEX anchors_state ON anchors(state, checked_at)`,
      // Videos stored on Shelby before this table existed are checked like new ones.
      `INSERT INTO anchors (id, video_id, wallet, network, blob_name, object_name, state, created_at, updated_at)
         SELECT lower(hex(randomblob(16))), video_id, lower(account_address), 'shelbynet', video_blob_name,
                '@' || lower(substr(account_address, 3)) || '/' || video_blob_name,
                'checking', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
           FROM video_shelby
          WHERE COALESCE(account_address, '') != '' AND COALESCE(video_tx_hash, '') != '' AND COALESCE(video_blob_name, '') != ''`,
    ],
  },
  {
    // vm_profile: the name and short bio a wallet shows on its public page.
    id: "012_profiles",
    statements: [
      `CREATE TABLE profiles (
        wallet      TEXT PRIMARY KEY,
        name        TEXT,
        bio         TEXT,
        updated_at  INTEGER NOT NULL
      )`,
    ],
  },
  {
    // vm_clips: clips cut from a video. The file itself is a media asset
    // (kind "clip"), so it is counted, swept and deleted with the video.
    id: "013_clips",
    statements: [
      `CREATE TABLE clips (
        id          TEXT PRIMARY KEY,
        video_id    TEXT NOT NULL,
        wallet      TEXT NOT NULL,
        kind        TEXT NOT NULL,
        frame       TEXT NOT NULL,
        captions    INTEGER NOT NULL DEFAULT 0,
        start_sec   REAL NOT NULL,
        end_sec     REAL NOT NULL,
        title       TEXT NOT NULL,
        status      TEXT NOT NULL,
        note        TEXT,
        error       TEXT,
        asset_id    TEXT,
        size_bytes  INTEGER,
        file_name   TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      )`,
      `CREATE INDEX clips_video ON clips(video_id, created_at)`,
      `CREATE INDEX clips_wallet ON clips(wallet, created_at)`,
    ],
  },
];

export async function runMigrations(db: Client): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id          TEXT PRIMARY KEY,
       applied_at  INTEGER NOT NULL
     )`
  );
  const done = await db.execute("SELECT id FROM schema_migrations");
  const applied = new Set(done.rows.map((r) => String((r as Record<string, unknown>).id)));

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.batch(
      [
        ...m.statements.map((sql) => ({ sql, args: [] })),
        { sql: "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", args: [m.id, Date.now()] },
      ],
      "write"
    );
    console.log(`[DB] Migration applied: ${m.id}`);
  }
}
