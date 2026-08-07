// src/lib/shelby.ts
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";

export const shelbyClient = new ShelbyClient({
  network: Network.SHELBYNET,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
});

export function expirationMicros(): number {
  return Date.now() * 1000 + 47 * 3_600_000_000;
}
