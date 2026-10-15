// src/lib/admin.ts
// vm_admin: the admin dashboard's accounts (dashboard.vidzmind.xyz).
//
// Admins sign in with email and password, then a code from an authenticator
// app (required). Built from the OWASP Password Storage and Authentication
// cheat sheets:
//   * passwords: scrypt N=2^15, r=8, p=3 (about 32 MiB, an OWASP equivalent
//     setting), 16 byte salt, compared in constant time;
//   * at least 15 characters, up to 256, any characters, never truncated;
//   * one answer for every failed sign in; failures counted per account and
//     the account locked for LOCK_MINUTES after MAX_FAILS (with an email);
//   * two step codes: TOTP (RFC 6238, SHA1, 30 s, 6 digits, one step either
//     side), a code never accepted twice; 10 one time recovery codes, hashed.
// Nobody can sign up: the first account is made from a link emailed only to
// ADMIN_EMAIL, while no admin exists. ADMIN_KEY (any long random text)
// encrypts the authenticator secrets in the database.
import crypto from "crypto";
import { promisify } from "util";
import { getDb } from "./db.js";
import { sendMail, mailConfigured } from "./mail.js";

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 1 << 15, r: 8, p: 3, maxmem: 96 * 1024 * 1024 };
export const MIN_PASSWORD = 15;
export const MAX_PASSWORD = 256;
export const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60_000;
export const LOCK_MINUTES = 15;
export const MFA_MS = 5 * 60_000;           // between the password and the code
export const IDLE_MS = 2 * 3600_000;        // a session ends after 2 hours without use
export const ABSOLUTE_MS = 12 * 3600_000;   // and after 12 hours in any case
const SETUP_MS = 60 * 60_000;
const RESET_MS = 30 * 60_000;
const RECOVERY_COUNT = 10;

export class AdminError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
/** The one answer for a failed sign in, whatever the reason (OWASP). */
export const SIGN_IN_FAILED = new AdminError(401, "sign_in_failed", "Email or password is incorrect.");
const CODE_FAILED = () => new AdminError(401, "code_failed", "That code is not right. Try the current code from your authenticator app.");

// ── settings ────────────────────────────────────────────────────────────────

