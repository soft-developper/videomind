// src/lib/topup.ts
// vm_topup: credits paid for with ShelbyUSD on shelbynet (Part 16b).
//
// The user's wallet sends ShelbyUSD to VideoMind's treasury with the
// standard fungible asset transfer (0x1::primary_fungible_store::transfer).
// The site then sends the transaction hash here, and the server reads that
// transaction from shelbynet itself. Nothing the browser says about the
// amount is believed. Credits are added when:
//   * it is a user transaction that succeeded on chain,
//   * it was sent by the wallet that is signed in,
//   * ShelbyUSD went into the treasury's primary ShelbyUSD store (that
//     store's address belongs to ShelbyUSD alone, so no other token counts),
//     counted as deposits less withdrawals of that store,
//   * and the hash was never added before (one row per hash, enforced by
//     the database).
// 1 ShelbyUSD is 1 dollar. ShelbyUSD has 8 decimals and credits are
// counted in micro dollars (6 decimals), so 100 units are 1 micro dollar.
//
// The server only needs the treasury's public address
// (TOPUP_TREASURY_ADDRESS on Render). It never holds the treasury's key.
// Probe of 20 Oct 2026 (claude/credits-plan.md): this check passed on a
// real transfer on shelbynet and refused a wrong receiver, amount and sender.
import crypto from "crypto";
import { SHELBYUSD_FA_METADATA_ADDRESS } from "@shelby-protocol/sdk/node";
import { AccountAddress } from "@aptos-labs/ts-sdk";
import { getDb } from "./db.js";
import { normalizeWallet } from "./auth.js";
import { getShelbyClient } from "./shelbyClient.js";
import { balanceOf, CreditsError, MICROS } from "./credits.js";

export const TOPUP_NETWORK = "shelbynet";
export const TOPUP_ASSET = SHELBYUSD_FA_METADATA_ADDRESS;
export const TOPUP_DECIMALS = 8;
const UNITS_PER_MICRO = 10 ** (TOPUP_DECIMALS - 6);
const FA_DEPOSIT = "0x1::fungible_asset::Deposit";
const FA_WITHDRAW = "0x1::fungible_asset::Withdraw";
/** The smallest and largest top up the Wallet page offers, in dollars. The server credits whatever really arrived. */
export const TOPUP_MIN_USD = 0.01;
export const TOPUP_MAX_USD = 1000;

const norm = (a: unknown): string | null => {
  if (typeof a !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(a)) return null;
  try { return AccountAddress.from(a, { maxMissingChars: 63 }).toStringLong().toLowerCase(); } catch { return null; }
};

export class TopupError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** The treasury address set on the server, or null when top ups are not set up. */
export function treasuryAddress(): string | null {
  return normalizeWallet(process.env.TOPUP_TREASURY_ADDRESS?.trim());
}

// ── the chain ────────────────────────────────────────────────────────────────
/** What this file asks of shelbynet. Tests pass their own. */
export interface Chain {
  /** The committed transaction, or null when the network does not know the hash. */
  transaction(hash: string): Promise<any | null>;
  /** The address of an owner's primary store for an asset. */
  primaryStore(owner: string, asset: string): Promise<string>;
  /** An owner's balance of an asset, in its smallest units. */
  balance(owner: string, asset: string): Promise<bigint>;
}

const notFound = (e: any) => e?.status === 404 || /not.?found|404/i.test(String(e?.message ?? e));

export const shelbynet: Chain = {
  async transaction(hash) {
    const aptos = getShelbyClient().aptos;
    let tx: any;
    try { tx = await aptos.getTransactionByHash({ transactionHash: hash }); }
    catch (e) { if (notFound(e)) return null; throw e; }
    if (tx?.type === "pending_transaction") {
      try { tx = await aptos.waitForTransaction({ transactionHash: hash, options: { timeoutSecs: 20, checkSuccess: false } }); }
      catch (e) { if (notFound(e)) return null; throw e; }
    }
    return tx;
  },
  async primaryStore(owner, asset) {
    const r = await getShelbyClient().aptos.view({
      payload: { function: "0x1::primary_fungible_store::primary_store_address", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [owner, asset] },
    });
    return String(r[0]);
  },
  async balance(owner, asset) {
    const r = await getShelbyClient().aptos.view({
      payload: { function: "0x1::primary_fungible_store::balance", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [owner, asset] },
    });
    return BigInt(String(r[0] ?? 0));
  },
};

