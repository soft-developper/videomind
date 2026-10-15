// src/lib/adminInsights.ts
// vm_insights: the dashboard's Insights section. Daily series across the
// whole site (views, new wallets, uploads, minutes transcribed, AI tokens),
// the most watched videos, and the full admin audit log with filters.
// Days are UTC, like the view counts (views.ts).
import { getDb } from "./db.js";
import { dayOf } from "./views.js";
import { namesOf } from "./profiles.js";
import { normalizeWallet } from "./auth.js";
import { thumbUrls } from "../routes/videos.js";

const n = (v: unknown) => Number(v ?? 0) || 0;
const DAY = 86400_000;

export const METRICS = ["views", "watch_minutes", "new_wallets", "uploads", "transcribed_minutes", "ai_tokens", "live_events"] as const;
export type InsightMetric = (typeof METRICS)[number];
export const RANGES = [7, 28, 90, 365] as const;

export function rangeOf(days: unknown): number {
  const d = Math.floor(n(days));
  return (RANGES as readonly number[]).includes(d) ? d : 28;
}

/** Every UTC day from (days - 1) days ago to today, oldest first. */
function dayList(days: number, now: number) {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayOf(now - i * DAY));
  return out;
}

// Rows of { d: "YYYY-MM-DD", v: number } for times kept in milliseconds.
const byDayMs = (col: string) => `strftime('%Y-%m-%d', ${col} / 1000, 'unixepoch')`;

export async function series(metric: unknown, days: unknown, now = Date.now()) {
  const m: InsightMetric = (METRICS as readonly string[]).includes(String(metric)) ? (metric as InsightMetric) : "views";
  const range = rangeOf(days);
  const list = dayList(range, now);
  const first = list[0];
  const startMs = Date.parse(first + "T00:00:00Z");
  const db = getDb();
  let sql: string; let args: any[];
  switch (m) {
    case "views":
      sql = "SELECT day AS d, SUM(views) AS v FROM video_views WHERE day >= ? GROUP BY day"; args = [first]; break;
    case "watch_minutes":
      sql = "SELECT day AS d, SUM(watch_seconds) / 60.0 AS v FROM video_views WHERE day >= ? GROUP BY day"; args = [first]; break;
    case "new_wallets":
      sql = `SELECT ${byDayMs("created_at")} AS d, COUNT(*) AS v FROM users WHERE created_at >= ? GROUP BY d`; args = [startMs]; break;
    case "uploads":
      sql = `SELECT ${byDayMs("created_at")} AS d, COUNT(*) AS v FROM videos WHERE created_at >= ? AND status != 'uploading' GROUP BY d`; args = [startMs]; break;
    case "transcribed_minutes":
      sql = `SELECT ${byDayMs("created_at")} AS d, SUM(quantity) / 60.0 AS v FROM usage_ledger WHERE created_at >= ? AND metric = 'audio_seconds' GROUP BY d`; args = [startMs]; break;
    case "ai_tokens":
      sql = `SELECT ${byDayMs("created_at")} AS d, SUM(quantity) AS v FROM usage_ledger
              WHERE created_at >= ? AND metric IN ('input_tokens','output_tokens','cache_write_tokens','cache_read_tokens') GROUP BY d`; args = [startMs]; break;
    case "live_events":
      sql = `SELECT ${byDayMs("created_at")} AS d, COUNT(*) AS v FROM live_events WHERE created_at >= ? GROUP BY d`; args = [startMs]; break;
  }
  const r = await db.execute({ sql, args });
  const got = new Map((r.rows as any[]).map((x) => [String(x.d), n(x.v)]));
  const points = list.map((d) => ({ day: d, value: Math.round((got.get(d) ?? 0) * 10) / 10 }));
  // The same length of time just before, for "compared with the previous period".
  const prevStart = dayOf(startMs - range * DAY);
  let previous = 0;
  if (m === "views" || m === "watch_minutes") {
    const col = m === "views" ? "SUM(views)" : "SUM(watch_seconds) / 60.0";
    previous = n(((await db.execute({ sql: `SELECT ${col} AS v FROM video_views WHERE day >= ? AND day < ?`, args: [prevStart, first] })).rows[0] as any)?.v);
  } else {
    const a = startMs - range * DAY, b = startMs;
    const q: Record<string, string> = {
      new_wallets: "SELECT COUNT(*) AS v FROM users WHERE created_at >= ? AND created_at < ?",
      uploads: "SELECT COUNT(*) AS v FROM videos WHERE created_at >= ? AND created_at < ? AND status != 'uploading'",
      transcribed_minutes: "SELECT SUM(quantity) / 60.0 AS v FROM usage_ledger WHERE created_at >= ? AND created_at < ? AND metric = 'audio_seconds'",
      ai_tokens: "SELECT SUM(quantity) AS v FROM usage_ledger WHERE created_at >= ? AND created_at < ? AND metric IN ('input_tokens','output_tokens','cache_write_tokens','cache_read_tokens')",
      live_events: "SELECT COUNT(*) AS v FROM live_events WHERE created_at >= ? AND created_at < ?",
    };
    previous = n(((await db.execute({ sql: q[m], args: [a, b] })).rows[0] as any)?.v);
  }
  const total = points.reduce((s, p) => s + p.value, 0);
  return { metric: m, days: range, points, total: Math.round(total * 10) / 10, previous: Math.round(previous * 10) / 10 };
}

