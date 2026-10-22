// src/routes/credits.ts
// vm_credits: a wallet's own credits (Part 16a), and adding credits with
// ShelbyUSD (vm_topup, Part 16b).
//
//   GET  /api/credits/me       balance, what is on hold, the last 30 rows, the prices
//   GET  /api/credits/prices   the price of each action (anyone may read them)
//   GET  /api/credits/topup    where to send ShelbyUSD, and the wallet's ShelbyUSD
//   POST /api/credits/topup    { hash }  add the credits a transfer paid for, once
//                              (then pays what is owed for storage first, Part 16e)
//   PUT  /api/credits/cap      { usd: number | null }  vm_spendcap: the monthly spending limit, or none
import { Router } from "express";
import { requireAuth, authOf } from "../lib/auth.js";
import { rateLimit } from "../lib/guard.js";
import { myCredits, listActionPrices, publicPrice, getCreditSettings, CreditsError, getProcessMinMinutes, setSpendingCap } from "../lib/credits.js";
import { claimTopup, topupInfo, TopupError } from "../lib/topup.js";
// vm_storagecharge: storage kept, owed and paused (Part 16e)
import { storageStatus, collectOwed } from "../lib/storageCharge.js";

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

const limitCap = rateLimit({
  name: "spending_cap", label: "changes to the monthly limit",
  perClient: { max: Number(process.env.LIMIT_CAP_PER_CLIENT_10MIN) || 30, windowMs: 10 * 60_000 },
  global: { max: Number(process.env.LIMIT_CAP_GLOBAL_10MIN) || 3000, windowMs: 10 * 60_000 },
});

router.put("/cap", limitCap, requireAuth, async (req, res) => {
  try { return res.json({ cap: await setSpendingCap(authOf(req)!.wallet, req.body ?? {}) }); }
  catch (err: any) { return fail(res, err, "setting the monthly limit", "The limit could not be saved. Try again."); }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const wallet = authOf(req)!.wallet;
    const [mine, storage] = await Promise.all([myCredits(wallet), storageStatus(wallet)]);
    return res.json({ ...mine, storage });
  } catch (err: any) { return fail(res, err, "reading a balance", "Your credits could not be loaded. Try again."); }
});

router.get("/prices", async (_req, res) => {
  try {
    const [prices, settings, processMinMinutes] = await Promise.all([listActionPrices(), getCreditSettings(), getProcessMinMinutes()]);
    // vm_priceshapes: the minimum minutes charged for processing a video
    return res.json({ charging: settings.charging, prices: prices.map(publicPrice), processMinMinutes });
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
    // vm_storagecharge: what is owed for storage is paid first from new credits.
    const storagePaidMicros = r.added ? await collectOwed(authOf(req)!.wallet).catch((e) => { console.error(`[storage] collecting after a top up: ${e?.message ?? e}`); return 0; }) : 0;
    return res.status(r.added ? 201 : 200).json({ ...r, storagePaidMicros });
  } catch (err: any) { return fail(res, err, "adding a top up", "Your transfer could not be checked. It is safe; try again in a minute."); }
});

export default router;
