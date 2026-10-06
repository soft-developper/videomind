// src/lib/shelby.ts
//
// SHELBY_LOCATION must be a name registered in the on-chain
// LocationRegistry. Read directly from the contract:
//
//   view 0x85fd...8e6a::location::activated_location_names()
//     -> [["shelbynet-1"]]
//
// That is currently the ONLY activated location on shelbynet. Verified
// against a real successful upload, whose placement group resolves to
// the same location object (0x1a2105f2...369b) held by the registry.
//
// locationHint is required -- the ShelbyClient constructor stores it as
// defaultOptions.locationHint, and the Move contract rejects any write
// that supplies neither a location nor an account preference.
import { ShelbyClient } from "@shelby-protocol/sdk/browser";
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBY_LOCATION = "shelbynet-1";

export const shelbyClient = new ShelbyClient({
  network: Network.SHELBYNET,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
  locationHint: SHELBY_LOCATION,
});

// vm_shelby09d: no expirationMicros helper any more. Storage is prepaid
// in payment epochs by the contract at registration; the app neither
// sets an expiry nor renews. See src/lib/onchain.ts for the paid-until date.
