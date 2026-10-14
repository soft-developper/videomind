// src/lib/analytics.ts
// vm_analytics: what the Analytics page shows a wallet about its own videos
// and live events. Views and watch time come from video_views (daily
// totals, see views.ts). Signed in viewers come from watch_progress,
// counted, never named. Nothing here says who watched.
import { getDb } from "./db.js";
import { store } from "./store.js";
import { eventsOf } from "./live.js";
import { dayOf } from "./views.js";

export const RANGES = [7, 28, 90, 365] as const;
const DAY_MS = 24 * 3600_000;

export interface DayRow { day: string; views: number; watchSeconds: number }
export interface Totals { views: number; watchSeconds: number; ended: number }

const num = (v: unknown) => Number(v ?? 0) || 0;
const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/** The days of a range, oldest first, ending today (UTC). */
export function rangeDays(days: number, now = Date.now()): string[] {
  return Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * DAY_MS));
}

export async function ownerAnalytics(wallet: string, days: number, videoId: string | null, now = Date.now()) {
  const db = getDb();
  const all = await store.getAll(wallet);
  const videos = videoId ? all.filter((v) => v.id === videoId) : all;
  const ids = videos.map((v) => v.id);
  const span = rangeDays(days, now);
  const first = span[0], last = span[span.length - 1];
  const prevFirst = dayOf(now - (2 * days - 1) * DAY_MS), prevLast = dayOf(now - days * DAY_MS);

  const daily = new Map<string, DayRow>(span.map((d) => [d, { day: d, views: 0, watchSeconds: 0 }]));
  const per = new Map<string, Totals & { allTimeViews: number }>();
  const totals: Totals = { views: 0, watchSeconds: 0, ended: 0 };
  const previous: Totals = { views: 0, watchSeconds: 0, ended: 0 };
  const signedIn = new Map<string, number>();
  const pubs = new Map<string, number>();
  const clips = new Map<string, number>();

  if (ids.length) {
    const rows = (await db.execute({
      sql: `SELECT video_id, day, views, watch_seconds, ended FROM video_views
             WHERE video_id IN (${marks(ids.length)}) AND day >= ?`,
      args: [...ids, prevFirst],
    })).rows as Array<Record<string, unknown>>;
    for (const r of rows) {
      const d = String(r.day), id = String(r.video_id);
      const t = { views: num(r.views), watchSeconds: num(r.watch_seconds), ended: num(r.ended) };
      if (d >= first && d <= last) {
        const row = daily.get(d)!; row.views += t.views; row.watchSeconds += t.watchSeconds;
        totals.views += t.views; totals.watchSeconds += t.watchSeconds; totals.ended += t.ended;
        const p = per.get(id) ?? { views: 0, watchSeconds: 0, ended: 0, allTimeViews: 0 };
        p.views += t.views; p.watchSeconds += t.watchSeconds; p.ended += t.ended; per.set(id, p);
      } else if (d >= prevFirst && d <= prevLast) {
        previous.views += t.views; previous.watchSeconds += t.watchSeconds; previous.ended += t.ended;
      }
    }
    const allTime = (await db.execute({
      sql: `SELECT video_id, SUM(views) AS n FROM video_views WHERE video_id IN (${marks(ids.length)}) GROUP BY video_id`, args: ids,
    })).rows as Array<Record<string, unknown>>;
    for (const r of allTime) {
      const id = String(r.video_id);
      const p = per.get(id) ?? { views: 0, watchSeconds: 0, ended: 0, allTimeViews: 0 };
      p.allTimeViews = num(r.n); per.set(id, p);
    }
    // Signed in viewers other than the owner who have a place saved in the video.
    for (const r of (await db.execute({
      sql: `SELECT video_id, COUNT(*) AS n FROM watch_progress WHERE video_id IN (${marks(ids.length)}) AND wallet != ? GROUP BY video_id`,
      args: [...ids, wallet],
    })).rows as Array<Record<string, unknown>>) signedIn.set(String(r.video_id), num(r.n));
    for (const r of (await db.execute({
      sql: `SELECT video_id, COUNT(*) AS n FROM publications WHERE video_id IN (${marks(ids.length)}) AND status = 'done' GROUP BY video_id`, args: ids,
    })).rows as Array<Record<string, unknown>>) pubs.set(String(r.video_id), num(r.n));
    for (const r of (await db.execute({
      sql: `SELECT video_id, COUNT(*) AS n FROM clips WHERE video_id IN (${marks(ids.length)}) AND status = 'ready' GROUP BY video_id`, args: ids,
    })).rows as Array<Record<string, unknown>>) clips.set(String(r.video_id), num(r.n));
  }

  const videoRows = videos.map((v) => {
    const p = per.get(v.id) ?? { views: 0, watchSeconds: 0, ended: 0, allTimeViews: 0 };
    return {
      id: v.id, title: v.title, status: v.status, visibility: v.visibility ?? "unlisted", createdAt: v.createdAt,
      durationSeconds: v.meta?.durationSeconds ?? v.media?.durationSeconds ?? null,
      views: p.views, watchSeconds: Math.round(p.watchSeconds), ended: p.ended, allTimeViews: p.allTimeViews,
      signedInViewers: signedIn.get(v.id) ?? 0, youtube: pubs.get(v.id) ?? 0, clips: clips.get(v.id) ?? 0,
    };
  }).sort((a, b) => b.views - a.views || b.allTimeViews - a.allTimeViews || b.createdAt - a.createdAt);

  // Live events that started (or were made) in the range. Not filtered by video.
  const since = now - days * DAY_MS;
  const events = videoId ? [] : (await eventsOf(wallet)).filter((e) => (e.startedAt ?? e.createdAt) >= since);
  const chat = new Map<string, number>();
  if (events.length) {
    for (const r of (await db.execute({
      sql: `SELECT event_id, COUNT(*) AS n FROM live_chat WHERE event_id IN (${marks(events.length)}) AND deleted = 0 GROUP BY event_id`,
      args: events.map((e) => e.id),
    })).rows as Array<Record<string, unknown>>) chat.set(String(r.event_id), num(r.n));
  }
  const live = events.map((e) => ({
    id: e.id, title: e.title, status: e.status, startedAt: e.startedAt, endedAt: e.endedAt,
    durationSeconds: e.startedAt && e.endedAt ? Math.round((e.endedAt - e.startedAt) / 1000) : null,
    peakViewers: e.peakViewers, chatMessages: chat.get(e.id) ?? 0, captionSeconds: e.captionSeconds, videoId: e.videoId,
  }));

  return {
    days, from: first, to: last, videoId,
    totals: { ...totals, watchSeconds: Math.round(totals.watchSeconds) },
    previous: { ...previous, watchSeconds: Math.round(previous.watchSeconds) },
    daily: [...daily.values()].map((d) => ({ ...d, watchSeconds: Math.round(d.watchSeconds) })),
    videos: videoRows,
    live,
  };
}
