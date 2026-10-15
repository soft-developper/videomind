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

/** Take a one time token out of the address bar, so it is not kept in history or shown on screen. */
let taken: string | null = null;
export function takeToken(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const t = url.searchParams.get("token");
  if (t) { taken = t; url.searchParams.delete("token"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); }
  return taken;
}
