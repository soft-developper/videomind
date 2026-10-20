// src/routes/credits.ts
// vm_credits: a wallet's own credits (Part 16a).
//
//   GET /api/credits/me       balance, what is on hold, the last 30 rows, the prices
//   GET /api/credits/prices   the price of each action (anyone may read them)
import { Router } from "express";
import { requireAuth, authOf } from "../lib/auth.js";
import { myCredits, listActionPrices, publicPrice, getCreditSettings, CreditsError } from "../lib/credits.js";

const router = Router();

router.get("/me", requireAuth, async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await myCredits(authOf(req)!.wallet));
  } catch (err: any) {
    if (err instanceof CreditsError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error(`[credits] reading a balance: ${err?.message ?? err}`);
    return res.status(500).json({ error: "Your credits could not be loaded. Try again.", code: "server_error" });
  }
});

router.get("/prices", async (_req, res) => {
  try {
    const [prices, settings] = await Promise.all([listActionPrices(), getCreditSettings()]);
    return res.json({ charging: settings.charging, prices: prices.map(publicPrice) });
  } catch (err: any) {
    console.error(`[credits] reading the prices: ${err?.message ?? err}`);
    return res.status(500).json({ error: "The prices could not be loaded. Try again.", code: "server_error" });
  }
});

export default router;
