// src/lib/youtube.ts
// vm_youtube: publishing a video or a clip to the owner's YouTube channel.
//
// Checked against Google's documentation on 8 and 9 Oct 2026:
//   * OAuth 2.0 for web server apps: authorization at
//     accounts.google.com/o/oauth2/v2/auth with access_type=offline, token
//     exchange and refresh at oauth2.googleapis.com/token, revoke at
//     oauth2.googleapis.com/revoke
//   * scopes: youtube.upload (sensitive: Google reviews the app before the
//     public may use it; until then only test users listed on the consent
//     screen can connect), plus openid and email to show which account is
//     connected
//   * videos.insert with the resumable upload protocol: a POST starts a
//     session (Location header), the file goes up in PUT chunks that are
//     multiples of 256 KB (308 for each, 201 with the video at the end),
//     an empty PUT with "bytes */TOTAL" asks how much arrived; 500, 502,
//     503 and 504 are retried, 404 means the session expired
//   * 100 uploads a day per Cloud project, shared by all users
//
// Settings: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and the backend's own
// public address in API_PUBLIC_URL (for the redirect address
// <API_PUBLIC_URL>/api/youtube/callback). YOUTUBE_TOKEN_KEY (32 bytes, base64)
// encrypts stored refresh tokens; without it a key is derived from the
// client secret.
import crypto from "crypto";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";

const AUTH_URL = () => process.env.GOOGLE_OAUTH_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = () => process.env.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const REVOKE_URL = () => process.env.GOOGLE_OAUTH_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
export const UPLOAD_URL = () => process.env.YOUTUBE_UPLOAD_URL || "https://www.googleapis.com/upload/youtube/v3/videos";
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/youtube.upload"];

export class YouTubeError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false) { super(message); }
}

export function youtubeConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim(), clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const api = (process.env.API_PUBLIC_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || "").replace(/\/+$/, "");
  if (!clientId || !clientSecret || !api) return null;
  return { clientId, clientSecret, redirectUri: `${api}/api/youtube/callback` };
}
const need = () => {
  const c = youtubeConfig();
  if (!c) throw new YouTubeError(503, "youtube_off", "YouTube publishing is not set up on this server yet.");
  return c;
};

// ── secrets ───────────────────────────────────────────────────────────────────

function tokenKey(): Buffer {
  const raw = process.env.YOUTUBE_TOKEN_KEY?.trim();
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length === 32) return k;
    throw new YouTubeError(500, "bad_key", "YOUTUBE_TOKEN_KEY must be 32 bytes, base64.");
  }
  return Buffer.from(crypto.hkdfSync("sha256", need().clientSecret, "videomind", "youtube refresh tokens", 32));
}
/** AES-256-GCM, stored as v1.<iv>.<tag>.<data> in base64url. */
export function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function unseal(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1") throw new Error("Unknown sealed format");
  const d = crypto.createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

/** The OAuth state carries the wallet and where to return, signed and short lived. */
function stateKey(): Buffer { return Buffer.from(crypto.hkdfSync("sha256", need().clientSecret, "videomind", "youtube oauth state", 32)); }
export function makeState(wallet: string, returnTo: string): string {
  const body = Buffer.from(JSON.stringify({ w: wallet, r: returnTo, e: Date.now() + 10 * 60_000, n: crypto.randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", stateKey()).update(body).digest("base64url")}`;
}
export function readState(state: string): { wallet: string; returnTo: string } | null {
  const [body, sig] = String(state ?? "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", stateKey()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!(j.e > Date.now()) || typeof j.w !== "string") return null;
    return { wallet: j.w, returnTo: typeof j.r === "string" && j.r.startsWith("/") && !j.r.startsWith("//") ? j.r : "/" };
  } catch { return null; }
}

export function authUrl(wallet: string, returnTo: string): string {
  const c = need();
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: c.redirectUri, response_type: "code", scope: SCOPES.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: makeState(wallet, returnTo),
  });
  return `${AUTH_URL()}?${q}`;
}

// ── accounts ──────────────────────────────────────────────────────────────────

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN_URL(), {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (j?.error === "invalid_grant") throw new YouTubeError(401, "reconnect", "The YouTube connection has expired or was removed. Connect YouTube again.");
    throw new YouTubeError(502, "google_error", `Google refused the request (${j?.error ?? res.status}).`, res.status >= 500);
  }
  return j;
}

function emailOf(idToken: unknown): string | null {
  try { const p = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString()); return typeof p.email === "string" ? p.email : null; }
  catch { return null; }
}

