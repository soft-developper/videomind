// src/lib/adminContent.ts
// vm_content: the dashboard's Content section. Every video, live event and
// YouTube upload on VideoMind. An admin can take a video down (for example
// after a copyright complaint under the Terms), restore it, and end a live
// event. A video taken down opens only for its owner, who is told why; it
// leaves public profiles, shared links, previews and Continue watching, and
// cannot be published to YouTube. Copies already on Shelby or YouTube are
// outside VideoMind and stay.
import { getDb } from "./db.js";
import { store } from "./store.js";
import { normalizeWallet, allowedOrigins } from "./auth.js";
import { ownerOf } from "./usage.js";
import { namesOf } from "./profiles.js";
import { getEvent, endEvent } from "./live.js";
import { dayOf } from "./views.js";
import { playbackOf, thumbUrls } from "../routes/videos.js";

const n = (v: unknown) => Number(v ?? 0) || 0;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const DAY = 86400_000;

export class ContentError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** The main site's address, for links to shared pages. */
export const siteUrl = () => allowedOrigins()[0] ?? "https://vidzmind.xyz";

export type VideoFilter = "all" | "public" | "unlisted" | "private" | "removed";
export type VideoSort = "newest" | "views" | "size";
const FILTERS: VideoFilter[] = ["all", "public", "unlisted", "private", "removed"];
const SORTS: VideoSort[] = ["newest", "views", "size"];

