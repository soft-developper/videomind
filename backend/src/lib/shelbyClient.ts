// src/lib/shelbyClient.ts
// Shelby Testnet integration using official SDK
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import "dotenv/config";

// ── 48-hour testnet blob cap ───────────────────────────────────────────────
const MAX_EXPIRY_HOURS = 47;
const MICROS_PER_HOUR = 3_600_000_000;

export function expirationMicros(hours = MAX_EXPIRY_HOURS): number {
  return Date.now() * 1000 + hours * MICROS_PER_HOUR;
}

// ── Account singleton ──────────────────────────────────────────────────────
let _account: ReturnType<typeof Account.fromPrivateKey> | null = null;
export function getShelbyAccount() {
  if (_account) return _account;
  const rawKey = process.env.APTOS_PRIVATE_KEY;
  if (!rawKey) throw new Error("APTOS_PRIVATE_KEY not set in .env");
  _account = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(rawKey) });
  return _account;
}

// ── Client singleton ───────────────────────────────────────────────────────
let _client: ShelbyNodeClient | null = null;
export function getShelbyClient(): ShelbyNodeClient {
  if (_client) return _client;
  const apiKey = process.env.APTOS_API_KEY;
  if (!apiKey) throw new Error("APTOS_API_KEY not set in .env");
  _client = new ShelbyNodeClient({ network: Network.TESTNET, apiKey });
  return _client;
}

// ── Upload helper (used by renewal cron only now) ──────────────────────────
export async function uploadToShelby(
  blobData: Buffer,
  blobName: string
): Promise<{ blobName: string; accountAddress: string; txHash: string }> {
  const client = getShelbyClient();
  const signer = getShelbyAccount();

  const { transaction } = await client.upload({
    signer,
    blobData,
    blobName,
    expirationMicros: expirationMicros(),
  });

  return {
    blobName,
    accountAddress: signer.accountAddress.toString(),
    txHash: transaction.hash,
  };
}

// ── Download helper (used by renewal cron) ────────────────────────────────
export async function downloadFromShelby(
  blobName: string,
  ownerAddress: string
): Promise<Buffer> {
  const client = getShelbyClient();
  const blob = await client.download({
    account: ownerAddress,
    blobName,
  });

  const chunks: Buffer[] = [];
  for await (const chunk of blob.readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ── Blob metadata (used by renewal cron) ─────────────────────────────────
export async function getBlobMeta(blobName: string, ownerAddress: string) {
  const client = getShelbyClient();
  return client.coordination.getBlobMetadata({
    account: ownerAddress,
    name: blobName,
  });
}

/**
 * Construct the direct HTTP URL to stream a blob from Shelby testnet.
 * Per official docs: https://api.testnet.shelby.xyz/shelby/v1/blobs/<address>/<blobName>
 * The <video> tag can load this directly — no auth headers needed for reads.
 *
 * @param blobName  - e.g. "videomind/videos/{id}/raw.mp4"
 * @param ownerAddress - the wallet address that uploaded the blob (the user's Petra wallet)
 */
export function shelbyBlobUrl(blobName: string, ownerAddress: string): string {
  // blobName may contain slashes — do NOT encodeURIComponent the whole thing,
  // just encode each segment individually to preserve the path structure.
  const encodedPath = blobName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://api.testnet.shelby.xyz/shelby/v1/blobs/${ownerAddress}/${encodedPath}`;
}
