// src/routes/admin.ts
// vm_admin: the admin dashboard's API, under /api/admin. Used only by
// dashboard.vidzmind.xyz (DASHBOARD_URL). The session is an httpOnly,
// Secure, SameSite=Strict cookie that page scripts cannot read.
//
//   GET  /status                       is the dashboard set up, and is the server ready for it
//   POST /setup/send                   email the setup link to ADMIN_EMAIL (only while no admin exists)
//   POST /setup/start   { token }      the authenticator secret for the setup page
//   POST /setup/complete { token, password, code }   make the account; signs in; answers recovery codes
//   POST /login         { email, password }          step one; sets a 5 minute cookie for step two
//   POST /login/code    { code }                     step two (app code or recovery code); signs in
//   POST /forgot        { email }                    a reset link, if the email is an admin's (same answer either way)
//   POST /reset/check   { token }
//   POST /reset         { token, password, code }
//   GET  /me, POST /logout
//   GET  /overview
import { Router, type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "../lib/guard.js";
import {
  AdminError, adminCount, adminReady, dashboardUrl, sendSetupLink, setupStart, setupComplete,
  signInPassword, signInCode, openSession, adminOfSession, signOut, forgotPassword, resetCheck, resetPassword,
  publicAdmin, audit, MFA_MS, ABSOLUTE_MS, type Admin,
} from "../lib/admin.js";
import { overview } from "../lib/adminOverview.js";
import { MailError } from "../lib/mail.js";
// vm_admin_users: the Users section
import { listUsers, getUser, suspendUser, liftSuspension, UsersError } from "../lib/adminUsers.js";
import { revokeAllSessions, normalizeWallet } from "../lib/auth.js";
import { deleteAccountData } from "../lib/account.js";
// vm_ops: the Operations and Security sections
import crypto from "crypto";
import { listJobsForAdmin, retryJobById, listOpenUploadsForAdmin, discardUpload, listAnchorsForAdmin, checkAnchorNow, runHousekeeping, securityOverview, endOtherAdminSessions, OpsError } from "../lib/adminOps.js";
// vm_content: the Content section
import { listVideos, getVideoForAdmin, removeVideo, restoreVideo, listLive, endLiveEvent, listPublications, ContentError } from "../lib/adminContent.js";

const router = Router();
const SESSION = "vm_admin", PENDING = "vm_admin_mfa";

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    const k = part.slice(0, i).trim(); if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore a broken cookie */ }
  }
  return out;
}
function setCookie(res: Response, name: string, value: string, maxAgeMs: number) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/api/admin", "HttpOnly", "Secure", "SameSite=Strict", `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`];
  res.append("Set-Cookie", parts.join("; "));
}
const clearCookie = (res: Response, name: string) => setCookie(res, name, "", 0);

// Nothing here is cached, and writes only come from the dashboard's own address.
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const origin = req.headers.origin;
    if (origin && origin !== dashboardUrl()) return res.status(403).json({ error: "This request must come from the dashboard.", code: "bad_origin" });
  }
  next();
});

const limitAuth = rateLimit({
  name: "admin_auth", label: "sign in attempts",
  perClient: { max: Number(process.env.LIMIT_ADMIN_AUTH_PER_CLIENT_10MIN) || 30, windowMs: 10 * 60_000 },
  global: { max: Number(process.env.LIMIT_ADMIN_AUTH_GLOBAL_10MIN) || 300, windowMs: 10 * 60_000 },
});
const limitMail = rateLimit({
  name: "admin_mail", label: "email requests",
  perClient: { max: Number(process.env.LIMIT_ADMIN_MAIL_PER_CLIENT_HOUR) || 5, windowMs: 60 * 60_000 },
  global: { max: Number(process.env.LIMIT_ADMIN_MAIL_GLOBAL_HOUR) || 30, windowMs: 60 * 60_000 },
});