// ── the check ────────────────────────────────────────────────────────────────
export interface TopupCheck { ok: boolean; why: string[]; units: bigint; version: number | null; at: number | null }

/**
 * Did this committed transaction move ShelbyUSD from `sender` into the
 * treasury? Answers the net amount that went into the treasury's store.
 */
export async function checkTopupTransaction(tx: any, a: { sender: string; treasury: string; chain: Chain }): Promise<TopupCheck> {
  const why: string[] = [];
  const out = (units: bigint): TopupCheck => ({
    ok: why.length === 0, why, units,
    version: tx?.version != null ? Number(tx.version) : null,
    at: tx?.timestamp != null ? Math.floor(Number(tx.timestamp) / 1000) : null,
  });
  if (!tx || tx.type !== "user_transaction") { why.push("not_user_transaction"); return out(0n); }
  if (tx.success !== true) { why.push("failed"); return out(0n); }
  const sender = norm(tx.sender);
  if (!sender || sender !== norm(a.sender)) why.push("wrong_sender");
  if (sender && sender === norm(a.treasury)) why.push("sent_by_treasury");
  const store = norm(await a.chain.primaryStore(a.treasury, TOPUP_ASSET));
  let units = 0n;
  for (const ev of tx.events ?? []) {
    if (ev?.type !== FA_DEPOSIT && ev?.type !== FA_WITHDRAW) continue;
    if (!store || norm(ev?.data?.store) !== store) continue;
    const amount = BigInt(String(ev?.data?.amount ?? 0));
    units += ev.type === FA_DEPOSIT ? amount : -amount;
  }
  if (units <= 0n) why.push("nothing_received");
  return out(units > 0n ? units : 0n);
}

// ── claiming ─────────────────────────────────────────────────────────────────
export interface TopupResult {
  added: boolean; alreadyAdded: boolean; amountMicros: number; txHash: string;
  balanceMicros: number; availableMicros: number;
}

const MESSAGES: Record<string, [number, string]> = {
  not_user_transaction: [400, "That transaction is not a transfer from a wallet."],
  failed: [400, "That transaction failed on shelbynet, so nothing was paid."],
  wrong_sender: [403, "That transaction was sent by a different wallet than the one signed in."],
  sent_by_treasury: [400, "That transaction was sent by VideoMind's own treasury."],
  nothing_received: [400, "That transaction did not send ShelbyUSD to VideoMind."],
};

/**
 * Add the credits a transfer paid for, once. Asking again for a hash this
 * wallet already added answers alreadyAdded and adds nothing.
 */
