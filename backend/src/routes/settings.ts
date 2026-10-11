// src/routes/settings.ts
// vm_settings: the signed in wallet's settings page. Mounted at /api.
//
//   GET  /me/settings           settings, session, active sessions
//   PUT  /me/settings           { uploadVisibility?, uploadCategory? } (null or "" = remember last choice)
//   POST /me/logout-everywhere  end every session of this wallet, this one too
//   POST /me/delete             { confirm: "DELETE" } delete everything VideoMind holds about this wallet
import { Router } from "express";
import { requireAuth, authOf, revokeAllSessions, activeSessions } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { getSettings, saveSettings, deleteAccountData, SettingsError } from "../lib/account.js";

const router = Router();
const limitSettings = rateLimit({
  name: "settings",
  label: "settings changes",
  perClient: { max: Number(process.env.LIMIT_SETTINGS_PER_CLIENT_10MIN) || 60, windowMs: 10 * 60_000 },
  global:    { max: Number(process.env.LIMIT_SETTINGS_GLOBAL_10MIN) || 3000, windowMs: 10 * 60_000 },
});

router.get("/me/settings", requireAuth, async (req, res) => {
  try {
    const a = authOf(req)!;
    return res.json({ wallet: a.wallet, sessionExpiresAt: a.expiresAt, activeSessions: await activeSessions(a.wallet), settings: await getSettings(a.wallet) });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.put("/me/settings", limitSettings, requireAuth, async (req, res) => {
  try {
    return res.json({ settings: await saveSettings(authOf(req)!.wallet, req.body) });
  } catch (err: any) {
    if (err instanceof SettingsError) return res.status(400).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  }
});

router.post("/me/logout-everywhere", limitSettings, requireAuth, async (req, res) => {
  try {
    return res.json({ ended: await revokeAllSessions(authOf(req)!.wallet) });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

router.post("/me/delete", limitSettings, requireAuth, async (req, res) => {
  try {
    if ((req.body ?? {}).confirm !== "DELETE") return res.status(400).json({ error: "Type DELETE to confirm.", code: "confirm_needed" });
    return res.json({ deleted: await deleteAccountData(authOf(req)!.wallet) });
  } catch (err: any) {
    console.error(`[account] delete failed: ${err?.message ?? err}`);
    return res.status(500).json({ error: "Not everything could be deleted. Try again, or write to privacy@vidzmind.xyz." });
  }
});

export default router;
