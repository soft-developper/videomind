// src/lib/auth.ts
// vm_signin: wallet sign in, sessions and the request guards built on them.
//
// Flow:
//   1. GET  /api/auth/nonce   the server issues a one time nonce.
//   2. The wallet signs a message containing that nonce (signMessage,
//      which every Aptos wallet supports).
//   3. POST /api/auth/verify  the server checks the signature, that the
//      public key controls the address, that the wallet itself stamped
//      an allowed site address on the message, and that the nonce is
//      fresh. It then opens a session and returns a bearer token.
//   4. Later requests send  Authorization: Bearer <token>.
//
// The token is a bearer token, not a cookie, because the frontend and the
// API live on different sites and browsers block cross site cookies.
// Only a SHA 256 hash of each token is stored.
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import {
  AccountAddress,
  AnyPublicKey,
  AnySignature,
  Aptos,
  AptosConfig,
  Deserializer,
  Ed25519PublicKey,
  Ed25519Signature,
  Hex,
  MultiEd25519PublicKey,
  MultiEd25519Signature,
  MultiKey,
  MultiKeySignature,
  Network,
} from "@aptos-labs/ts-sdk";
import { getDb } from "./db.js";

export const SIGN_IN_MESSAGE =
  "Sign in to VideoMind. This proves you own this wallet. It costs no gas and moves no funds.";

const NONCE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const CACHE_TTL_MS = 30_000;

// ── Addresses ───────────────────────────────────────────────────────────────

/** Canonical form: 0x + 64 lower case hex. Returns null if not an address. */
export function normalizeWallet(v: unknown): string | null {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(v)) return null;
  try {
    return AccountAddress.from(v, { maxMissingChars: 63 }).toStringLong().toLowerCase();
  } catch {
    return null;
  }
}

export function sameWallet(a: unknown, b: unknown): boolean {
  const x = normalizeWallet(a);
  return x !== null && x === normalizeWallet(b);
}

// ── Allowed sites ───────────────────────────────────────────────────────────

/** The frontends allowed to sign users in: the same list CORS uses. */
export function allowedOrigins(): string[] {
  return (process.env.FRONTEND_URL ?? "http://localhost:3000")
    .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
}

/**
 * True if the site address a wallet stamped on the message is one of ours.
 * Wallets differ on whether they write the full origin or only the host,
 * so both are accepted.
 */
export function isAllowedApplication(app: string): boolean {
  const value = app.trim().replace(/\/+$/, "").toLowerCase();
  return allowedOrigins().some((o) => {
    try {
      const u = new URL(o);
      return value === u.origin.toLowerCase() || value === u.host.toLowerCase();
    } catch {
      return false;
    }
  });
}

// ── The signed message ──────────────────────────────────────────────────────

export interface ParsedMessage { address: string; application: string; chainId?: string }

/**
 * Check the structure of the wallet's fullMessage and pull out the fields
 * the WALLET wrote. Returns a reason string on failure.
 *
 * The message and the nonce come from the page, so an attacker's page can
 * put anything in them, including fake "application: ..." lines. The rule
 * that defeats this: the wallet's own fields (address, application,
 * chainId) must all come BEFORE the first nonce or message line, and the
 * rest must be exactly our message line and our nonce line, nothing else.
 *
 * vm_keyless: Petra Web (the Google and Apple wallets, Aptos Connect)
 * writes the message and the nonce as 0x hex of their UTF 8 text, for
 * example "nonce: 0x3941...". Either form is accepted, but only if it is
 * exactly our text: the hex is decoded and compared, never trusted.
 */
export function parseFullMessage(
  fullMessage: string,
  nonce: string
): { ok: true; data: ParsedMessage } | { ok: false; reason: string } {
  const lines = fullMessage.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "APTOS") return { ok: false, reason: "message does not start with APTOS" };

  const cut = lines.findIndex((l, i) => i > 0 && (l.startsWith("nonce: ") || l.startsWith("message: ")));
  if (cut < 0) return { ok: false, reason: "message has no nonce or message line" };

  const header: Record<string, string> = {};
  for (const line of lines.slice(1, cut)) {
    const m = /^(address|application|chainId): (.+)$/.exec(line);
    if (!m) return { ok: false, reason: "unexpected line before the message" };
    if (m[1] in header) return { ok: false, reason: `duplicate ${m[1]} line` };
    header[m[1]] = m[2];
  }

  const trailer = lines.slice(cut);
  const plain = (value: string) => {
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) return value;
    const text = Buffer.from(value.slice(2), "hex").toString("utf8");
    return Buffer.from(text, "utf8").toString("hex") === value.slice(2).toLowerCase() ? text : value;
  };
  const is = (line: string, field: "message" | "nonce", want: string) => {
    if (!line.startsWith(`${field}: `)) return false;
    const value = line.slice(field.length + 2);
    return value === want || plain(value) === want;
  };
  const okTrailer = trailer.length === 2 && (
    (is(trailer[0], "message", SIGN_IN_MESSAGE) && is(trailer[1], "nonce", nonce)) ||
    (is(trailer[0], "nonce", nonce) && is(trailer[1], "message", SIGN_IN_MESSAGE))
  );
  if (!okTrailer) return { ok: false, reason: "message text or nonce does not match what was issued" };

  if (!header.address) return { ok: false, reason: "wallet did not include its address" };
  if (!header.application) return { ok: false, reason: "wallet did not include the site address" };
  return { ok: true, data: { address: header.address, application: header.application, chainId: header.chainId } };
}

