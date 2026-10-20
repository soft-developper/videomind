// src/routes/credits.ts
// vm_credits: a wallet's own credits (Part 16a), and adding credits with
// ShelbyUSD (vm_topup, Part 16b).
//
//   GET  /api/credits/me       balance, what is on hold, the last 30 rows, the prices
//   GET  /api/credits/prices   the price of each action (anyone may read them)
//   GET  /api/credits/topup    where to send ShelbyUSD, and the wallet's ShelbyUSD
//   POST /api/credits/topup    { hash }  add the credits a transfer paid for, once
import { Router } from "express";
import { requireAuth, authOf } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { myCredits, listActionPrices, publicPrice, getCreditSettings, CreditsError } from "../lib/credits.js";
import { claimTopup, topupInfo, TopupError } from "../lib/topup.js";

const router = Router();

const limitTopup = rateLimit({
  name: "topup", label: "top up checks",
  perClient: { max: Number(process.env.LIMIT_TOPUP_PER_CLIENT_10MIN) || 30, windowMs: 10 * 60_000 },
  global: { max: Number(process.env.LIMIT_TOPUP_GLOBAL_10MIN) || 600, windowMs: 10 * 60_000 },
});

function fail(res: any, err: any, what: string, message: string) {
  if (err instanceof CreditsError || err instanceof TopupError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`[credits] ${what}: ${err?.message ?? err}`);
  return res.status(500).json({ error: message, code: "server_error" });
}

router.get("/me", requireAuth, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await myCredits(authOf(req)!.wallet));
  } catch (err: any) { return fail(res, err, "reading a balance", "Your credits could not be loaded. Try again."); }
});

router.get("/prices", async (_req, res) => {
  try {
    const [prices, settings] = await Promise.all([listActionPrices(), getCreditSettings()]);
    return res.json({ charging: settings.charging, prices: prices.map(publicPrice) });
  } catch (err: any) { return fail(res, err, "reading the prices", "The prices could not be loaded. Try again."); }
});

router.get("/topup", requireAuth, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await topupInfo(authOf(req)!.wallet));
  } catch (err: any) { return fail(res, err, "reading the top up settings", "Adding credits could not be loaded. Try again."); }
});

router.post("/topup", limitTopup, requireAuth, async (req, res) => {
  try {
    const r = await claimTopup(authOf(req)!.wallet, req.body?.hash);
    return res.status(r.added ? 201 : 200).json(r);
  } catch (err: any) { return fail(res, err, "adding a top up", "Your transfer could not be checked. It is safe; try again in a minute."); }
});

export default router;