export const adminEmail = () => (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase() || null;
export const dashboardUrl = () => (process.env.DASHBOARD_URL ?? "https://dashboard.vidzmind.xyz").trim().replace(/\/+$/, "");
export const adminKeySet = () => (process.env.ADMIN_KEY ?? "").trim().length >= 32;
export function adminReady(): { ok: boolean; missing: string[] } {
  const missing = [
    ...(adminEmail() ? [] : ["ADMIN_EMAIL"]),
    ...(adminKeySet() ? [] : ["ADMIN_KEY"]),
    ...(mailConfigured() ? [] : ["RESEND_API_KEY", "MAIL_FROM"].filter((k) => !process.env[k]?.trim())),
  ];
  return { ok: missing.length === 0, missing };
}

function key(): Buffer {
  const raw = (process.env.ADMIN_KEY ?? "").trim();
  if (raw.length < 32) throw new AdminError(500, "no_admin_key", "ADMIN_KEY is not set on the server (any random text of 32 characters or more).");
  return Buffer.from(crypto.hkdfSync("sha256", raw, "videomind", "admin authenticator secrets", 32));
}
function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return ["a1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function unseal(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "a1") throw new Error("Unknown sealed format");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");
const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();

// ── passwords ───────────────────────────────────────────────────────────────

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw.normalize("NFKC"), salt, 32, SCRYPT);
  return ["s1", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), h.toString("base64url")].join("$");
}
export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [v, N, r, p, salt, h] = stored.split("$");
  if (v !== "s1") return false;
  const want = Buffer.from(h, "base64url");
  const got = await scrypt(pw.normalize("NFKC"), Buffer.from(salt, "base64url"), want.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
// For unknown emails: the same work as a real check, so timing does not tell.
let dummy: string | null = null;
async function burn(pw: string) { dummy ??= await hashPassword("not a real password, only for timing"); await checkPassword(pw, dummy); }

/** What is wrong with a new password, or null. Length only, as OWASP advises. */
export function passwordProblem(pw: unknown, email: string): string | null {
  if (typeof pw !== "string") return "Enter a password.";
  const n = [...pw].length;
  if (n < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters. A few words with spaces is easy to remember.`;
  if (n > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  if (pw.trim().toLowerCase() === email) return "Do not use your email address as the password.";
  if (new Set([...pw]).size < 4) return "That password repeats too few characters. Choose something less predictable.";
  return null;
}

// ── two step codes (TOTP, RFC 6238) ─────────────────────────────────────────

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totpAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
export const stepNow = (now = Date.now()) => Math.floor(now / 30_000);
/** The step the code belongs to (now, or one either side), if it is newer than `after`. */
function matchTotp(secret: string, code: string, after: number, now = Date.now()): number | null {
  const s = stepNow(now);
  for (const st of [s - 1, s, s + 1]) {
    if (st <= after) continue;
    const want = Buffer.from(totpAt(secret, st)), got = Buffer.from(code);
    if (want.length === got.length && crypto.timingSafeEqual(want, got)) return st;
  }
  return null;
}
export const otpauthUri = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent("VideoMind Admin")}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent("VideoMind Admin")}&algorithm=SHA1&digits=6&period=30`;

// Recovery codes: 10 characters from an alphabet without look alikes, shown as two groups of five.
const RC = "abcdefghjkmnpqrstuvwxyz23456789";
const rcNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function newRecoveryCodes(): { shown: string[]; hashes: string[] } {
  const shown: string[] = [];
  for (let i = 0; i < RECOVERY_COUNT; i++) {
    let c = ""; for (const b of crypto.randomBytes(10)) c += RC[b % RC.length];
    shown.push(`${c.slice(0, 5)} ${c.slice(5)}`);
  }
  return { shown, hashes: shown.map((c) => sha(rcNorm(c))) };
}

// ── records ─────────────────────────────────────────────────────────────────

export interface Admin {
  id: string; email: string; passwordHash: string; totpSecret: string; totpLastStep: number; recovery: string[];
  failedCount: number; firstFailedAt: number | null; lockedUntil: number | null; createdAt: number; lastSignInAt: number | null;
}
function rowToAdmin(r: any): Admin {
  return {
    id: String(r.id), email: String(r.email), passwordHash: String(r.password_hash), totpSecret: String(r.totp_secret),
    totpLastStep: Number(r.totp_last_step ?? 0), recovery: JSON.parse(String(r.recovery_hashes ?? "[]")),
    failedCount: Number(r.failed_count ?? 0), firstFailedAt: r.first_failed_at == null ? null : Number(r.first_failed_at),
    lockedUntil: r.locked_until == null ? null : Number(r.locked_until), createdAt: Number(r.created_at),
    lastSignInAt: r.last_sign_in_at == null ? null : Number(r.last_sign_in_at),
  };
}
export async function adminCount(): Promise<number> {
  return Number(((await getDb().execute("SELECT COUNT(*) AS n FROM admin_users")).rows[0] as any).n);
}
async function adminByEmail(email: string): Promise<Admin | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM admin_users WHERE email = ?", args: [email] });
  return r.rows[0] ? rowToAdmin(r.rows[0]) : null;
}
export async function adminById(id: string): Promise<Admin | null> {
  const r = await getDb().execute({ sql: "SELECT * FROM admin_users WHERE id = ?", args: [id] });
  return r.rows[0] ? rowToAdmin(r.rows[0]) : null;
}

export async function audit(admin: { id: string; email: string } | null, action: string, target: string | null = null, detail: Record<string, unknown> | null = null) {
  await getDb().execute({
    sql: "INSERT INTO admin_audit (at, admin_id, email, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)",
    args: [Date.now(), admin?.id ?? null, admin?.email ?? null, action, target, detail ? JSON.stringify(detail) : null],
  }).catch((err) => console.error(`[admin] audit not written: ${err?.message ?? err}`));
}
export async function recentAudit(limit = 20) {
  const r = await getDb().execute({ sql: "SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?", args: [limit] });
  return (r.rows as any[]).map((x) => ({ id: Number(x.id), at: Number(x.at), email: x.email ? String(x.email) : null, action: String(x.action), target: x.target ? String(x.target) : null, detail: x.detail ? JSON.parse(String(x.detail)) : null }));
}

async function notify(to: string, subject: string, lines: string[], button?: { label: string; url: string }) {
  try { await sendMail({ to, subject, lines, button, after: ["This email was sent by the VideoMind admin dashboard."] }); }
  catch (err: any) { console.error(`[admin] notice "${subject}" not sent: ${err?.message ?? err}`); }
}

// ── links by email (setup and reset) ────────────────────────────────────────

type TokenKind = "setup" | "reset";
async function issueToken(kind: TokenKind, email: string, adminId: string | null, ttl: number): Promise<string> {
  const t = newToken(), now = Date.now();
  await getDb().batch([
    // A new link replaces any older unused one of the same kind.
    { sql: "UPDATE admin_tokens SET used_at = ? WHERE kind = ? AND email = ? AND used_at IS NULL", args: [now, kind, email] },
    { sql: "INSERT INTO admin_tokens (token_hash, kind, email, admin_id, data, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)", args: [sha(t), kind, email, adminId, now + ttl, now] },
  ], "write");
  return t;
}
async function tokenRow(kind: TokenKind, token: unknown) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const r = await getDb().execute({ sql: "SELECT * FROM admin_tokens WHERE token_hash = ? AND kind = ?", args: [sha(token), kind] });
  const row = r.rows[0] as any;
  if (!row || row.used_at != null || Number(row.expires_at) < Date.now()) return null;
  return row;
}
const LINK_GONE = () => new AdminError(410, "link_expired", "This link has expired or was already used. Ask for a new one.");

/** Email the setup link to ADMIN_EMAIL, while there is no admin yet. */
export async function sendSetupLink(): Promise<void> {
  if ((await adminCount()) > 0) throw new AdminError(409, "already_set_up", "The dashboard is already set up. Sign in instead.");
  const ready = adminReady();
  if (!ready.ok) throw new AdminError(503, "not_configured", `The server is missing: ${ready.missing.join(", ")}.`);
  const email = adminEmail()!;
  const t = await issueToken("setup", email, null, SETUP_MS);
  await sendMail({
    to: email, subject: "Set up the VideoMind dashboard",
    lines: ["Someone asked to set up the VideoMind admin dashboard with this email address.", "The link works once and expires in 1 hour."],
    button: { label: "Set up the dashboard", url: `${dashboardUrl()}/setup?token=${t}` },
    after: ["If you did not ask for this, you can ignore this email. Nothing changes until the link is used."],
  });
  await audit(null, "setup_link_sent", email);
}

/** The setup page: the email it is for, and the authenticator secret to add (kept until setup ends). */
export async function setupStart(token: unknown): Promise<{ email: string; secret: string; uri: string }> {
  if ((await adminCount()) > 0) throw new AdminError(409, "already_set_up", "The dashboard is already set up. Sign in instead.");
  const row = await tokenRow("setup", token); if (!row) throw LINK_GONE();
  let secret: string;
  if (row.data) secret = unseal(String(row.data));
  else {
    secret = base32(crypto.randomBytes(20));
    await getDb().execute({ sql: "UPDATE admin_tokens SET data = ? WHERE token_hash = ?", args: [seal(secret), row.token_hash] });
  }
  const email = String(row.email);
  return { email, secret, uri: otpauthUri(secret, email) };
}

export async function setupComplete(token: unknown, password: unknown, code: unknown): Promise<{ admin: Admin; recoveryCodes: string[] }> {
  if ((await adminCount()) > 0) throw new AdminError(409, "already_set_up", "The dashboard is already set up. Sign in instead.");
  const row = await tokenRow("setup", token); if (!row) throw LINK_GONE();
  if (!row.data) throw new AdminError(400, "no_secret", "Open the setup page again to add VideoMind to your authenticator app.");
  const email = String(row.email);
  const bad = passwordProblem(password, email); if (bad) throw new AdminError(400, "weak_password", bad);
  const secret = unseal(String(row.data));
  const step = matchTotp(secret, String(code ?? "").replace(/\s/g, ""), 0);
  if (step === null) throw CODE_FAILED();
  const rc = newRecoveryCodes(), now = Date.now(), id = crypto.randomUUID();
  const hash = await hashPassword(password as string);
  await getDb().batch([
    { sql: `INSERT INTO admin_users (id, email, password_hash, totp_secret, totp_last_step, recovery_hashes, failed_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`, args: [id, email, hash, seal(secret), step, JSON.stringify(rc.hashes), now, now] },
    { sql: "UPDATE admin_tokens SET used_at = ? WHERE token_hash = ?", args: [now, row.token_hash] },
  ], "write");
  const admin = (await adminById(id))!;
  await audit(admin, "set_up");
  await notify(email, "Your VideoMind dashboard is set up", ["Your admin account for the VideoMind dashboard was set up, with two step verification.", "Keep your recovery codes somewhere safe."]);
  return { admin, recoveryCodes: rc.shown };
}

/** Always answers the same; a link is sent only if the email is an admin's. */
export async function forgotPassword(email: unknown): Promise<void> {
  const e = normEmail(email);
  if (!e || e.length > 320) return;
  const a = await adminByEmail(e);
  if (!a) { await audit(null, "reset_link_unknown_email"); return; }
  const t = await issueToken("reset", a.email, a.id, RESET_MS);
  await notify(a.email, "Reset your VideoMind dashboard password", [
    "Someone asked to reset the password of your VideoMind dashboard account.",
    "The link works once and expires in 30 minutes. You will also need a code from your authenticator app, or a recovery code.",
  ], { label: "Choose a new password", url: `${dashboardUrl()}/reset?token=${t}` });
  await audit(a, "reset_link_sent");
}
export async function resetCheck(token: unknown): Promise<{ email: string }> {
  const row = await tokenRow("reset", token); if (!row) throw LINK_GONE();
  return { email: String(row.email) };
}
export async function resetPassword(token: unknown, password: unknown, code: unknown): Promise<void> {
  const row = await tokenRow("reset", token); if (!row) throw LINK_GONE();
  const a = await adminById(String(row.admin_id)); if (!a) throw LINK_GONE();
  const bad = passwordProblem(password, a.email); if (bad) throw new AdminError(400, "weak_password", bad);
  const how = await useSecondFactor(a, code);
  if (!how) throw CODE_FAILED();
  const now = Date.now();
  await getDb().batch([
    { sql: "UPDATE admin_users SET password_hash = ?, failed_count = 0, first_failed_at = NULL, locked_until = NULL, updated_at = ? WHERE id = ?", args: [await hashPassword(password as string), now, a.id] },
    { sql: "UPDATE admin_tokens SET used_at = ? WHERE token_hash = ?", args: [now, row.token_hash] },
    { sql: "UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL", args: [now, a.id] },
  ], "write");
  await audit(a, "password_reset", null, { with: how });
  await notify(a.email, "Your VideoMind dashboard password was changed", [
    "The password of your VideoMind dashboard account was just changed, and every session was signed out.",
    "If this was not you, reset the password again now and check the audit log.",
  ]);
}

// ── signing in ──────────────────────────────────────────────────────────────

async function countFailure(a: Admin, why: string) {
  const now = Date.now();
  const fresh = a.firstFailedAt == null || now - a.firstFailedAt > FAIL_WINDOW_MS;
  const count = fresh ? 1 : a.failedCount + 1;
  const lock = count >= MAX_FAILS ? now + LOCK_MINUTES * 60_000 : null;
  await getDb().execute({
    sql: "UPDATE admin_users SET failed_count = ?, first_failed_at = ?, locked_until = COALESCE(?, locked_until), updated_at = ? WHERE id = ?",
    args: [lock ? 0 : count, lock ? null : fresh ? now : a.firstFailedAt, lock, now, a.id],
  });
  await audit(a, "sign_in_failed", null, { step: why });
  if (lock) {
    await audit(a, "locked", null, { minutes: LOCK_MINUTES });
    await notify(a.email, "Your VideoMind dashboard account is locked for a while", [
      `There were ${MAX_FAILS} failed sign in attempts on your VideoMind dashboard account, so it is locked for ${LOCK_MINUTES} minutes.`,
      "If this was not you, someone may know your password. Reset it once the lock ends, from Forgot password on the sign in page.",
    ]);
  }
}
const locked = (a: Admin) => a.lockedUntil != null && a.lockedUntil > Date.now();

/** A 6 digit code from the app, or a recovery code. Used codes are spent. Returns how, or null. */
async function useSecondFactor(a: Admin, code: unknown): Promise<"app" | "recovery" | null> {
  const c = String(code ?? "").trim();
  const digits = c.replace(/\s/g, "");
  if (/^\d{6}$/.test(digits)) {
    const step = matchTotp(unseal(a.totpSecret), digits, a.totpLastStep);
    if (step === null) return null;
    // Only one sign in per code: the step is stored before the session starts.
    const r = await getDb().execute({ sql: "UPDATE admin_users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?", args: [step, a.id, step] });
    return r.rowsAffected === 1 ? "app" : null;
  }
  const h = sha(rcNorm(c));
  if (rcNorm(c).length !== 10 || !a.recovery.includes(h)) return null;
  const left = a.recovery.filter((x) => x !== h);
  const r = await getDb().execute({ sql: "UPDATE admin_users SET recovery_hashes = ? WHERE id = ? AND recovery_hashes = ?", args: [JSON.stringify(left), a.id, JSON.stringify(a.recovery)] });
  if (r.rowsAffected !== 1) return null;
  await notify(a.email, "A recovery code was used on your VideoMind dashboard account", [
    `One of your recovery codes was just used. ${left.length} ${left.length === 1 ? "is" : "are"} left.`,
    "If this was not you, reset your password now.",
  ]);
  return "recovery";
}

/** Step one: email and password. Answers a short lived token for step two. */
export async function signInPassword(email: unknown, password: unknown): Promise<string> {
  const e = normEmail(email), pw = typeof password === "string" ? password : "";
  const a = e && e.length <= 320 ? await adminByEmail(e) : null;
  if (!a || [...pw].length > MAX_PASSWORD) { await burn(pw.slice(0, MAX_PASSWORD)); throw SIGN_IN_FAILED; }
  const ok = await checkPassword(pw, a.passwordHash);
  if (locked(a)) { await audit(a, "sign_in_while_locked"); throw SIGN_IN_FAILED; }
  if (!ok) { await countFailure(a, "password"); throw SIGN_IN_FAILED; }
  const t = newToken(), now = Date.now();
  await getDb().execute({
    sql: "INSERT INTO admin_sessions (token_hash, admin_id, stage, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, 'mfa', ?, ?, ?, NULL)",
    args: [sha(t), a.id, now, now, now + MFA_MS],
  });
  return t;
}

/** Step two: the code. Answers the session token. */
export async function signInCode(pending: unknown, code: unknown): Promise<{ token: string; admin: Admin; how: "app" | "recovery" }> {
  if (typeof pending !== "string" || !pending) throw new AdminError(401, "mfa_expired", "Sign in again: the time to enter the code ran out.");
  const r = await getDb().execute({ sql: "SELECT * FROM admin_sessions WHERE token_hash = ? AND stage = 'mfa'", args: [sha(pending)] });
  const s = r.rows[0] as any;
  if (!s || s.revoked_at != null || Number(s.expires_at) < Date.now()) throw new AdminError(401, "mfa_expired", "Sign in again: the time to enter the code ran out.");
  const a = await adminById(String(s.admin_id)); if (!a) throw SIGN_IN_FAILED;
  if (locked(a)) throw new AdminError(423, "locked", `Too many attempts. Your account is locked for up to ${LOCK_MINUTES} minutes; an email has the details.`);
  const how = await useSecondFactor(a, code);
  if (!how) { await countFailure(a, "code"); throw CODE_FAILED(); }
  const t = newToken(), now = Date.now();
  await getDb().batch([
    { sql: "UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?", args: [now, s.token_hash] },
    { sql: "INSERT INTO admin_sessions (token_hash, admin_id, stage, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, 'full', ?, ?, ?, NULL)", args: [sha(t), a.id, now, now, now + ABSOLUTE_MS] },
    { sql: "UPDATE admin_users SET failed_count = 0, first_failed_at = NULL, last_sign_in_at = ?, updated_at = ? WHERE id = ?", args: [now, now, a.id] },
  ], "write");
  await audit(a, "sign_in", null, { with: how });
  return { token: t, admin: a, how };
}

/** A signed in session for an admin who has just proved password and code (setup). */
export async function openSession(a: Admin): Promise<string> {
  const t = newToken(), now = Date.now();
  await getDb().batch([
    { sql: "INSERT INTO admin_sessions (token_hash, admin_id, stage, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, 'full', ?, ?, ?, NULL)", args: [sha(t), a.id, now, now, now + ABSOLUTE_MS] },
    { sql: "UPDATE admin_users SET last_sign_in_at = ?, updated_at = ? WHERE id = ?", args: [now, now, a.id] },
  ], "write");
  await audit(a, "sign_in", null, { with: "setup" });
  return t;
}

/** The admin of a session, or null. Ends sessions idle for IDLE_MS. */
export async function adminOfSession(token: unknown): Promise<{ admin: Admin; expiresAt: number; idleUntil: number } | null> {
  if (typeof token !== "string" || !token) return null;
  const r = await getDb().execute({ sql: "SELECT * FROM admin_sessions WHERE token_hash = ? AND stage = 'full'", args: [sha(token)] });
  const s = r.rows[0] as any; const now = Date.now();
  if (!s || s.revoked_at != null || Number(s.expires_at) < now || now - Number(s.last_seen_at) > IDLE_MS) return null;
  const a = await adminById(String(s.admin_id)); if (!a) return null;
  if (now - Number(s.last_seen_at) > 60_000) await getDb().execute({ sql: "UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?", args: [now, s.token_hash] });
  return { admin: a, expiresAt: Number(s.expires_at), idleUntil: now + IDLE_MS };
}
export async function signOut(token: unknown) {
  if (typeof token !== "string" || !token) return;
  await getDb().execute({ sql: "UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", args: [Date.now(), sha(token)] });
}
export const publicAdmin = (a: Admin) => ({ id: a.id, email: a.email, createdAt: a.createdAt, lastSignInAt: a.lastSignInAt, recoveryCodesLeft: a.recovery.length });
