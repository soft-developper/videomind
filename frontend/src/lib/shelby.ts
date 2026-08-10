// src/lib/shelby.ts
// Follows the official DApp example, plus the apiKey the docs require:
//   https://docs.shelby.xyz/sdks/react/guides/dapp-example
//   https://docs.shelby.xyz/sdks/typescript/acquire-api-keys
//
// Do NOT add a manual `indexer` override here -- that overrides the SDK's
// own resolution and sends queries to the generic Aptos chain indexer,
// whose `blobs` table has a different schema entirely.
//
// The apiKey IS required though. Verified in the SDK source:
//   const apiKey = indexerApiKey ?? config.apiKey;
//   headers: { ...apiKey ? { Authorization: `Bearer ${apiKey}` } : {} }
// Without it no Authorization header is sent and the indexer returns 401.
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";

export const shelbyClient = new ShelbyClient({
  network: Network.SHELBYNET,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
});

export function expirationMicros(): number {
  // 47h, under shelbynet's 48h cap
  return Date.now() * 1000 + 47 * 60 * 60 * 1000 * 1000;
}