/** Finish the OAuth flow: trade the code for tokens and keep the refresh token, encrypted. */
export async function connect(wallet: string, code: string): Promise<{ email: string | null }> {
  const c = need();
  const t = await tokenRequest({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: "authorization_code" });
  if (!String(t.scope ?? "").split(" ").includes("https://www.googleapis.com/auth/youtube.upload")) {
    throw new YouTubeError(400, "scope_missing", "YouTube upload permission was not granted. Connect again and allow uploading videos.");
  }
  if (!t.refresh_token) throw new YouTubeError(400, "no_refresh", "Google did not give a lasting permission. Connect again.");
  const email = emailOf(t.id_token);
  const now = Date.now(), w = normalizeWallet(wallet) ?? wallet;
  await getDb().execute({
    sql: `INSERT INTO youtube_accounts (wallet, email, refresh_token, scope, connected_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(wallet) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, scope = excluded.scope, connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
    args: [w, email, seal(String(t.refresh_token)), String(t.scope ?? ""), now, now],
  });
  return { email };
}

export async function account(wallet: string): Promise<{ email: string | null; connectedAt: number; refresh: string } | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM youtube_accounts WHERE wallet = ?", args: [normalizeWallet(wallet) ?? wallet] });
  const row = r.rows[0] as any;
  if (!row) return null;
  return { email: row.email ? String(row.email) : null, connectedAt: Number(row.connected_at), refresh: String(row.refresh_token) };
}

export async function disconnect(wallet: string): Promise<void> {
  const a = await account(wallet);
  if (!a) return;
  try {
    await fetch(REVOKE_URL(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: unseal(a.refresh) }), signal: AbortSignal.timeout(10_000) });
  } catch { /* forgotten here even if Google could not be told */ }
  await getDb().execute({ sql: "DELETE FROM youtube_accounts WHERE wallet = ?", args: [normalizeWallet(wallet) ?? wallet] });
}

/** A fresh access token for this wallet's account. */
export async function accessToken(wallet: string): Promise<string> {
  const c = need();
  const a = await account(wallet);
  if (!a) throw new YouTubeError(401, "not_connected", "Connect YouTube first.");
  try {
    const t = await tokenRequest({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: unseal(a.refresh), grant_type: "refresh_token" });
    return String(t.access_token);
  } catch (err) {
    if (err instanceof YouTubeError && err.code === "reconnect") {
      await getDb().execute({ sql: "DELETE FROM youtube_accounts WHERE wallet = ?", args: [normalizeWallet(wallet) ?? wallet] });
    }
    throw err;
  }
}

// ── what is sent ──────────────────────────────────────────────────────────────

export type Privacy = "private" | "unlisted" | "public";
export interface PublishDetails { title: string; description: string; tags: string[]; privacy: Privacy; madeForKids: boolean; categoryId: string }

/** YouTube refuses < and > in titles and descriptions. */
const clean = (s: string) => s.replace(/[<>]/g, "");

export function parseDetails(body: unknown): PublishDetails {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = clean(String(b.title ?? "")).replace(/\s+/g, " ").trim();
  if (!title) throw new YouTubeError(400, "bad_title", "Give the video a title.");
  if (title.length > 100) throw new YouTubeError(400, "title_too_long", "YouTube titles can be up to 100 characters.");
  const description = clean(String(b.description ?? "")).trim();
  if (Buffer.byteLength(description) > 5000) throw new YouTubeError(400, "description_too_long", "YouTube descriptions can be up to 5,000 bytes.");
  const privacy = b.privacy as Privacy;
  if (!["private", "unlisted", "public"].includes(privacy)) throw new YouTubeError(400, "bad_privacy", "Choose private, unlisted or public.");
  const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => clean(String(t)).trim()).filter(Boolean).slice(0, 30);
  if (tags.join(",").length > 500) throw new YouTubeError(400, "tags_too_long", "Tags can be up to 500 characters together.");
  return { title, description, tags, privacy, madeForKids: b.madeForKids === true, categoryId: "27" };
}

const clock = (sec: number) => {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/**
 * A suggested description: the summary, the chapters as YouTube reads
 * them (the first at 0:00, at least three, each at least 10 seconds), and
 * the link to the video on VideoMind when it is not private.
 */
export function suggestDescription(v: { summary?: string | null; chapters?: Array<{ title: string; startSeconds: number }>; durationSeconds?: number | null; link?: string | null }): string {
  const parts: string[] = [];
  if (v.summary) parts.push(clean(v.summary).trim());
  const ch = (v.chapters ?? []).slice().sort((a, b) => a.startSeconds - b.startSeconds);
  const end = v.durationSeconds ?? Infinity;
  const okChapters = ch.length >= 3 && Math.floor(ch[0].startSeconds) === 0
    && ch.every((c, i) => ((ch[i + 1]?.startSeconds ?? end) - c.startSeconds) >= 10);
  if (okChapters) parts.push(["Chapters", ...ch.map((c) => `${clock(c.startSeconds)} ${clean(c.title)}`)].join("\n"));
  if (v.link) parts.push(`Transcript, chapters and questions: ${v.link}`);
  let text = parts.join("\n\n");
  while (Buffer.byteLength(text) > 5000) text = text.slice(0, -100);
  return text;
}

// ── publications ──────────────────────────────────────────────────────────────

export type PubStatus = "queued" | "uploading" | "done" | "failed";
export interface Publication {
  id: string; videoId: string; clipId: string | null; wallet: string; platform: string; title: string; privacy: Privacy;
  details: PublishDetails | null; status: PubStatus; sessionUrl: string | null; sentBytes: number; totalBytes: number | null;
  remoteId: string | null; error: string | null; createdAt: number; updatedAt: number;
}
function rowToPub(r: Record<string, unknown>): Publication {
  let details: PublishDetails | null = null;
  try { details = r.details ? JSON.parse(String(r.details)) : null; } catch {}
  return {
    id: String(r.id), videoId: String(r.video_id), clipId: r.clip_id ? String(r.clip_id) : null, wallet: String(r.wallet), platform: String(r.platform),
    title: String(r.title), privacy: String(r.privacy) as Privacy, details, status: String(r.status) as PubStatus,
    sessionUrl: r.session_url ? String(r.session_url) : null, sentBytes: Number(r.sent_bytes ?? 0), totalBytes: r.total_bytes == null ? null : Number(r.total_bytes),
    remoteId: r.remote_id ? String(r.remote_id) : null, error: r.error ? String(r.error) : null, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
export async function addPublication(p: { videoId: string; clipId: string | null; wallet: string; details: PublishDetails }): Promise<Publication> {
  const id = crypto.randomUUID(), now = Date.now();
  await getDb().execute({
    sql: `INSERT INTO publications (id, video_id, clip_id, wallet, platform, title, privacy, details, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'youtube', ?, ?, ?, 'queued', ?, ?)`,
    args: [id, p.videoId, p.clipId, normalizeWallet(p.wallet) ?? p.wallet, p.details.title, p.details.privacy, JSON.stringify(p.details), now, now],
  });
  return (await getPublication(id))!;
}
export async function getPublication(id: string): Promise<Publication | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM publications WHERE id = ?", args: [id] });
  return r.rows[0] ? rowToPub(r.rows[0] as Record<string, unknown>) : null;
}
export async function publicationsOf(videoId: string): Promise<Publication[]> {
  const r = await getDb().execute({ sql: "SELECT * FROM publications WHERE video_id = ? ORDER BY created_at DESC, rowid DESC", args: [videoId] });
  return r.rows.map((x) => rowToPub(x as Record<string, unknown>));
}
export async function uploadsToday(wallet: string): Promise<number> {
  const r = await getDb().execute({ sql: "SELECT COUNT(*) AS n FROM publications WHERE wallet = ? AND created_at >= ?", args: [normalizeWallet(wallet) ?? wallet, Date.now() - 86_400_000] });
  return Number((r.rows[0] as any).n);
}
export async function updatePublication(id: string, patch: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(patch);
  await getDb().execute({ sql: `UPDATE publications SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, args: [...keys.map((k) => patch[k] as any), Date.now(), id] });
}
export async function deletePublicationsForVideo(videoId: string): Promise<void> {
  await getDb().execute({ sql: "DELETE FROM publications WHERE video_id = ?", args: [videoId] });
}