export async function claimTopup(walletIn: string, hashIn: unknown, chain: Chain = shelbynet): Promise<TopupResult> {
  const wallet = normalizeWallet(walletIn);
  if (!wallet) throw new CreditsError(400, "bad_wallet", "That is not a wallet address.");
  const treasury = treasuryAddress();
  if (!treasury) throw new TopupError(503, "topup_off", "Adding credits is not set up on this server yet.");
  const hash = typeof hashIn === "string" ? hashIn.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new TopupError(400, "bad_hash", "That is not a transaction hash.");

  const done = async (alreadyAdded: boolean, amountMicros: number): Promise<TopupResult> => {
    const b = await balanceOf(wallet);
    return { added: !alreadyAdded, alreadyAdded, amountMicros, txHash: hash, balanceMicros: b.balanceMicros, availableMicros: b.availableMicros };
  };
  const previous = async () => {
    const r = await getDb().execute({ sql: "SELECT wallet, amount_micros FROM credit_topups WHERE tx_hash = ?", args: [hash] });
    return r.rows[0] as any | undefined;
  };
  const seen = await previous();
  if (seen) {
    if (String(seen.wallet) !== wallet) throw new TopupError(409, "hash_used", "That transaction was already used by another wallet.");
    return done(true, Number(seen.amount_micros));
  }

  let tx: any;
  try { tx = await chain.transaction(hash); }
  catch (e: any) {
    console.error(`[topup] reading ${hash}: ${e?.message ?? e}`);
    throw new TopupError(503, "chain_unreachable", "shelbynet could not be reached. Your transfer is safe; try again in a minute.");
  }
  if (!tx) throw new TopupError(404, "tx_not_found", "That transaction was not found on shelbynet yet. Wait a minute and try again.");
  const check = await checkTopupTransaction(tx, { sender: wallet, treasury, chain });
  if (!check.ok) {
    const [status, message] = MESSAGES[check.why[0]] ?? [400, "That transaction did not send ShelbyUSD to VideoMind."];
    throw new TopupError(status, check.why[0], message);
  }
  const micros = Number(check.units / BigInt(UNITS_PER_MICRO));
  if (micros <= 0) throw new TopupError(400, "too_small", "That transfer is too small to add: the least is 0.000001 ShelbyUSD.");

  const entryId = crypto.randomUUID(), now = Date.now();
  try {
    await getDb().batch([
      {
        sql: `INSERT INTO credit_topups (tx_hash, wallet, network, asset, treasury, amount_units, amount_micros, entry_id, tx_version, tx_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [hash, wallet, TOPUP_NETWORK, TOPUP_ASSET, treasury, check.units.toString(), micros, entryId, check.version, check.at, now],
      },
      {
        sql: `INSERT INTO credit_entries (id, wallet, at, kind, amount_micros, ref, idempotency_key) VALUES (?, ?, ?, 'topup', ?, ?, ?)`,
        args: [entryId, wallet, now, micros, hash, `topup:${hash}`],
      },
    ], "write");
  } catch (e: any) {
    // The same hash sent twice at once: the second write meets the first one's row.
    const again = await previous();
    if (again && String(again.wallet) === wallet) return done(true, Number(again.amount_micros));
    if (again) throw new TopupError(409, "hash_used", "That transaction was already used by another wallet.");
    throw e;
  }
  console.log(`[topup] ${wallet} +${micros / MICROS} USD from ${hash}`);
  return done(false, micros);
}

/** What the Wallet page needs to send a top up, and the wallet's ShelbyUSD. */
export async function topupInfo(walletIn: string, chain: Chain = shelbynet) {
  const wallet = normalizeWallet(walletIn);
  const treasury = treasuryAddress();
  let walletUnits: string | null = null;
  if (treasury && wallet) {
    try { walletUnits = (await chain.balance(wallet, TOPUP_ASSET)).toString(); }
    catch (e: any) { console.warn(`[topup] reading a ShelbyUSD balance: ${e?.message ?? e}`); }
  }
  return {
    enabled: !!treasury, network: TOPUP_NETWORK, asset: TOPUP_ASSET, symbol: "ShelbyUSD", decimals: TOPUP_DECIMALS,
    treasury, minUsd: TOPUP_MIN_USD, maxUsd: TOPUP_MAX_USD, walletUnits,
  };
}

/** Top ups for the dashboard, newest first. */
export async function listTopups(limit = 50) {
  const r = await getDb().execute({ sql: "SELECT * FROM credit_topups ORDER BY created_at DESC LIMIT ?", args: [Math.max(1, Math.min(200, limit))] });
  return (r.rows as any[]).map((x) => ({
    txHash: String(x.tx_hash), wallet: String(x.wallet), network: String(x.network), amountMicros: Number(x.amount_micros),
    txAt: x.tx_at == null ? null : Number(x.tx_at), createdAt: Number(x.created_at),
  }));
}