/** AI and transcription use by feature in the range, for the breakdown under the chart. */
export async function usageByFeature(days: unknown, now = Date.now()) {
  const range = rangeOf(days);
  const startMs = Date.parse(dayOf(now - (range - 1) * DAY) + "T00:00:00Z");
  const r = await getDb().execute({
    sql: `SELECT feature, metric, SUM(quantity) AS q FROM usage_ledger WHERE created_at >= ? AND metric NOT IN ('bytes_stored','bytes_deleted') GROUP BY feature, metric`,
    args: [startMs],
  });
  const out = new Map<string, { feature: string; audioMinutes: number; tokens: number }>();
  for (const x of r.rows as any[]) {
    const f = String(x.feature);
    const e = out.get(f) ?? { feature: f, audioMinutes: 0, tokens: 0 };
    if (String(x.metric) === "audio_seconds") e.audioMinutes += n(x.q) / 60; else e.tokens += n(x.q);
    out.set(f, e);
  }
  return [...out.values()].map((e) => ({ ...e, audioMinutes: Math.round(e.audioMinutes * 10) / 10 })).sort((a, b) => b.tokens - a.tokens || b.audioMinutes - a.audioMinutes);
}

export async function topVideos(days: unknown, now = Date.now()) {
  const range = rangeOf(days);
  const r = await getDb().execute({
    sql: `SELECT vv.video_id AS id, SUM(vv.views) AS views, SUM(vv.watch_seconds) AS ws, v.title AS title,
                 COALESCE(v.owner_wallet, s.account_address) AS owner, COALESCE(v.visibility, 'unlisted') AS visibility, v.removed_at AS removed_at
            FROM video_views vv JOIN videos v ON v.id = vv.video_id LEFT JOIN video_shelby s ON s.video_id = vv.video_id
           WHERE vv.day >= ? GROUP BY vv.video_id ORDER BY views DESC, ws DESC LIMIT 20`,
    args: [dayOf(now - (range - 1) * DAY)],
  });
  const rows = r.rows as any[];
  const owners = [...new Set(rows.map((x) => normalizeWallet(x.owner)).filter(Boolean) as string[])];
  const names = owners.length ? await namesOf(owners).catch(() => new Map<string, string>()) : new Map<string, string>();
  const thumbs = rows.length ? await thumbUrls(rows.map((x) => String(x.id))).catch(() => new Map<string, string | null>()) : new Map<string, string | null>();
  return {
    days: range,
    videos: rows.map((x) => {
      const owner = normalizeWallet(x.owner);
      return {
        id: String(x.id), title: String(x.title ?? ""), views: n(x.views), watchMinutes: Math.round(n(x.ws) / 6) / 10,
        owner, ownerName: owner ? names.get(owner) ?? null : null, visibility: String(x.visibility), removed: x.removed_at != null,
        thumbUrl: thumbs.get(String(x.id)) ?? null,
      };
    }),
  };
}

/** The audit log, newest first, with optional filters. Paged by id. */
export async function auditLog(o: { action?: unknown; email?: unknown; q?: unknown; before?: unknown; limit?: unknown }) {
  const where: string[] = []; const args: any[] = [];
  const action = String(o.action ?? "").trim();
  if (/^[a-z_]{2,40}$/.test(action)) { where.push("action = ?"); args.push(action); }
  const email = String(o.email ?? "").trim().toLowerCase().slice(0, 200);
  if (email) { where.push("LOWER(email) = ?"); args.push(email); }
  const q = String(o.q ?? "").trim().toLowerCase().slice(0, 100);
  if (q) { where.push("(LOWER(COALESCE(target, '')) LIKE ? OR LOWER(COALESCE(detail, '')) LIKE ?)"); args.push(`%${q}%`, `%${q}%`); }
  const before = Math.floor(n(o.before));
  if (before > 0) { where.push("id < ?"); args.push(before); }
  const limit = Math.min(Math.max(Math.floor(n(o.limit)) || 50, 1), 200);
  const db = getDb();
  const [rows, actions, admins] = await Promise.all([
    db.execute({ sql: `SELECT * FROM admin_audit ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`, args: [...args, limit + 1] }),
    db.execute("SELECT action, COUNT(*) AS n FROM admin_audit GROUP BY action ORDER BY action"),
    db.execute("SELECT DISTINCT email FROM admin_audit WHERE email IS NOT NULL ORDER BY email"),
  ]);
  const list = (rows.rows as any[]).slice(0, limit);
  const more = rows.rows.length > limit;
  return {
    entries: list.map((x) => {
      let detail: unknown = null;
      try { detail = x.detail ? JSON.parse(String(x.detail)) : null; } catch { detail = String(x.detail); }
      return { id: n(x.id), at: n(x.at), email: x.email ? String(x.email) : null, action: String(x.action), target: x.target ? String(x.target) : null, detail };
    }),
    next: more && list.length ? n(list[list.length - 1].id) : null,
    actions: (actions.rows as any[]).map((x) => ({ action: String(x.action), count: n(x.n) })),
    admins: (admins.rows as any[]).map((x) => String(x.email)),
  };
}
