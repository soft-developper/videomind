// src/routes/usage.ts
// vm_storage: what the signed in wallet has used.
//
// Quantities only. There is no price here: pricing and the admin
// dashboard come after the full build, and will read the same ledger.
import { Router } from "express";
import { requireAuth, authOf } from "../lib/auth.js";
import { usageTotals, storedBytes } from "../lib/usage.js";

const router = Router();

// GET /api/usage/me?days=30
router.get("/me", requireAuth, async (req, res) => {
  try {
    const wallet = authOf(req)!.wallet;
    const asked = Number(req.query.days);
    const days = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), 366) : 30;
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const [totals, bytes] = await Promise.all([usageTotals(wallet, since), storedBytes(wallet)]);
    return res.json({ wallet, days, since, storedBytesNow: bytes, totals });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
