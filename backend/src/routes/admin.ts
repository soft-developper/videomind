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
import { series, usageByFeature, topVideos, auditLog } from "../lib/adminInsights.js";
import {
  listAdmins, inviteAdmin, cancelInvite, inviteStart, inviteComplete, removeAdmin,
  changePassword, startAuthenticatorChange, finishAuthenticatorChange, renewRecoveryCodes,
} from "../lib/admin.js";
import { limitsOverview } from "../lib/adminSettings.js";
import { monthReport, monthsWithUsage, listPrices, updatePrice, addFixed, removeFixed, CostsError } from "../lib/costs.js";
import { listVideos, getVideoForAdmin, removeVideo, restoreVideo, listLive, endLiveEvent, listPublications, ContentError } from "../lib/adminContent.js";
// vm_credits: the Credits section
import {
  creditsOverview, adminLedger, updateActionPrice, setWelcome, grantCredits, removeCredits, refundCharge, walletCredits, CreditsError, MICROS, setCharging,
  getProcessMinMinutes, setProcessMinMinutes,
} from "../lib/credits.js";
// vm_pricing: suggested prices and the platform fee (Part 20a)
import { pricingReport, setFeePercent, applySuggestion, applyAllSuggestions, listEstimates, updateEstimate } from "../lib/pricing.js";
import { treasuryAddress, TOPUP_NETWORK } from "../lib/topup.js";
// vm_storagecharge: storage kept and owed (Part 16e)
import { storageTotals, storageStatus, setStorageFree, forgiveStorage, collectOwed, GB } from "../lib/storageCharge.js";
// vm_generate: video generation settings (Part 17b)
import { adminGeneration, setGenSettings, updateModel, allowWallet, disallowWallet, generationUnitCost, GenError } from "../lib/generation.js";

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
  if (err instanceof CostsError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof UsersError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof CreditsError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof GenError) return res.status(err.status).json({ error: err.message, code: err.code });
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

// ── vm_insights: Insights ───────────────────────────────────────────────────
//   GET  /insights?metric=views&days=28     one daily series, with the previous period's total
//   GET  /insights/top-videos?days=28       the most watched videos
//   GET  /audit?action=&email=&q=&before=   the audit log, newest first
router.get("/insights", requireAdmin, async (req, res) => {
  try {
    const [s, features] = await Promise.all([series(req.query.metric, req.query.days), usageByFeature(req.query.days)]);
    return res.json({ ...s, features });
  } catch (err) { fail(res, err, "Loading the insights"); }
});
router.get("/insights/top-videos", requireAdmin, async (req, res) => {
  try { return res.json(await topVideos(req.query.days)); } catch (err) { fail(res, err, "Loading the top videos"); }
});
router.get("/audit", requireAdmin, async (req, res) => {
  try { return res.json(await auditLog(req.query)); } catch (err) { fail(res, err, "Loading the audit log"); }
});

// ── vm_insights: Costs ──────────────────────────────────────────────────────
//   GET  /costs?month=YYYY-MM          the month's estimate, prices and fixed costs
//   POST /costs/prices/:id             change a price { usd, longUsd, freePerMonth }
//   POST /costs/fixed                  add a fixed monthly cost { name, usdPerMonth, note }
//   POST /costs/fixed/:id/delete       remove one
router.get("/costs", requireAdmin, async (req, res) => {
  try {
    const [report, months, prices] = await Promise.all([monthReport(req.query.month), monthsWithUsage(), listPrices()]);
    return res.json({ ...report, months, prices });
  } catch (err) { fail(res, err, "Loading the costs"); }
});
router.post("/costs/prices/:id", requireAdmin, async (req, res) => {
  try {
    const p = await updatePrice(req.params.id, req.body, me(res)!.email);
    await audit(me(res), "price_changed", p.id, { model: p.model, metric: p.metric, usd: p.usd, longUsd: p.longUsd, freePerMonth: p.freePerMonth });
    return res.json(p);
  } catch (err) { fail(res, err, "Changing the price"); }
});
router.post("/costs/fixed", requireAdmin, async (req, res) => {
  try { const f = await addFixed(req.body); await audit(me(res), "fixed_cost_added", f.id, { name: f.name, usdPerMonth: f.usdPerMonth }); return res.status(201).json(f); }
  catch (err) { fail(res, err, "Adding the cost"); }
});
router.post("/costs/fixed/:id/delete", requireAdmin, async (req, res) => {
  try { await removeFixed(req.params.id); await audit(me(res), "fixed_cost_removed", req.params.id); return res.json({ ok: true }); }
  catch (err) { fail(res, err, "Removing the cost"); }
});

