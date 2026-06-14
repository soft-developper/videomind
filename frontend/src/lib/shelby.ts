// src/lib/shelby.ts
// Shared Shelby browser client instance — used by @shelby-protocol/react hooks.
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";

export const shelbyClient = new ShelbyClient({
  network: Network.TESTNET,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
});

// 47-hour expiry (48hr testnet cap with 1hr buffer), in microseconds
export function expirationMicros(): number {
  return Date.now() * 1000 + 47 * 3_600_000_000;
}
