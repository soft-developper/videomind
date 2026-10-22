// src/lib/adminOverview.ts
// vm_admin: the numbers on the dashboard's Overview page. Counts only,
// across the whole site. "Active" means signed in during the period:
// users.last_seen_at is updated at each wallet sign in, not on every visit.
import { getDb } from "./db.js";
import { storageHealth } from "./storage.js";
import { mediaHealth } from "./media.js";
import { liveConfig } from "./live.js";
import { youtubeConfig } from "./youtube.js";
import { mailConfigured } from "./mail.js";
import { adminKeySet, recentAudit } from "./admin.js";
import { dayOf } from "./views.js";
import { pricingReport } from "./pricing.js";

const DAY = 24 * 3600_000;
const one = async (sql: string, args: any[] = []) => {
  const r = await getDb().execute({ sql, args });
  return (r.rows[0] ?? {}) as Record<string, unknown>;
};
const n = (v: unknown) => Number(v ?? 0) || 0;

export async function overview(now = Date.now()) {
  const d7 = now - 7 * DAY, d30 = now - 30 * DAY;
  const month = new Date(now); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const m0 = month.getTime();

  const [users, sessions, videos, stored, usage, views, live, jobs, yt, dbOk] = await Promise.all([
    one(`SELECT COUNT(*) AS total, SUM(created_at >= ?) AS new7, SUM(created_at >= ?) AS new30,
                SUM(last_seen_at >= ?) AS active7, SUM(last_seen_at >= ?) AS active30 FROM users`, [d7, d30, d7, d30]),
    one("SELECT COUNT(*) AS open, COUNT(DISTINCT wallet_address) AS wallets FROM sessions WHERE revoked_at IS NULL AND expires_at > ?", [now]),
    one(`SELECT COUNT(*) AS total, SUM(created_at >= ?) AS new7, SUM(created_at >= ?) AS new30,
                SUM(status = 'ready') AS ready, SUM(status = 'error') AS failed,
                SUM(status IN ('uploading','transcribing','analyzing','processing')) AS working FROM videos`, [d7, d30]),
    one("SELECT COALESCE(SUM(CASE metric WHEN 'bytes_stored' THEN quantity WHEN 'bytes_deleted' THEN -quantity ELSE 0 END), 0) AS bytes FROM usage_ledger"),
    getDb().execute({ sql: "SELECT feature, metric, SUM(quantity) AS total FROM usage_ledger WHERE created_at >= ? GROUP BY feature, metric", args: [m0] }),
    one("SELECT COALESCE(SUM(CASE WHEN day >= ? THEN views END), 0) AS v7, COALESCE(SUM(views), 0) AS v30, COALESCE(SUM(watch_seconds), 0) AS w30 FROM video_views WHERE day >= ?", [dayOf(now - 6 * DAY), dayOf(now - 29 * DAY)]),
    one("SELECT COUNT(*) AS total, SUM(status = 'live') AS now, SUM(created_at >= ?) AS new30 FROM live_events", [d30]),
    one(`SELECT SUM(status = 'failed') AS failed, SUM(status = 'queued') AS queued, SUM(status = 'running') AS running FROM jobs`),
    one("SELECT SUM(status = 'done') AS done, SUM(status = 'failed') AS failed FROM publications WHERE created_at >= ?", [d30]),
    getDb().execute("SELECT 1").then(() => true, () => false),
  ]);

  const month_: Record<string, number> = {};
  for (const r of usage.rows as any[]) {
    const k = String(r.metric);
    month_[k] = (month_[k] ?? 0) + n(r.total);
  }
  const s = storageHealth(), media = mediaHealth();
  return {
    at: now,
    monthStart: m0,
    users: { total: n(users.total), new7: n(users.new7), new30: n(users.new30), active7: n(users.active7), active30: n(users.active30), signedInNow: n(sessions.wallets) },
    videos: { total: n(videos.total), new7: n(videos.new7), new30: n(videos.new30), ready: n(videos.ready), failed: n(videos.failed), working: n(videos.working) },
    storage: { bytes: Math.max(0, n(stored.bytes)) },
    usageThisMonth: {
      transcribedSeconds: month_.audio_seconds ?? 0,
      inputTokens: (month_.input_tokens ?? 0) + (month_.cache_write_tokens ?? 0) + (month_.cache_read_tokens ?? 0),
      outputTokens: month_.output_tokens ?? 0,
      bytesUploaded: month_.bytes_stored ?? 0,
    },
    views: { last7: n(views.v7), last30: n(views.v30), watchSeconds30: Math.round(n(views.w30)) },
    live: { total: n(live.total), liveNow: n(live.now), new30: n(live.new30) },
    jobs: { failed: n(jobs.failed), queued: n(jobs.queued), running: n(jobs.running) },
    youtube: { published30: n(yt.done), failed30: n(yt.failed) },
    // optional: a service that may be left off on purpose; shown grey, not as a problem
    health: [
      { name: "Database", ok: dbOk, note: dbOk ? "Answering" : "Not answering" },
      { name: "Storage", ok: !!s.ok, note: `${s.driver}${s.durable ? "" : ", not durable"}${s.ok ? "" : ", startup check failed"}` },
      { name: "Video tools (FFmpeg)", ok: !!media.ffmpeg, note: media.ffmpeg ? `FFmpeg ${media.ffmpeg}` : "Not found" },
      { name: "Transcription and search (OpenAI)", ok: !!process.env.OPENAI_API_KEY?.trim(), note: process.env.OPENAI_API_KEY?.trim() ? "Key set" : "OPENAI_API_KEY missing" },
      { name: "Chapters and answers (Anthropic)", ok: !!process.env.ANTHROPIC_API_KEY?.trim(), note: process.env.ANTHROPIC_API_KEY?.trim() ? "Key set" : "ANTHROPIC_API_KEY missing" },
      { name: "Live (LiveKit)", ok: !!liveConfig(), optional: true, note: liveConfig() ? "Set up" : "Not set up" },
      { name: "YouTube (Google)", ok: !!youtubeConfig(), optional: true, note: youtubeConfig() ? "Set up" : "Not set up" },
      { name: "Email (Resend)", ok: mailConfigured(), note: mailConfigured() ? "Set up" : "RESEND_API_KEY or MAIL_FROM missing" },
      { name: "Admin key", ok: adminKeySet(), note: adminKeySet() ? "Set" : "ADMIN_KEY missing" },
    ],
    adminActivity: await recentAudit(12),
    // vm_pricing: actions priced below what they cost, and what that cost this month
    pricing: await pricingReport(now).then((p) => ({ charging: p.charging, belowCost: p.belowCost, lossMicros: p.totals.lossMicros }), () => null),
  };
}
