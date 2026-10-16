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

// ── vm_ops ───────────────────────────────────────────────────────────────────
export type JobFilter = "failed" | "queued" | "running" | "all";
export interface AdminJob { id: string; videoId: string; title: string | null; owner: string | null; ownerName: string | null; kind: string; label: string; status: string; attempts: number; maxAttempts: number; error: string | null; errorCode: string | null; retryable: boolean; createdAt: number; updatedAt: number }
export interface AdminUpload { videoId: string; title: string | null; filename: string | null; sizeBytes: number; owner: string | null; ownerName: string | null; createdAt: number; updatedAt: number }
export interface AdminAnchor { id: string; videoId: string; title: string | null; owner: string | null; ownerName: string | null; network: string; objectName: string; state: string; sizeBytes: number | null; paidUntil: number | null; checkedAt: number | null; error: string | null; updatedAt: number }
export interface SecurityInfo {
  suspended: Array<{ wallet: string; reason: string; at: number; by: string | null }>;
  walletSessions: { open: number; wallets: number };
  adminSessions: Array<{ id: string; email: string; createdAt: number; lastSeenAt: number; endsAt: number; current: boolean }>;
  adminSignIns: Array<{ at: number; email: string | null; action: string; detail: Record<string, unknown> | null }>;
  memory: { limitHits: number; refusedCount: number; since: number;
    limits: Array<{ family: string; caller: string; count: number; first: number; last: number }>;
    refusedSignIns: Array<{ at: number; wallet: string | null; reason: string }> };
}
export const getJobs = (filter: JobFilter) => call<{ counts: Record<string, number>; jobs: AdminJob[] }>("GET", `/ops/jobs?filter=${filter}`);
export const retryJob = (id: string) => call<{ id: string }>("POST", `/ops/jobs/${encodeURIComponent(id)}/retry`, {});
export const getUploads = () => call<{ uploads: AdminUpload[] }>("GET", "/ops/uploads");
export const discardUpload = (videoId: string) => call<{ videoId: string }>("POST", `/ops/uploads/${encodeURIComponent(videoId)}/discard`, {});
export const getAnchors = (state: string) => call<{ counts: Record<string, number>; anchors: AdminAnchor[] }>("GET", `/ops/anchors?state=${state}`);
export const checkAnchor = (id: string) => call<{ id: string; state: string }>("POST", `/ops/anchors/${encodeURIComponent(id)}/check`, {});
export const runHousekeeping = () => call<{ videosCleaned: number; uploadsDiscarded: number }>("POST", "/ops/housekeeping", {});
export const getSecurity = () => call<SecurityInfo>("GET", "/security");
export const endOtherSessions = () => call<{ ended: number }>("POST", "/security/end-other-sessions", {});

// ── vm_insights ──────────────────────────────────────────────────────────────
export type InsightMetric = "views" | "watch_minutes" | "new_wallets" | "uploads" | "transcribed_minutes" | "ai_tokens" | "live_events";
export type InsightRange = 7 | 28 | 90 | 365;
export interface InsightSeries {
  metric: InsightMetric; days: InsightRange; points: Array<{ day: string; value: number }>; total: number; previous: number;
  features: Array<{ feature: string; audioMinutes: number; tokens: number }>;
}
export interface TopVideo { id: string; title: string; views: number; watchMinutes: number; owner: string | null; ownerName: string | null; visibility: string; removed: boolean; thumbUrl: string | null }
export interface AuditEntry { id: number; at: number; email: string | null; action: string; target: string | null; detail: unknown }
export interface AuditPage { entries: AuditEntry[]; next: number | null; actions: Array<{ action: string; count: number }>; admins: string[] }
export const getInsights = (metric: InsightMetric, days: InsightRange) => call<InsightSeries>("GET", `/insights?metric=${metric}&days=${days}`);
export const getTopVideos = (days: InsightRange) => call<{ days: number; videos: TopVideo[] }>("GET", `/insights/top-videos?days=${days}`);
export function getAudit(o: { action?: string; email?: string; q?: string; before?: number | null }) {
  const p = new URLSearchParams();
  if (o.action) p.set("action", o.action); if (o.email) p.set("email", o.email); if (o.q) p.set("q", o.q); if (o.before) p.set("before", String(o.before));
  p.set("limit", "50");
  return call<AuditPage>("GET", `/audit?${p.toString()}`);
}

