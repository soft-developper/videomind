// src/lib/shelby.ts
//
// locationHint is REQUIRED. Traced through the SDK:
//
//   ShelbyClient constructor:
//     this.defaultOptions = { locationHint: config.locationHint, ... }
//   At write time:
//     selectedLocation: options?.selectedLocation ?? defaultOptions.selectedLocation
//     locationHint:     options?.locationHint     ?? defaultOptions.locationHint
//
// With neither set, the on-chain Move contract rejects the write:
//   "The account has no preference set and the write supplied no
//    location input"
//
// "us-east-1" is the value that appears in the SDK's own source. If the
// live-network probe above shows a different location, use that instead.
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBY_LOCATION = "us-east-1";

export const shelbyClient = new ShelbyClient({
  network: Network.SHELBYNET,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
  locationHint: SHELBY_LOCATION,
});

export function expirationMicros(): number {
  // 47h, under shelbynet's 48h cap
  return Date.now() * 1000 + 47 * 60 * 60 * 1000 * 1000;
}