// ── Signature verification ──────────────────────────────────────────────────

let _aptos: Aptos | null = null;
function aptos(): Aptos {
  if (_aptos) return _aptos;
  const apiKey = process.env.APTOS_API_KEY;
  _aptos = new Aptos(new AptosConfig({
    network: Network.SHELBYNET,
    ...(apiKey ? { clientConfig: { API_KEY: apiKey } } : {}),
  }));
  return _aptos;
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

/**
 * The address a public key must derive to. Normally that is the account
 * address itself. If the account rotated its key, the chain holds a
 * different authentication key, so that is looked up first. If the chain
 * cannot be reached, or the account does not exist there yet, the address
 * is used (correct for every account that never rotated).
 */
async function expectedAuthAddress(address: string): Promise<string> {
  try {
    const info = await timeout(aptos().getAccountInfo({ accountAddress: address }), 5000);
    return normalizeWallet(info.authentication_key) ?? address;
  } catch {
    return address;
  }
}

function parseBcs<T>(hex: string, read: (d: Deserializer) => T): T | null {
  try {
    const d = new Deserializer(Hex.fromHexInput(hex).toUint8Array());
    const v = read(d);
    return d.remaining() === 0 ? v : null;
  } catch {
    return null;
  }
}

function rawLen(hex: string): number {
  try { return Hex.fromHexInput(hex).toUint8Array().length; } catch { return -1; }
}

// Each key scheme with its matching signature type. The frontend sends BCS
// bytes without naming the scheme. Only the right scheme both parses and
// derives the right address, so trying each in turn is unambiguous.
const SCHEMES: Array<{
  name: string;
  key: (hex: string) => any | null;
  sig: (hex: string) => any | null;
}> = [
  {
    name: "ed25519",
    key: (h) => parseBcs(h, (d) => Ed25519PublicKey.deserialize(d)) ?? (rawLen(h) === 32 ? new Ed25519PublicKey(h) : null),
    sig: (h) => parseBcs(h, (d) => Ed25519Signature.deserialize(d)) ?? (rawLen(h) === 64 ? new Ed25519Signature(h) : null),
  },
  { name: "single_key",    key: (h) => parseBcs(h, (d) => AnyPublicKey.deserialize(d)),           sig: (h) => parseBcs(h, (d) => AnySignature.deserialize(d)) },
  { name: "multi_key",     key: (h) => parseBcs(h, (d) => MultiKey.deserialize(d)),               sig: (h) => parseBcs(h, (d) => MultiKeySignature.deserialize(d)) },
  { name: "multi_ed25519", key: (h) => parseBcs(h, (d) => MultiEd25519PublicKey.deserialize(d)),  sig: (h) => parseBcs(h, (d) => MultiEd25519Signature.deserialize(d)) },
];

/**
 * True if `signature` is a valid signature of `fullMessage` by a key that
 * controls `address`. Mirrors the wallet adapter's own signMessageAndVerify:
 * the signed bytes are the UTF 8 bytes of fullMessage.
 */
export async function verifyWalletSignature(args: {
  address: string;
  publicKey: string;
  signature: string;
  fullMessage: string;
}): Promise<{ ok: true; scheme: string } | { ok: false; reason: string }> {
  const address = normalizeWallet(args.address);
  if (!address) return { ok: false, reason: "invalid address" };

  const authAddress = await expectedAuthAddress(address);
  const message = new TextEncoder().encode(args.fullMessage);
  let keyMatched = false;

  for (const s of SCHEMES) {
    const key = s.key(args.publicKey);
    if (!key) continue;
    let derived: string | null = null;
    try { derived = normalizeWallet(key.authKey().derivedAddress().toString()); } catch { derived = null; }
    if (!derived || derived !== authAddress) continue;
    keyMatched = true;

    const sig = s.sig(args.signature);
    if (!sig) continue;
    try {
      const good = await timeout(
        key.verifySignatureAsync({ aptosConfig: aptos().config, message, signature: sig }) as Promise<boolean>,
        15_000
      );
      if (good) return { ok: true, scheme: s.name };
    } catch {
      // fall through to the next scheme
    }
  }
  return { ok: false, reason: keyMatched ? "signature is not valid" : "public key does not control this address" };
}

// ── Nonces ──────────────────────────────────────────────────────────────────

export async function issueNonce(): Promise<{ nonce: string; expiresAt: number }> {
  const nonce = crypto.randomBytes(18).toString("base64url");
  const now = Date.now();
  const expiresAt = now + NONCE_TTL_MS;
  const db = getDb();
  await db.batch([
    { sql: "DELETE FROM auth_nonces WHERE expires_at < ?", args: [now - 60_000] },
    { sql: "INSERT INTO auth_nonces (nonce, created_at, expires_at) VALUES (?, ?, ?)", args: [nonce, now, expiresAt] },
  ], "write");
  return { nonce, expiresAt };
}

/** Use a nonce exactly once. False if unknown, expired or already used. */
export async function consumeNonce(nonce: string): Promise<boolean> {
  const now = Date.now();
  const r = await getDb().execute({
    sql: "UPDATE auth_nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at > ?",
    args: [now, nonce, now],
  });
  return r.rowsAffected === 1;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface AuthContext { userId: string; wallet: string; expiresAt: number; tokenHash: string }

const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const cache = new Map<string, { ctx: AuthContext; at: number }>();

export async function createSession(wallet: string): Promise<{ token: string; expiresAt: number; userId: string }> {
  const db = getDb();
  const now = Date.now();
  const newId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO users (id, wallet_address, created_at, last_seen_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(wallet_address) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    args: [newId, wallet, now, now],
  });
  const u = await db.execute({ sql: "SELECT id FROM users WHERE wallet_address = ?", args: [wallet] });
  const userId = String((u.rows[0] as Record<string, unknown>).id);

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;
  await db.batch([
    { sql: "DELETE FROM sessions WHERE expires_at < ?", args: [now] },
    { sql: "INSERT INTO sessions (token_hash, user_id, wallet_address, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      args: [hashToken(token), userId, wallet, now, expiresAt] },
  ], "write");
  return { token, expiresAt, userId };
}

async function lookupSession(token: string): Promise<AuthContext | null> {
  const tokenHash = hashToken(token);
  const now = Date.now();
  const hit = cache.get(tokenHash);
  if (hit && now - hit.at < CACHE_TTL_MS && hit.ctx.expiresAt > now) return hit.ctx;

  const r = await getDb().execute({
    sql: "SELECT user_id, wallet_address, expires_at FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    args: [tokenHash, now],
  });
  if (r.rows.length === 0) { cache.delete(tokenHash); return null; }
  const row = r.rows[0] as Record<string, unknown>;
  const ctx: AuthContext = {
    userId: String(row.user_id),
    wallet: String(row.wallet_address),
    expiresAt: Number(row.expires_at),
    tokenHash,
  };
  cache.set(tokenHash, { ctx, at: now });
  return ctx;
}

export async function revokeSession(tokenHash: string): Promise<void> {
  cache.delete(tokenHash);
  await getDb().execute({ sql: "UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", args: [Date.now(), tokenHash] });
}

// ── Request guards ──────────────────────────────────────────────────────────

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(h.trim());
  return m ? m[1] : null;
}

/** The signed in caller, or undefined. Set by optionalAuth / requireAuth. */
export function authOf(req: Request): AuthContext | undefined {
  return (req as Request & { auth?: AuthContext }).auth;
}

/** Attach the session if a valid token was sent. Never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (token) {
      const ctx = await lookupSession(token);
      if (ctx) (req as Request & { auth?: AuthContext }).auth = ctx;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Reject with 401 unless a valid session token was sent. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    const ctx = token ? await lookupSession(token) : null;
    if (!ctx) return res.status(401).json({ error: "Sign in with your wallet to continue.", code: "auth_required" });
    (req as Request & { auth?: AuthContext }).auth = ctx;
    next();
  } catch (err) {
    next(err);
  }
}

/** Test hook. */
export function _clearAuthCache() { cache.clear(); }
