// src/lib/shelbyClient.ts
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { Ed25519Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import "dotenv/config";

const MAX_EXPIRY_HOURS = 47;
const MICROS_PER_HOUR = 3_600_000_000;

export function expirationMicros(hours = MAX_EXPIRY_HOURS): number {
  return Date.now() * 1000 + hours * MICROS_PER_HOUR;
}

// ── Account singleton ──────────────────────────────────────────────────────
// Use Ed25519Account directly — avoids the SingleKeyAccount type mismatch
// that occurs with Account.fromPrivateKey() in @aptos-labs/ts-sdk v6.
let _account: Ed25519Account | null = null;
export function getShelbyAccount(): Ed25519Account {
  if (_account) return _account;
  const rawKey = process.env.APTOS_PRIVATE_KEY;
  if (!rawKey) throw new Error("APTOS_PRIVATE_KEY not set in .env");
  _account = new Ed25519Account({
    privateKey: new Ed25519PrivateKey(rawKey),
  });
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

// ── Upload helper ──────────────────────────────────────────────────────────
export async function uploadToShelby(
  blobData: Buffer,
  blobName: string
): Promise<{ blobName: string; accountAddress: string; txHash: string }> {
  const client = getShelbyClient();
  const signer = getShelbyAccount();

  // client.upload() returns void in some SDK versions — handle both cases
  const result = await client.upload({
    signer,
    blobData,
    blobName,
    expirationMicros: expirationMicros(),
  }) as { transaction?: { hash: string } } | void;

  const txHash =
    result && typeof result === "object" && result.transaction
      ? result.transaction.hash
      : `upload-${Date.now()}`;

  return {
    blobName,
    accountAddress: signer.accountAddress.toString(),
    txHash,
  };
}

// ── Download helper ────────────────────────────────────────────────────────
export async function downloadFromShelby(
  blobName: string,
  ownerAddress: string
): Promise<Buffer> {
  const client = getShelbyClient();
  const blob = await client.download({ account: ownerAddress, blobName });
  const chunks: Buffer[] = [];
  for await (const chunk of blob.readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ── Blob metadata ─────────────────────────────────────────────────────────
export async function getBlobMeta(blobName: string, ownerAddress: string) {
  const client = getShelbyClient();
  return client.coordination.getBlobMetadata({
    account: ownerAddress,
    name: blobName,
  });
}

// ── Stream URL ────────────────────────────────────────────────────────────
export function shelbyBlobUrl(blobName: string, ownerAddress: string): string {
  const encodedPath = blobName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://api.testnet.shelby.xyz/shelby/v1/blobs/${ownerAddress}/${encodedPath}`;
}