export async function listVideos(o: { q?: unknown; filter?: unknown; sort?: unknown; limit?: unknown; offset?: unknown }) {
  const q = String(o.q ?? "").trim().toLowerCase().slice(0, 100);
  const filter: VideoFilter = FILTERS.includes(o.filter as VideoFilter) ? (o.filter as VideoFilter) : "all";
  const sort: VideoSort = SORTS.includes(o.sort as VideoSort) ? (o.sort as VideoSort) : "newest";
  const limit = Math.min(Math.max(Math.floor(n(o.limit)) || 50, 1), 200);
  const offset = Math.max(Math.floor(n(o.offset)), 0);
  const since = dayOf(Date.now() - 29 * DAY);
  const where = ["v.status != 'uploading'"]; const args: any[] = [since];
  if (q) { where.push("(LOWER(v.title) LIKE ? OR v.id LIKE ? OR LOWER(COALESCE(v.owner_wallet, s.account_address, '')) LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (filter === "removed") where.push("v.removed_at IS NOT NULL");
  else if (filter !== "all") { where.push("COALESCE(v.visibility, 'unlisted') = ? AND v.removed_at IS NULL"); args.push(filter); }
  const order = { newest: "v.created_at DESC", views: "views30 DESC, v.created_at DESC", size: "v.size_bytes DESC, v.created_at DESC" }[sort];
  const sql = `SELECT v.id AS id, v.title AS title, v.status AS status, COALESCE(v.visibility, 'unlisted') AS visibility, v.created_at AS created_at,
                      v.size_bytes AS size_bytes, v.duration_sec AS duration_sec, COALESCE(v.owner_wallet, s.account_address) AS owner,
                      v.removed_at AS removed_at, v.removed_reason AS removed_reason,
                      COALESCE((SELECT SUM(views) FROM video_views vv WHERE vv.video_id = v.id AND vv.day >= ?), 0) AS views30
                 FROM videos v LEFT JOIN video_shelby s ON s.video_id = v.id
                WHERE ${where.join(" AND ")}`;
  const db = getDb();
  const [rows, total] = await Promise.all([
    db.execute({ sql: `${sql} ORDER BY ${order} LIMIT ? OFFSET ?`, args: [...args, limit, offset] }),
    db.execute({ sql: `SELECT COUNT(*) AS n FROM (${sql})`, args }),
  ]);
  const list = rows.rows as any[];
  const owners = [...new Set(list.map((r) => normalizeWallet(r.owner)).filter(Boolean) as string[])];
  const names = owners.length ? await namesOf(owners).catch(() => new Map<string, string>()) : new Map<string, string>();
  const thumbs = list.length ? await thumbUrls(list.map((r) => String(r.id))).catch(() => new Map<string, string | null>()) : new Map<string, string | null>();
  return {
    videos: list.map((r) => {
      const owner = normalizeWallet(r.owner);
      return {
        id: String(r.id), title: String(r.title), status: String(r.status), visibility: String(r.visibility), createdAt: n(r.created_at),
        sizeBytes: n(r.size_bytes), durationSeconds: r.duration_sec == null ? null : n(r.duration_sec),
        owner, ownerName: owner ? names.get(owner) ?? null : null, views30: n(r.views30), thumbUrl: thumbs.get(String(r.id)) ?? null,
        removed: r.removed_at != null ? { at: n(r.removed_at), reason: String(r.removed_reason ?? "") } : null,
      };
    }),
    total: n((total.rows[0] as any).n), limit, offset, filter, sort,
  };
}

export async function getVideoForAdmin(id: string) {
  const v = await store.get(id);
  if (!v || v.status === "uploading") throw new ContentError(404, "not_found", "No video with that id.");
  const owner = ownerOf(v);
  const db = getDb();
  const [play, names, pubs, clips, views] = await Promise.all([
    playbackOf(v),
    owner ? namesOf([owner]).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
    db.execute({ sql: "SELECT id, title, privacy, status, remote_id, created_at FROM publications WHERE video_id = ? ORDER BY created_at DESC", args: [id] }),
    db.execute({ sql: "SELECT COUNT(*) AS n FROM clips WHERE video_id = ?", args: [id] }),
    db.execute({ sql: "SELECT COALESCE(SUM(views), 0) AS v30 FROM video_views WHERE video_id = ? AND day >= ?", args: [id, dayOf(Date.now() - 29 * DAY)] }),
  ]);
  const removedBy = s(((await db.execute({ sql: "SELECT removed_by FROM videos WHERE id = ?", args: [id] })).rows[0] as any)?.removed_by);
  const visible = (v.visibility ?? "unlisted") !== "private" && !v.removed;
  return {
    id: v.id, title: v.title, description: v.description ?? null, status: v.status, visibility: v.visibility ?? "unlisted",
    category: v.category ?? null, createdAt: v.createdAt, sizeBytes: v.meta?.sizeBytes ?? null,
    durationSeconds: v.meta?.durationSeconds ?? v.media?.durationSeconds ?? null,
    owner, ownerName: owner ? names.get(owner) ?? null : null,
    summary: v.ai?.summary ?? null, chapters: (v.ai?.chapters ?? []).map((c: any) => ({ title: String(c.title ?? ""), startSeconds: n(c.startSeconds) })),
    streamUrl: play.streamUrl, source: play.source,
    onShelby: !!v.shelby.accountAddress && !!v.shelby.videoTxHash,
    publicUrl: (v.visibility ?? "unlisted") !== "private" ? `${siteUrl()}/v/${v.id}` : null, visibleToOthers: visible,
    views30: n((views.rows[0] as any).v30), clips: n((clips.rows[0] as any).n),
    youtube: (pubs.rows as any[]).map((p) => ({ id: String(p.id), title: String(p.title), privacy: String(p.privacy), status: String(p.status), remoteId: s(p.remote_id), createdAt: n(p.created_at) })),
    removed: v.removed ? { ...v.removed, by: removedBy } : null,
  };
}

export async function removeVideo(id: string, reason: unknown, adminEmail: string) {
  const v = await store.get(id);
  if (!v || v.status === "uploading") throw new ContentError(404, "not_found", "No video with that id.");
  const why = String(reason ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  if (why.length < 3) throw new ContentError(400, "reason_needed", "Write the reason. The owner sees it.");
  await getDb().execute({ sql: "UPDATE videos SET removed_at = ?, removed_reason = ?, removed_by = ? WHERE id = ?", args: [Date.now(), why, adminEmail, id] });
  return { id, owner: ownerOf(v) };
}
export async function restoreVideo(id: string) {
  const r = await getDb().execute({ sql: "UPDATE videos SET removed_at = NULL, removed_reason = NULL, removed_by = NULL WHERE id = ? AND removed_at IS NOT NULL", args: [id] });
  if (r.rowsAffected === 0) throw new ContentError(409, "not_removed", "That video is not taken down.");
  return { id };
}

export async function listLive(o: { filter?: unknown; limit?: unknown }) {
  const onlyLive = o.filter === "live";
  const limit = Math.min(Math.max(Math.floor(n(o.limit)) || 100, 1), 200);
  const r = await getDb().execute({
    sql: `SELECT e.*, (SELECT COUNT(*) FROM live_chat c WHERE c.event_id = e.id AND c.deleted = 0) AS chat
            FROM live_events e ${onlyLive ? "WHERE e.status = 'live'" : ""}
           ORDER BY CASE e.status WHEN 'live' THEN 0 ELSE 1 END, COALESCE(e.started_at, e.created_at) DESC LIMIT ?`,
    args: [limit],
  });
  const rows = r.rows as any[];
  const names = rows.length ? await namesOf([...new Set(rows.map((x) => String(x.wallet)))]).catch(() => new Map<string, string>()) : new Map<string, string>();
  return {
    events: rows.map((e) => ({
      id: String(e.id), title: String(e.title), status: String(e.status), owner: String(e.wallet), ownerName: names.get(String(e.wallet)) ?? null,
      startedAt: e.started_at == null ? null : n(e.started_at), endedAt: e.ended_at == null ? null : n(e.ended_at), createdAt: n(e.created_at),
      peakViewers: n(e.peak_viewers), chatMessages: n(e.chat), chatMode: String(e.chat_mode ?? "anyone"),
      watchUrl: `${siteUrl()}/live/${e.id}`,
    })),
  };
}
export async function endLiveEvent(id: string) {
  const e = await getEvent(id);
  if (!e) throw new ContentError(404, "not_found", "No live event with that id.");
  if (e.status === "ended") throw new ContentError(409, "already_ended", "That event has already ended.");
  const after = await endEvent(e);
  return { id: after.id, status: after.status, owner: after.wallet };
}

export async function listPublications(o: { limit?: unknown }) {
  const limit = Math.min(Math.max(Math.floor(n(o.limit)) || 100, 1), 200);
  const r = await getDb().execute({
    sql: `SELECT p.id, p.video_id, p.clip_id, p.wallet, p.title, p.privacy, p.status, p.remote_id, p.error, p.created_at
            FROM publications p ORDER BY p.created_at DESC LIMIT ?`,
    args: [limit],
  });
  const rows = r.rows as any[];
  const names = rows.length ? await namesOf([...new Set(rows.map((x) => String(x.wallet)))]).catch(() => new Map<string, string>()) : new Map<string, string>();
  return {
    publications: rows.map((p) => ({
      id: String(p.id), videoId: String(p.video_id), clip: p.clip_id != null, owner: String(p.wallet), ownerName: names.get(String(p.wallet)) ?? null,
      title: String(p.title), privacy: String(p.privacy), status: String(p.status), createdAt: n(p.created_at),
      youtubeUrl: p.remote_id ? `https://www.youtube.com/watch?v=${encodeURIComponent(String(p.remote_id))}` : null,
      error: s(p.error),
    })),
  };
}