function fail(res: Response, err: any, what: string) {
  if (err instanceof AdminError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof OpsError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof ContentError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof UsersError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof MailError) return res.status(502).json({ error: "The email could not be sent. Check the Resend settings on the server and try again.", code: "mail_failed" });
  console.error(`[admin] ${what}: ${err?.message ?? err}`);
  return res.status(500).json({ error: `${what} did not work. Try again.`, code: "server_error" });
}

/** Signed in admins only. Sets res.locals.admin. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const s = await adminOfSession(cookies(req)[SESSION]);
    if (!s) return res.status(401).json({ error: "Sign in to the dashboard.", code: "admin_required" });
    res.locals.admin = s.admin; res.locals.adminSession = s;
    next();
  } catch (err) { fail(res, err, "Checking the session"); }
}
const me = (res: Response) => res.locals.admin as Admin;

router.get("/status", async (_req, res) => {
  try {
    const setUp = (await adminCount()) > 0;
    const ready = adminReady();
    return res.json({ setUp, ready: ready.ok, ...(setUp ? {} : { missing: ready.missing }) });
  } catch (err) { fail(res, err, "Reading the status"); }
});

router.post("/setup/send", limitMail, async (_req, res) => {
  try { await sendSetupLink(); return res.status(202).json({ sent: true }); }
  catch (err) { fail(res, err, "Sending the setup link"); }
});
router.post("/setup/start", limitAuth, async (req, res) => {
  try { return res.json(await setupStart(req.body?.token)); }
  catch (err) { fail(res, err, "Opening the setup"); }
});
router.post("/setup/complete", limitAuth, async (req, res) => {
  try {
    const { admin, recoveryCodes } = await setupComplete(req.body?.token, req.body?.password, req.body?.code);
    // Setup proved the password and the code, so it signs in.
    const token = await openSession(admin);
    setCookie(res, SESSION, token, ABSOLUTE_MS);
    return res.status(201).json({ admin: publicAdmin(admin), recoveryCodes });
  } catch (err) { fail(res, err, "Setting up the account"); }
});

router.post("/login", limitAuth, async (req, res) => {
  try {
    const t = await signInPassword(req.body?.email, req.body?.password);
    setCookie(res, PENDING, t, MFA_MS);
    return res.json({ next: "code" });
  } catch (err) { fail(res, err, "Signing in"); }
});
router.post("/login/code", limitAuth, async (req, res) => {
  try {
    const s = await signInCode(cookies(req)[PENDING], req.body?.code);
    clearCookie(res, PENDING);
    setCookie(res, SESSION, s.token, ABSOLUTE_MS);
    return res.json({ admin: publicAdmin(s.admin), usedRecoveryCode: s.how === "recovery" });
  } catch (err) { fail(res, err, "Signing in"); }
});

router.post("/forgot", limitMail, async (req, res) => {
  try { await forgotPassword(req.body?.email); }
  catch (err: any) { console.error(`[admin] reset link: ${err?.message ?? err}`); }
  // The same answer whether or not the email has an account.
  return res.status(202).json({ message: "If that email has a dashboard account, a link to reset the password is on its way. It expires in 30 minutes." });
});
router.post("/reset/check", limitAuth, async (req, res) => {
  try { return res.json(await resetCheck(req.body?.token)); }
  catch (err) { fail(res, err, "Opening the reset link"); }
});
router.post("/reset", limitAuth, async (req, res) => {
  try { await resetPassword(req.body?.token, req.body?.password, req.body?.code); clearCookie(res, SESSION); return res.json({ reset: true }); }
  catch (err) { fail(res, err, "Resetting the password"); }
});

router.get("/me", requireAdmin, (_req, res) => {
  const s = res.locals.adminSession;
  return res.json({ admin: publicAdmin(me(res)), sessionEndsAt: s.expiresAt });
});
router.post("/logout", async (req, res) => {
  try {
    const t = cookies(req)[SESSION];
    const s = await adminOfSession(t);
    await signOut(t);
    if (s) await audit(s.admin, "sign_out");
  } catch (err: any) { console.error(`[admin] sign out: ${err?.message ?? err}`); }
  clearCookie(res, SESSION); clearCookie(res, PENDING);
  return res.json({ signedOut: true });
});

router.get("/overview", requireAdmin, async (_req, res) => {
  try { return res.json(await overview()); }
  catch (err) { fail(res, err, "Loading the overview"); }
});

// ── vm_admin_users: Users ───────────────────────────────────────────────────
//   GET  /users?q=&filter=all|suspended&sort=joined|active|videos|storage&limit=&offset=
//   GET  /users/:wallet
//   POST /users/:wallet/sign-out              end every session of the wallet
//   POST /users/:wallet/suspend   { reason }  it cannot sign in; its sessions end
//   POST /users/:wallet/unsuspend
//   POST /users/:wallet/delete    { confirm: <the wallet address> }   Delete my data, done by an admin
const target = (req: Request) => normalizeWallet(req.params.wallet);

router.get("/users", requireAdmin, async (req, res) => {
  try { return res.json(await listUsers(req.query)); }
  catch (err) { fail(res, err, "Loading the users"); }
});
router.get("/users/:wallet", requireAdmin, async (req, res) => {
  try { return res.json(await getUser(req.params.wallet)); }
  catch (err) { fail(res, err, "Loading the user"); }
});
router.post("/users/:wallet/sign-out", requireAdmin, async (req, res) => {
  try {
    const w = target(req); if (!w) throw new UsersError(400, "bad_wallet", "That is not a wallet address.");
    const ended = await revokeAllSessions(w);
    await audit(me(res), "user_signed_out", w, { sessions: ended });
    return res.json({ ended });
  } catch (err) { fail(res, err, "Signing the wallet out"); }
});
router.post("/users/:wallet/suspend", requireAdmin, async (req, res) => {
  try {
    const r = await suspendUser(req.params.wallet, req.body?.reason, me(res).email);
    await audit(me(res), "user_suspended", r.wallet, { reason: String(req.body?.reason ?? "").slice(0, 500), sessions: r.ended });
    return res.json(r);
  } catch (err) { fail(res, err, "Suspending the wallet"); }
});
router.post("/users/:wallet/unsuspend", requireAdmin, async (req, res) => {
  try {
    const r = await liftSuspension(req.params.wallet);
    await audit(me(res), "user_unsuspended", r.wallet);
    return res.json(r);
  } catch (err) { fail(res, err, "Lifting the suspension"); }
});
router.post("/users/:wallet/delete", requireAdmin, async (req, res) => {
  try {
    const w = target(req); if (!w) throw new UsersError(400, "bad_wallet", "That is not a wallet address.");
    if (normalizeWallet(req.body?.confirm) !== w) throw new UsersError(400, "confirm_needed", "Type the wallet address to confirm.");
    const deleted = await deleteAccountData(w);
    await audit(me(res), "user_data_deleted", w, deleted);
    return res.json({ deleted });
  } catch (err) { fail(res, err, "Deleting the data"); }
});

// ── vm_content: Content ─────────────────────────────────────────────────────
//   GET  /content/videos?q=&filter=all|public|unlisted|private|removed&sort=newest|views|size&limit=&offset=
//   GET  /content/videos/:id                 details and a playback address, to review it
//   POST /content/videos/:id/remove { reason }   take it down; the owner sees the reason
//   POST /content/videos/:id/restore
//   GET  /content/live?filter=live|all
//   POST /content/live/:id/end
//   GET  /content/youtube
router.get("/content/videos", requireAdmin, async (req, res) => {
  try { return res.json(await listVideos(req.query)); }
  catch (err) { fail(res, err, "Loading the videos"); }
});
router.get("/content/videos/:id", requireAdmin, async (req, res) => {
  try { return res.json(await getVideoForAdmin(req.params.id)); }
  catch (err) { fail(res, err, "Loading the video"); }
});
router.post("/content/videos/:id/remove", requireAdmin, async (req, res) => {
  try {
    const r = await removeVideo(req.params.id, req.body?.reason, me(res).email);
    await audit(me(res), "video_removed", r.id, { owner: r.owner, reason: String(req.body?.reason ?? "").slice(0, 500) });
    return res.json(r);
  } catch (err) { fail(res, err, "Taking the video down"); }
});
router.post("/content/videos/:id/restore", requireAdmin, async (req, res) => {
  try {
    const r = await restoreVideo(req.params.id);
    await audit(me(res), "video_restored", r.id);
    return res.json(r);
  } catch (err) { fail(res, err, "Restoring the video"); }
});
router.get("/content/live", requireAdmin, async (req, res) => {
  try { return res.json(await listLive(req.query)); }
  catch (err) { fail(res, err, "Loading the live events"); }
});
router.post("/content/live/:id/end", requireAdmin, async (req, res) => {
  try {
    const r = await endLiveEvent(req.params.id);
    await audit(me(res), "live_ended", r.id, { owner: r.owner });
    return res.json(r);
  } catch (err) { fail(res, err, "Ending the live event"); }
});
router.get("/content/youtube", requireAdmin, async (req, res) => {
  try { return res.json(await listPublications(req.query)); }
  catch (err) { fail(res, err, "Loading the YouTube uploads"); }
});

// ── vm_ops: Operations ──────────────────────────────────────────────────────
//   GET  /ops/jobs?filter=failed|queued|running|all     POST /ops/jobs/:id/retry
//   GET  /ops/uploads                                   POST /ops/uploads/:videoId/discard
//   GET  /ops/anchors?state=problems|checking|...       POST /ops/anchors/:id/check
//   POST /ops/housekeeping                              run the hourly sweep now
router.get("/ops/jobs", requireAdmin, async (req, res) => {
  try { return res.json(await listJobsForAdmin(req.query)); } catch (err) { fail(res, err, "Loading the jobs"); }
});
router.post("/ops/jobs/:id/retry", requireAdmin, async (req, res) => {
  try { const r = await retryJobById(req.params.id); await audit(me(res), "job_retried", r.videoId, { kind: r.kind }); return res.status(202).json(r); }
  catch (err) { fail(res, err, "Running the job again"); }
});
router.get("/ops/uploads", requireAdmin, async (_req, res) => {
  try { return res.json(await listOpenUploadsForAdmin()); } catch (err) { fail(res, err, "Loading the uploads"); }
});
router.post("/ops/uploads/:videoId/discard", requireAdmin, async (req, res) => {
  try { const r = await discardUpload(req.params.videoId); await audit(me(res), "upload_discarded", r.videoId); return res.json(r); }
  catch (err) { fail(res, err, "Discarding the upload"); }
});
router.get("/ops/anchors", requireAdmin, async (req, res) => {
  try { return res.json(await listAnchorsForAdmin(req.query)); } catch (err) { fail(res, err, "Loading the Shelby stores"); }
});
router.post("/ops/anchors/:id/check", requireAdmin, async (req, res) => {
  try { return res.json(await checkAnchorNow(req.params.id)); } catch (err) { fail(res, err, "Checking the store"); }
});
router.post("/ops/housekeeping", requireAdmin, async (_req, res) => {
  try { const r = await runHousekeeping(); await audit(me(res), "housekeeping_run", null, r); return res.json(r); }
  catch (err) { fail(res, err, "Running the housekeeping"); }
});

// ── vm_ops: Security ────────────────────────────────────────────────────────
//   GET  /security                     suspended wallets, sessions, admin sign ins, recent events (memory)
//   POST /security/end-other-sessions  sign every other admin session out
const currentHash = (req: Request) => { const t = cookies(req)[SESSION]; return t ? crypto.createHash("sha256").update(t).digest("hex") : null; };
router.get("/security", requireAdmin, async (req, res) => {
  try { return res.json(await securityOverview(currentHash(req))); } catch (err) { fail(res, err, "Loading security"); }
});
router.post("/security/end-other-sessions", requireAdmin, async (req, res) => {
  try {
    const r = await endOtherAdminSessions(currentHash(req)!);
    await audit(me(res), "admin_sessions_ended", null, r);
    return res.json(r);
  } catch (err) { fail(res, err, "Signing the other sessions out"); }
});

export default router;
