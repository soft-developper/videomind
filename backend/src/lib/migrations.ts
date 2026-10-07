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
