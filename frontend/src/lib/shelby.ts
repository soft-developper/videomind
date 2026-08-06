// src/lib/shelby.ts
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { SHELBYNET } from "./network";

export const shelbyClient = new ShelbyClient({
  network: "shelbynet" as any,
  fullnode: SHELBYNET.fullnode,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
} as any);

export function expirationMicros(): number {
  return Date.now() * 1000 + 47 * 3_600_000_000;
}
