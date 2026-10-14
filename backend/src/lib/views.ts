// src/lib/views.ts
// vm_analytics: counting plays without cookies and without storing who watched.
//
// What is stored: for each video and each day (UTC), how many views, how
// many seconds were watched, and how many views reached the last tenth.
// Nothing about the viewer is stored.
//
// How a view is counted once: the player's browser tab makes a random id
// and keeps it only in that tab (sessionStorage, gone when the tab is
// closed). The tab reports how many seconds it has played in total. The
// server keeps the tab id in memory only, to turn those running totals
// into additions, and forgets it after a day without reports. The IP
// address is used in memory only, to cap views per caller.
//
// Rules:
//   - a view counts after 5 seconds of playing;
//   - one tab is one view of a video, however often it is replayed;
//   - the owner's own plays are not counted;
//   - at most VIEWS_PER_CALLER_DAY views of one video per caller per day;
//   - watch time can only grow about as fast as real time passes (up to 2x speed).
import { getDb } from "./db.js";

export const VIEW_AFTER_SECONDS = 5;
export const END_FRACTION = 0.9;
const TAB_RE = /^[A-Za-z0-9_-]{8,48}$/;
const KEEP_MS = 24 * 3600_000;
const MAX_TABS = 200_000;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
const perCallerDay = () => envInt("VIEWS_PER_CALLER_DAY", 10);

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface TabState { watched: number; counted: boolean; ended: boolean; lastAt: number }
const tabs = new Map<string, TabState>();
const callers = new Map<string, { day: string; n: number }>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 10 * 60_000 && tabs.size < MAX_TABS) return;
  lastSweep = now;
  tabs.forEach((s, k) => { if (now - s.lastAt > KEEP_MS) tabs.delete(k); });
  const today = dayOf(now);
  callers.forEach((c, k) => { if (c.day !== today) callers.delete(k); });
  // Still too many: drop the oldest. Worst case a long paused tab counts again.
  if (tabs.size >= MAX_TABS) {
    const old = [...tabs.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt).slice(0, Math.ceil(MAX_TABS / 4));
    for (const [k] of old) tabs.delete(k);
  }
}

export class ViewError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface ViewReport { tab: string; watched: number; reached: number }

/** Check what a player sent. */
export function parseReport(body: unknown): ViewReport {
  const b = (body ?? {}) as Record<string, unknown>;
  const tab = String(b.tab ?? "");
  if (!TAB_RE.test(tab)) throw new ViewError("bad_tab", "The tab id is not valid.");
  const watched = Number(b.watched), reached = Number(b.reached ?? 0);
  if (!Number.isFinite(watched) || watched < 0 || watched > 24 * 3600) throw new ViewError("bad_watched", "Seconds watched must be between 0 and 86400.");
  if (!Number.isFinite(reached) || reached < 0 || reached > 1.0001) throw new ViewError("bad_reached", "How far the video got must be between 0 and 1.");
  return { tab, watched, reached: Math.min(1, reached) };
}

export interface ViewResult { counted: boolean; view: boolean; addedSeconds: number; ended: boolean; reason?: string }

/**
 * Turn one report into additions to today's totals for the video.
 * `caller` is the IP address (memory only). `durationSeconds` bounds the watch time of one tab.
 */
export async function recordView(videoId: string, r: ViewReport, caller: string, durationSeconds: number | null, now = Date.now()): Promise<ViewResult> {
  sweep(now);
  const key = `${videoId}|${r.tab}`;
  const cap = durationSeconds && durationSeconds > 0 ? durationSeconds * 3 + 60 : 6 * 3600;
  let s = tabs.get(key);
  let view = false;
  let add = 0;

  if (!s) {
    if (r.watched < VIEW_AFTER_SECONDS) return { counted: false, view: false, addedSeconds: 0, ended: false, reason: "too_short" };
    if (r.watched > 30) {
      // A tab already counted before the server restarted: carry on from here, without a new view.
      tabs.set(key, { watched: r.watched, counted: true, ended: r.reached >= END_FRACTION, lastAt: now });
      return { counted: false, view: false, addedSeconds: 0, ended: false, reason: "resumed" };
    }
    const today = dayOf(now);
    const ck = `${videoId}|${caller}`;
    const c = callers.get(ck);
    const n = c && c.day === today ? c.n : 0;
    if (n >= perCallerDay()) {
      // Remember the tab so its later reports do not count either.
      tabs.set(key, { watched: r.watched, counted: false, ended: true, lastAt: now });
      return { counted: false, view: false, addedSeconds: 0, ended: false, reason: "caller_limit" };
    }
    callers.set(ck, { day: today, n: n + 1 });
    s = { watched: 0, counted: true, ended: false, lastAt: now - Math.min(r.watched, 30) * 1000 };
    tabs.set(key, s);
    view = true;
  }
  if (!s.counted) { s.lastAt = now; return { counted: false, view: false, addedSeconds: 0, ended: false, reason: "caller_limit" }; }

  // Watch time grows by what this tab played since its last report, no
  // faster than about twice real time, and no more than `cap` in total.
  const elapsed = Math.max(0, (now - s.lastAt) / 1000);
  const want = Math.min(r.watched, cap) - s.watched;
  add = Math.max(0, Math.min(want, elapsed * 2.2 + 3));
  s.watched += add;
  s.lastAt = now;
  let ended = false;
  if (!s.ended && r.reached >= END_FRACTION) { s.ended = true; ended = true; }

  if (view || add > 0 || ended) {
    await getDb().execute({
      sql: `INSERT INTO video_views (video_id, day, views, watch_seconds, ended) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(video_id, day) DO UPDATE SET views = views + excluded.views,
              watch_seconds = watch_seconds + excluded.watch_seconds, ended = ended + excluded.ended`,
      args: [videoId, dayOf(now), view ? 1 : 0, Math.round(add * 10) / 10, ended ? 1 : 0],
    });
  }
  return { counted: true, view, addedSeconds: add, ended };
}

/** The counts go with the video. */
export async function deleteViewsForVideo(videoId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM video_views WHERE video_id = ?", args: [videoId] });
  const pre = `${videoId}|`;
  tabs.forEach((_, k) => { if (k.startsWith(pre)) tabs.delete(k); });
}

/** For tests: forget every tab and caller, as a restart does. */
export function forgetTabs() { tabs.clear(); callers.clear(); }
