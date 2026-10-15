// vm_admin: calls to the API's /api/admin routes. The session lives in an
// httpOnly cookie set by the API, so nothing here can read or keep it.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}/api/admin${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Cannot reach the VideoMind server. It may be waking up; try again in a minute.", 0, "offline");
  }
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data?.error ?? `The server answered ${r.status}.`, r.status, data?.code);
  return data as T;
}

export interface AdminInfo { id: string; email: string; createdAt: number; lastSignInAt: number | null; recoveryCodesLeft: number }
export interface Status { setUp: boolean; ready: boolean; missing?: string[] }

export const getStatus = () => call<Status>("GET", "/status");
export const sendSetupLink = () => call<{ sent: boolean }>("POST", "/setup/send", {});
export const setupStart = (token: string) => call<{ email: string; secret: string; uri: string }>("POST", "/setup/start", { token });
export const setupComplete = (token: string, password: string, code: string) =>
  call<{ admin: AdminInfo; recoveryCodes: string[] }>("POST", "/setup/complete", { token, password, code });
export const login = (email: string, password: string) => call<{ next: "code" }>("POST", "/login", { email, password });
export const loginCode = (code: string) => call<{ admin: AdminInfo; usedRecoveryCode: boolean }>("POST", "/login/code", { code });
export const forgot = (email: string) => call<{ message: string }>("POST", "/forgot", { email });
export const resetCheck = (token: string) => call<{ email: string }>("POST", "/reset/check", { token });
export const resetPassword = (token: string, password: string, code: string) => call<{ reset: boolean }>("POST", "/reset", { token, password, code });
export const getMe = () => call<{ admin: AdminInfo; sessionEndsAt: number }>("GET", "/me");
export const logout = () => call<{ signedOut: boolean }>("POST", "/logout", {});

export interface Overview {
  at: number; monthStart: number;
  users: { total: number; new7: number; new30: number; active7: number; active30: number; signedInNow: number };
  videos: { total: number; new7: number; new30: number; ready: number; failed: number; working: number };
  storage: { bytes: number };
  usageThisMonth: { transcribedSeconds: number; inputTokens: number; outputTokens: number; bytesUploaded: number };
  views: { last7: number; last30: number; watchSeconds30: number };
  live: { total: number; liveNow: number; new30: number };
  jobs: { failed: number; queued: number; running: number };
  youtube: { published30: number; failed30: number };
  health: Array<{ name: string; ok: boolean; optional?: boolean; note: string }>;
  adminActivity: Array<{ id: number; at: number; email: string | null; action: string; target: string | null; detail: Record<string, unknown> | null }>;
}
export const getOverview = () => call<Overview>("GET", "/overview");

// ── vm_admin_users ───────────────────────────────────────────────────────────
export interface AdminUser {
  wallet: string; name: string | null; joinedAt: number | null; lastSignInAt: number | null;
  videos: number; storageBytes: number; openSessions: number;
  suspended: boolean; suspendedAt: number | null; suspendedReason: string | null; dataDeleted: boolean;
}
export type UserSort = "joined" | "active" | "videos" | "storage";
export interface UserList { users: AdminUser[]; total: number; limit: number; offset: number }
export interface UsageNumbers { transcribedSeconds: number; inputTokens: number; outputTokens: number; bytesUploaded: number }
export interface UserDetail {
  user: AdminUser;
  videos: Array<{ id: string; title: string; status: string; visibility: string; createdAt: number; sizeBytes: number | null; durationSeconds: number | null; onShelby: boolean }>;
  counts: { collections: number; notes: number; liveEvents: number; clips: number; views30: number };
  youtubeConnected: boolean;
  usage: { allTime: UsageNumbers; thisMonth: UsageNumbers };
}
export function getUsers(o: { q?: string; filter?: "all" | "suspended"; sort?: UserSort; offset?: number; limit?: number }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  return call<UserList>("GET", `/users?${p}`);
}
const W = (w: string) => `/users/${encodeURIComponent(w)}`;
export const getUser = (wallet: string) => call<UserDetail>("GET", W(wallet));
export const signOutUser = (wallet: string) => call<{ ended: number }>("POST", `${W(wallet)}/sign-out`, {});
export const suspendUser = (wallet: string, reason: string) => call<{ ended: number }>("POST", `${W(wallet)}/suspend`, { reason });
export const unsuspendUser = (wallet: string) => call<{ wallet: string }>("POST", `${W(wallet)}/unsuspend`, {});
export const deleteUserData = (wallet: string, confirm: string) => call<{ deleted: Record<string, number> }>("POST", `${W(wallet)}/delete`, { confirm });

/** Take a one time token out of the address bar, so it is not kept in history or shown on screen. */
let taken: string | null = null;
export function takeToken(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const t = url.searchParams.get("token");
  if (t) { taken = t; url.searchParams.delete("token"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); }
  return taken;
}

// ── vm_content ───────────────────────────────────────────────────────────────
export const apiUrl = (path: string) => (path.startsWith("/") ? `${BASE}${path}` : path);
export type VideoFilter = "all" | "public" | "unlisted" | "private" | "removed";
export type VideoSort = "newest" | "views" | "size";
export interface Removal { at: number; reason: string; by?: string | null }
export interface AdminVideo {
  id: string; title: string; status: string; visibility: string; createdAt: number; sizeBytes: number; durationSeconds: number | null;
  owner: string | null; ownerName: string | null; views30: number; thumbUrl: string | null; removed: Removal | null;
}
export interface AdminVideoDetail {
  id: string; title: string; description: string | null; status: string; visibility: string; category: string | null; createdAt: number;
  sizeBytes: number | null; durationSeconds: number | null; owner: string | null; ownerName: string | null;
  summary: string | null; chapters: Array<{ title: string; startSeconds: number }>;
  streamUrl: string | null; source: "storage" | "shelby" | null; onShelby: boolean; publicUrl: string | null; visibleToOthers: boolean;
  views30: number; clips: number; youtube: Array<{ id: string; title: string; privacy: string; status: string; remoteId: string | null; createdAt: number }>;
  removed: Removal | null;
}
export interface AdminLive {
  id: string; title: string; status: string; owner: string; ownerName: string | null; startedAt: number | null; endedAt: number | null; createdAt: number;
  peakViewers: number; chatMessages: number; chatMode: string; watchUrl: string;
}
export interface AdminPublication { id: string; videoId: string; clip: boolean; owner: string; ownerName: string | null; title: string; privacy: string; status: string; createdAt: number; youtubeUrl: string | null; error: string | null }
export function getContentVideos(o: { q?: string; filter?: VideoFilter; sort?: VideoSort; offset?: number; limit?: number }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  return call<{ videos: AdminVideo[]; total: number }>("GET", `/content/videos?${p}`);
}
export const getContentVideo = (id: string) => call<AdminVideoDetail>("GET", `/content/videos/${encodeURIComponent(id)}`);
export const removeVideo = (id: string, reason: string) => call<{ id: string }>("POST", `/content/videos/${encodeURIComponent(id)}/remove`, { reason });
export const restoreVideo = (id: string) => call<{ id: string }>("POST", `/content/videos/${encodeURIComponent(id)}/restore`, {});
export const getContentLive = (filter: "live" | "all") => call<{ events: AdminLive[] }>("GET", `/content/live?filter=${filter}`);
export const endLive = (id: string) => call<{ id: string }>("POST", `/content/live/${encodeURIComponent(id)}/end`, {});
export const getContentYouTube = () => call<{ publications: AdminPublication[] }>("GET", "/content/youtube");
