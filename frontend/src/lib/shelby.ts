// src/lib/shelby.ts
// Matches the official Shelby DApp example exactly:
// https://docs.shelby.xyz/sdks/react/guides/dapp-example
//
// The docs create the client with ONLY `network`. Do not add a manual
// `indexer` override -- that overrides the SDK's own internal resolution
// and pointed us at the generic Aptos chain indexer instead of Shelby's
// blob indexer.
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";

export const shelbyClient = new ShelbyClient({
  network: Network.SHELBYNET,
});

export function expirationMicros(): number {
  // 47h, staying under shelbynet's 48h cap
  return Date.now() * 1000 + 47 * 60 * 60 * 1000 * 1000;
}