// ── the resumable upload ──────────────────────────────────────────────────────

/** 8 MB: a multiple of 256 KB, as the protocol requires. */
export const CHUNK = 32 * 256 * 1024;

/** Read bytes [start, end] of the file being sent. */
export type ReadRange = (start: number, end: number) => Promise<Buffer>;

function googleError(status: number, text: string): YouTubeError {
  let reason = "", message = "";
  try { const j = JSON.parse(text); reason = j?.error?.errors?.[0]?.reason ?? j?.error?.status ?? ""; message = j?.error?.message ?? ""; } catch {}
  if (status === 401) return new YouTubeError(401, "reconnect", "YouTube did not accept the connection. Connect YouTube again.");
  if (reason === "quotaExceeded" || reason === "rateLimitExceeded") return new YouTubeError(429, "quota", "VideoMind has used its YouTube uploads for today. Try again tomorrow.");
  if (reason === "uploadLimitExceeded") return new YouTubeError(429, "channel_limit", "Your YouTube channel has reached its upload limit for now. Try again later.");
  if (reason === "youtubeSignupRequired") return new YouTubeError(400, "no_channel", "This Google account has no YouTube channel yet. Create one on YouTube, then try again.");
  if ([500, 502, 503, 504].includes(status)) return new YouTubeError(502, "youtube_busy", "YouTube did not answer. It will be tried again.", true);
  return new YouTubeError(400, "youtube_refused", `YouTube refused the upload${message ? `: ${message.slice(0, 200)}` : ` (${status})`}.`);
}