// ── vm_costs ─────────────────────────────────────────────────────────────────
export interface Price {
  id: string; provider: string; model: string; metric: string; unit: "minute" | "million_tokens" | "gb_month";
  usd: number; longPromptTokens: number | null; longUsd: number | null; freePerMonth: number;
  source: string | null; checkedOn: string | null; updatedAt: number; updatedBy: string | null;
}
export interface FixedCost { id: string; name: string; usdPerMonth: number; note: string | null; createdAt: number }
export interface CostLine { provider: string; model: string; metric: string; unit: string; quantity: number; usd: number; priced: boolean; priceId: string | null }
export interface CostReport {
  month: string; start: number; end: number; days: number; elapsedShare: number;
  totals: { usageUsd: number; fixedUsd: number; totalUsd: number };
  lines: CostLine[]; byFeature: Array<{ feature: string; usd: number }>;
  topWallets: Array<{ wallet: string; name: string | null; usd: number }>;
  storage: { gbMonths: number; freeGbMonths: number };
  unpriced: Array<{ provider: string; model: string; metric: string; quantity: number }>;
  fixed: FixedCost[]; months: string[]; prices: Price[];
}
export const getCosts = (month?: string) => call<CostReport>("GET", `/costs${month ? `?month=${encodeURIComponent(month)}` : ""}`);
export const updatePrice = (id: string, change: { usd?: number; longUsd?: number | null; freePerMonth?: number }) => call<Price>("POST", `/costs/prices/${encodeURIComponent(id)}`, change);
export const addFixedCost = (name: string, usdPerMonth: number, note: string) => call<FixedCost>("POST", "/costs/fixed", { name, usdPerMonth, note });
export const removeFixedCost = (id: string) => call<{ ok: boolean }>("POST", `/costs/fixed/${encodeURIComponent(id)}/delete`, {});

// ── vm_admin_settings ────────────────────────────────────────────────────────
export interface AdminRow { id: string; email: string; createdAt: number; lastSignInAt: number | null; recoveryCodesLeft: number; lockedUntil: number | null; you: boolean; founder: boolean }
export interface InviteRow { email: string; sentAt: number; expiresAt: number; by: string | null }
export interface Limits {
  rates: Array<{ name: string; label: string; perCaller: { max: number; per: string }; everyone: { max: number; per: string } }>;
  caps: Array<{ label: string; value: string; setting: string }>;
  dashboard: Array<{ label: string; value: string }>;
}
export const getAdmins = () => call<{ admins: AdminRow[]; invites: InviteRow[] }>("GET", "/settings/admins");
export const inviteAdmin = (email: string, code: string) => call<{ email: string; expiresAt: number }>("POST", "/settings/invites", { email, code });
export const cancelInvite = (email: string) => call<{ cancelled: boolean }>("POST", "/settings/invites/cancel", { email });
export const removeAdmin = (id: string, code: string) => call<{ email: string }>("POST", `/settings/admins/${encodeURIComponent(id)}/remove`, { code });
export const changePassword = (current: string, password: string) => call<{ changed: boolean }>("POST", "/settings/password", { current, password });
export const startAuthenticator = () => call<{ secret: string; uri: string; expiresAt: number }>("POST", "/settings/authenticator/start", {});
export const finishAuthenticator = (password: string, code: string) => call<{ changed: boolean }>("POST", "/settings/authenticator/finish", { password, code });
export const renewRecoveryCodes = (password: string) => call<{ recoveryCodes: string[] }>("POST", "/settings/recovery-codes", { password });
export const getLimits = () => call<Limits>("GET", "/settings/limits");
export const inviteStart = (token: string) => call<{ email: string; secret: string; uri: string; by: string | null }>("POST", "/invite/start", { token });
export const inviteComplete = (token: string, password: string, code: string) =>
  call<{ admin: AdminInfo; recoveryCodes: string[] }>("POST", "/invite/complete", { token, password, code });
