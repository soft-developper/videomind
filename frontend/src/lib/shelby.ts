// src/lib/shelby.ts
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";
import { SHELBYNET_URLS } from "./network";

export const shelbyClient = new ShelbyClient({
  network: Network.SHELBYNET,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
  // Explicitly target Shelby's own blob indexer. Without this the SDK
  // falls back to the generic Aptos chain indexer, whose `blobs` table
  // has a different schema and fails with
  // "field 'blob_name' not found in type: 'blobs'".
  indexer: {
    baseUrl: SHELBYNET_URLS.blobIndexer,
    apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
  },
} as any);

export function expirationMicros(): number {
  return Date.now() * 1000 + 47 * 3_600_000_000;
}