/** Start a session. Returns the session address. */
export async function startSession(token: string, d: PublishDetails, size: number, type: string): Promise<string> {
  const res = await fetch(`${UPLOAD_URL()}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(size), "x-upload-content-type": type || "video/*",
    },
    body: JSON.stringify({
      snippet: { title: d.title, description: d.description, tags: d.tags, categoryId: d.categoryId },
      status: { privacyStatus: d.privacy, selfDeclaredMadeForKids: d.madeForKids, embeddable: true, license: "youtube" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 200 || !res.headers.get("location")) throw googleError(res.status, await res.text().catch(() => ""));
  return res.headers.get("location")!;
}

/** How many bytes the session has. null means the upload already finished (the video is returned). */
async function received(session: string, token: string, size: number): Promise<{ next: number } | { video: any }> {
  const res = await fetch(session, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-length": "0", "content-range": `bytes */${size}` }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 200 || res.status === 201) return { video: await res.json() };
  if (res.status === 308) {
    const r = res.headers.get("range");
    const m = r ? /bytes=0-(\d+)/.exec(r) : null;
    return { next: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.status === 404) throw new YouTubeError(410, "session_expired", "The upload session expired.", true);
  throw googleError(res.status, await res.text().catch(() => ""));
}

/**
 * Send the file in chunks from `from`, asking where to continue after a
 * failure. onProgress records how far it got, so a restarted job resumes.
 */
export async function sendFile(args: {
  session: string; token: () => Promise<string>; size: number; type: string; read: ReadRange;
  from?: number; onProgress?: (sent: number) => Promise<void>; tries?: number;
}): Promise<any> {
  let token = await args.token();
  let at = args.from ?? 0;
  if (at > 0) {
    const r = await received(args.session, token, args.size);
    if ("video" in r) return r.video;
    at = r.next;
  }
  let failures = 0;
  while (true) {
    const end = Math.min(at + CHUNK, args.size) - 1;
    try {
      const body = await args.read(at, end);
      const res = await fetch(args.session, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": args.type || "video/*", "content-length": String(body.length), "content-range": `bytes ${at}-${end}/${args.size}` },
        body: new Uint8Array(body), signal: AbortSignal.timeout(10 * 60_000),
      });
      if (res.status === 200 || res.status === 201) { await args.onProgress?.(args.size); return await res.json(); }
      if (res.status === 308) {
        const r = res.headers.get("range"); const m = r ? /bytes=0-(\d+)/.exec(r) : null;
        at = m ? Number(m[1]) + 1 : 0; failures = 0;
        await args.onProgress?.(at);
        continue;
      }
      if (res.status === 404) throw new YouTubeError(410, "session_expired", "The upload session expired.", true);
      if (res.status === 401) { token = await args.token(); throw new YouTubeError(502, "token_refresh", "Access renewed.", true); }
      throw googleError(res.status, await res.text().catch(() => ""));
    } catch (err: any) {
      const retry = err instanceof YouTubeError ? err.retryable && err.code !== "session_expired" : true;   // a dropped connection is retried
      if (!retry || ++failures > (args.tries ?? 5)) throw err;
      await new Promise((r) => setTimeout(r, Math.min(30_000, (Number(process.env.YOUTUBE_RETRY_BASE_MS) || 1000) * 2 ** failures)));
      const r = await received(args.session, token, args.size);
      if ("video" in r) return r.video;
      at = r.next;
    }
  }
}
