// src/routes/auth.ts
// vm_signin: wallet sign in endpoints. See src/lib/auth.ts for the flow.
import { Router } from "express";
import {
  SIGN_IN_MESSAGE, issueNonce, consumeNonce, parseFullMessage, isAllowedApplication,
  normalizeWallet, sameWallet, verifyWalletSignature, createSession, revokeSession,
  requireAuth, authOf,
} from "../lib/auth.js";
import { limitAuth } from "../lib/guard.js";

const router = Router();

// ── GET /api/auth/nonce ─────────────────────────────────────────────────────
// A one time nonce and the exact message the wallet must sign.
router.get("/nonce", limitAuth, async (_req, res) => {
  try {
    const { nonce, expiresAt } = await issueNonce();
    return res.json({ nonce, message: SIGN_IN_MESSAGE, expiresAt });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/verify ───────────────────────────────────────────────────
// Body: { address, publicKey, signature, fullMessage, nonce }
router.post("/verify", limitAuth, async (req, res) => {
  try {
    const { address, publicKey, signature, fullMessage, nonce } = req.body as Record<string, unknown>;
    const wallet = normalizeWallet(address);
    if (!wallet) return res.status(400).json({ error: "A valid wallet address is required" });
    if (typeof publicKey !== "string" || typeof signature !== "string" ||
        typeof fullMessage !== "string" || typeof nonce !== "string" ||
        fullMessage.length > 2000 || publicKey.length > 4000 || signature.length > 20000) {
      return res.status(400).json({ error: "publicKey, signature, fullMessage and nonce are required" });
    }

    const fail = (reason: string, status = 401) => {
      // Shape only, never the signature. Lets a wallet that formats its
      // message differently be diagnosed from the logs.
      console.warn(`[auth] sign in refused: ${reason}; lines=${JSON.stringify(fullMessage.split("\n").map((l) => l.split(": ")[0]))}`);
      return res.status(status).json({ error: `Sign in failed: ${reason}.`, code: "sign_in_failed" });
    };

    const parsed = parseFullMessage(fullMessage, nonce);
    if (!parsed.ok) return fail(parsed.reason);
    if (!sameWallet(parsed.data.address, wallet)) return fail("the signed address is a different wallet");
    if (!isAllowedApplication(parsed.data.application)) {
      return fail(`this site address is not allowed to sign in (${parsed.data.application.slice(0, 80)})`, 403);
    }

    // Burn the nonce before the expensive check, so a nonce can never be
    // tried twice, valid signature or not.
    if (!(await consumeNonce(nonce))) return fail("the sign in request expired or was already used, please try again");

    const sig = await verifyWalletSignature({ address: wallet, publicKey, signature, fullMessage });
    if (!sig.ok) return fail(sig.reason);

    const session = await createSession(wallet);
    return res.json({ token: session.token, expiresAt: session.expiresAt, wallet });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ────────────────────────────────────────────────────────
router.get("/me", requireAuth, (req, res) => {
  const a = authOf(req)!;
  return res.json({ wallet: a.wallet, expiresAt: a.expiresAt });
});

// ── POST /api/auth/logout ───────────────────────────────────────────────────
router.post("/logout", requireAuth, async (req, res) => {
  try {
    await revokeSession(authOf(req)!.tokenHash);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