// ── vm_credits: Credits ─────────────────────────────────────────────────────
//   GET  /credits                          settings, prices with the cost per unit, totals
//   GET  /credits/ledger?wallet=&kind=&before=   the ledger, newest first
//   GET  /credits/wallets/:wallet          one wallet's balance and last rows
//   POST /credits/prices/:id   { usd }      the price of one unit of an action
//   POST /credits/charging     { on }       vm_charge: actions take their price from credits, or not
//   POST /credits/welcome      { welcomeUsd }   given once to every wallet
//   POST /credits/grant        { wallet, usd, note }
//   POST /credits/remove       { wallet, usd, note }   never more than the wallet has free
//   POST /credits/entries/:id/refund { note }      a charge, in full, once
//   POST /credits/storage      { freeGb }   vm_storagecharge: the free allowance per owner
//   POST /credits/wallets/:wallet/forgive-storage   let a wallet off what it owes for storage
// vm_pricing:
//   POST /credits/fee          { percent }  the platform fee added to every suggested price
//   POST /credits/prices/:id/apply          set a price to its suggestion
//   POST /credits/prices-apply-all          set every price to its suggestion
//   POST /credits/estimates/:id { usd }     the starting cost of one unit of an action
//   POST /credits/process-minimum { minutes }  vm_priceshapes: minutes charged at least per processed video
const usdOf = (micros: number) => micros / MICROS;
router.get("/credits", requireAdmin, async (_req, res) => {
  // vm_topup: where top ups go (TOPUP_TREASURY_ADDRESS on the server, read only here).
  try {
    const [overview, storage, genCost, pricing, estimates] = await Promise.all([creditsOverview(), storageTotals(), generationUnitCost(), pricingReport(), listEstimates()]);
    return res.json({ ...overview, costs: [...overview.costs, genCost], storage, topup: { treasury: treasuryAddress(), network: TOPUP_NETWORK }, pricing, estimates, processMinMinutes: await getProcessMinMinutes() });
  }
  catch (err) { fail(res, err, "Loading the credits"); }
});
router.get("/credits/ledger", requireAdmin, async (req, res) => {
  try { return res.json(await adminLedger(req.query)); } catch (err) { fail(res, err, "Loading the ledger"); }
});
router.get("/credits/wallets/:wallet", requireAdmin, async (req, res) => {
  try {
    const [credits, storage] = await Promise.all([walletCredits(req.params.wallet), storageStatus(req.params.wallet)]);
    return res.json({ ...credits, storage });
  } catch (err) { fail(res, err, "Loading the wallet's credits"); }
});
router.post("/credits/prices/:id", requireAdmin, async (req, res) => {
  try {
    const p = await updateActionPrice(req.params.id, req.body, me(res).email);
    await audit(me(res), "credit_price_changed", p.id, { usd: usdOf(p.microsPerUnit), unit: p.unit });
    return res.json(p);
  } catch (err) { fail(res, err, "Changing the price"); }
});
router.post("/credits/fee", requireAdmin, async (req, res) => {
  try {
    const bps = await setFeePercent(req.body);
    await audit(me(res), "credit_fee_changed", null, { percent: bps / 100 });
    return res.json({ feeBps: bps });
  } catch (err) { fail(res, err, "Changing the platform fee"); }
});
router.post("/credits/prices/:id/apply", requireAdmin, async (req, res) => {
  try {
    const r = await applySuggestion(req.params.id, me(res).email);
    await audit(me(res), "credit_price_applied", r.id, { fromUsd: usdOf(r.fromMicros), toUsd: usdOf(r.toMicros) });
    return res.json(r);
  } catch (err) { fail(res, err, "Applying the suggested price"); }
});
router.post("/credits/prices-apply-all", requireAdmin, async (_req, res) => {
  try {
    const changed = await applyAllSuggestions(me(res).email);
    if (changed.length) await audit(me(res), "credit_prices_applied", null, { changed: changed.map((c) => ({ id: c.id, fromUsd: usdOf(c.fromMicros), toUsd: usdOf(c.toMicros) })) });
    return res.json({ changed });
  } catch (err) { fail(res, err, "Applying the suggested prices"); }
});
router.post("/credits/process-minimum", requireAdmin, async (req, res) => {
  try {
    const minutes = await setProcessMinMinutes(req.body);
    await audit(me(res), "credit_process_minimum_changed", null, { minutes });
    return res.json({ processMinMinutes: minutes });
  } catch (err) { fail(res, err, "Changing the minimum"); }
});
router.post("/credits/estimates/:id", requireAdmin, async (req, res) => {
  try {
    const e = await updateEstimate(req.params.id, req.body, me(res).email);
    await audit(me(res), "credit_estimate_changed", e.id, { usd: e.usdPerUnit });
    return res.json(e);
  } catch (err) { fail(res, err, "Changing the estimate"); }
});
router.post("/credits/charging", requireAdmin, async (req, res) => {
  try {
    const s = await setCharging(req.body);
    await audit(me(res), s.charging ? "charging_turned_on" : "charging_turned_off");
    return res.json(s);
  } catch (err) { fail(res, err, "Changing charging"); }
});
router.post("/credits/welcome", requireAdmin, async (req, res) => {
  try {
    const s = await setWelcome(req.body);
    await audit(me(res), "credit_welcome_changed", null, { usd: usdOf(s.welcomeMicros) });
    return res.json(s);
  } catch (err) { fail(res, err, "Changing the welcome amount"); }
});
router.post("/credits/grant", requireAdmin, async (req, res) => {
  try {
    const e = await grantCredits(req.body, me(res).email);
    await audit(me(res), "credits_granted", e.wallet, { usd: usdOf(e.amountMicros), note: e.note });
    // vm_storagecharge: what the wallet owes for storage is paid first.
    await collectOwed(e.wallet).catch((x) => console.error(`[storage] collecting after a grant: ${x?.message ?? x}`));
    return res.status(201).json(e);
  } catch (err) { fail(res, err, "Giving the credits"); }
});
router.post("/credits/remove", requireAdmin, async (req, res) => {
  try {
    const e = await removeCredits(req.body, me(res).email);
    await audit(me(res), "credits_removed", e.wallet, { usd: usdOf(-e.amountMicros), note: e.note });
    return res.status(201).json(e);
  } catch (err) { fail(res, err, "Removing the credits"); }
});
router.post("/credits/entries/:id/refund", requireAdmin, async (req, res) => {
  try {
    const e = await refundCharge(req.params.id, req.body, me(res).email);
    await audit(me(res), "credit_refunded", e.wallet, { usd: usdOf(e.amountMicros), charge: req.params.id, note: e.note });
    return res.status(201).json(e);
  } catch (err) { fail(res, err, "Refunding the charge"); }
});
// ── vm_generate: Generation ──────────────────────────────────────────────────
//   GET  /generation                      settings, models, today's spend, the allowlist, recent generations
//   POST /generation/settings  { access, dailyUsd }   off, allowlist or everyone; real money a day
//   POST /generation/models/:id { enabled, costUsdPerSecond }
//   POST /generation/allow     { wallet }      POST /generation/disallow { wallet }
router.get("/generation", requireAdmin, async (_req, res) => {
  try { return res.json(await adminGeneration()); } catch (err) { fail(res, err, "Loading generation"); }
});
router.post("/generation/settings", requireAdmin, async (req, res) => {
  try {
    const s = await setGenSettings(req.body);
    await audit(me(res), "generation_settings_changed", null, { access: s.access, dailyUsd: s.dailyUsd });
    return res.json(s);
  } catch (err) { fail(res, err, "Changing generation"); }
});
router.post("/generation/models/:id", requireAdmin, async (req, res) => {
  try {
    const m = await updateModel(req.params.id, req.body);
    await audit(me(res), "generation_model_changed", m.id, { enabled: m.enabled, costUsdPerSecond: m.costUsdPerSecond });
    return res.json(m);
  } catch (err) { fail(res, err, "Changing the model"); }
});
router.post("/generation/allow", requireAdmin, async (req, res) => {
  try {
    const r = await allowWallet(req.body?.wallet, me(res).email);
    await audit(me(res), "generation_allowed", r.wallet);
    return res.status(201).json(r);
  } catch (err) { fail(res, err, "Adding the wallet"); }
});
router.post("/generation/disallow", requireAdmin, async (req, res) => {
  try {
    const r = await disallowWallet(req.body?.wallet);
    await audit(me(res), "generation_disallowed", r.wallet);
    return res.json(r);
  } catch (err) { fail(res, err, "Removing the wallet"); }
});
router.post("/credits/storage", requireAdmin, async (req, res) => {
  try {
    const s = await setStorageFree(req.body);
    await audit(me(res), "storage_free_changed", null, { gb: s.freeBytes / GB });
    return res.json(s);
  } catch (err) { fail(res, err, "Changing the free storage"); }
});
router.post("/credits/wallets/:wallet/forgive-storage", requireAdmin, async (req, res) => {
  try {
    const r = await forgiveStorage(req.params.wallet, me(res).email);
    await audit(me(res), "storage_forgiven", req.params.wallet, { usd: usdOf(r.forgivenMicros), days: r.days });
    return res.json(r);
  } catch (err) { fail(res, err, "Forgiving the storage owed"); }
});

