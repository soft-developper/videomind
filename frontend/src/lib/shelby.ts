// src/lib/shelby.ts
// Shelby browser client — uses string "testnet" instead of Network enum
// to avoid type conflicts between @aptos-labs/ts-sdk versions.
import { ShelbyClient } from "@shelby-protocol/sdk/browser";

export const shelbyClient = new ShelbyClient({
  network: "testnet" as any,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
});

// 47-hour expiry in microseconds (1hr buffer under 48hr testnet cap)
export function expirationMicros(): number {
  return Date.now() * 1000 + 47 * 3_600_000_000;
}