// ── vm_admin_settings: Settings ─────────────────────────────────────────────
//   GET  /settings/admins                         admins and open invitations
//   POST /settings/invites         { email, code }   email an invitation (48 hours)
//   POST /settings/invites/cancel  { email }
//   POST /settings/admins/:id/remove { code }      not yourself, not the founder (ADMIN_EMAIL)
//   POST /settings/password        { current, password }   other sessions end
//   POST /settings/authenticator/start              a new secret to add (15 minutes)
//   POST /settings/authenticator/finish { password, code }  code from the new app; other sessions end
//   POST /settings/recovery-codes  { password }     10 new codes; the old ones stop working
//   GET  /settings/limits                           the limits in force (read only)
//   POST /invite/start    { token }                 the invitation page (no session)
//   POST /invite/complete { token, password, code } make the account; signs in; answers recovery codes
router.get("/settings/admins", requireAdmin, async (_req, res) => {
  try { return res.json(await listAdmins(me(res).id)); } catch (err) { fail(res, err, "Loading the admins"); }
});
router.post("/settings/invites", requireAdmin, limitMail, async (req, res) => {
  try { return res.status(202).json(await inviteAdmin(me(res), req.body?.email, req.body?.code)); }
  catch (err) { fail(res, err, "Sending the invitation"); }
});
router.post("/settings/invites/cancel", requireAdmin, async (req, res) => {
  try { await cancelInvite(me(res), req.body?.email); return res.json({ cancelled: true }); }
  catch (err) { fail(res, err, "Cancelling the invitation"); }
});
router.post("/settings/admins/:id/remove", requireAdmin, limitAuth, async (req, res) => {
  try { return res.json(await removeAdmin(me(res), req.params.id, req.body?.code)); }
  catch (err) { fail(res, err, "Removing the admin"); }
});
router.post("/settings/password", requireAdmin, limitAuth, async (req, res) => {
  try { await changePassword(me(res), req.body?.current, req.body?.password, currentHash(req)); return res.json({ changed: true }); }
  catch (err) { fail(res, err, "Changing the password"); }
});
router.post("/settings/authenticator/start", requireAdmin, limitAuth, async (_req, res) => {
  try { return res.json(await startAuthenticatorChange(me(res))); }
  catch (err) { fail(res, err, "Starting the change"); }
});
router.post("/settings/authenticator/finish", requireAdmin, limitAuth, async (req, res) => {
  try { await finishAuthenticatorChange(me(res), req.body?.password, req.body?.code, currentHash(req)); return res.json({ changed: true }); }
  catch (err) { fail(res, err, "Changing the authenticator"); }
});
router.post("/settings/recovery-codes", requireAdmin, limitAuth, async (req, res) => {
  try { return res.json({ recoveryCodes: await renewRecoveryCodes(me(res), req.body?.password) }); }
  catch (err) { fail(res, err, "Making new recovery codes"); }
});
router.get("/settings/limits", requireAdmin, (_req, res) => {
  try { return res.json(limitsOverview()); } catch (err) { fail(res, err, "Loading the limits"); }
});
router.post("/invite/start", limitAuth, async (req, res) => {
  try { return res.json(await inviteStart(req.body?.token)); }
  catch (err) { fail(res, err, "Opening the invitation"); }
});
router.post("/invite/complete", limitAuth, async (req, res) => {
  try {
    const { admin, recoveryCodes } = await inviteComplete(req.body?.token, req.body?.password, req.body?.code);
    const token = await openSession(admin);
    setCookie(res, SESSION, token, ABSOLUTE_MS);
    return res.status(201).json({ admin: publicAdmin(admin), recoveryCodes });
  } catch (err) { fail(res, err, "Accepting the invitation"); }
});

export default router;
