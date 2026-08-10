// src/lib/network.ts
//
// IMPORTANT — there are TWO different indexers in play on shelbynet:
//
//   1. Generic Aptos chain indexer (what @aptos-labs/ts-sdk resolves
//      Network.SHELBYNET to by default):
//        https://api.shelbynet.shelby.xyz/v1/graphql
//      This has a `blobs` table, but it is NOT Shelby's blob index --
//      different schema entirely. Querying it for blob_name fails with
//      "field 'blob_name' not found in type: 'blobs'".
//
//   2. Shelby's DEDICATED blob indexer (from @shelby-protocol/sdk's own
//      constants) -- this is the one with the real blob schema:
//        https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql
//
// We pass #2 explicitly so the SDK never falls back to #1.
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;

export const SHELBYNET_URLS = {
  fullnode: "https://api.shelbynet.shelby.xyz/v1",
  shelbyRpc: "https://api.shelbynet.shelby.xyz/shelby",
  faucet: "https://faucet.shelbynet.shelby.xyz",
  explorer: "https://explorer.aptoslabs.com/?network=shelbynet",

  // Shelby's dedicated blob indexer -- NOT the generic Aptos one.
  blobIndexer:
    "https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql",
} as const;

export const SHELBYNET_EXPLORER = SHELBYNET_URLS.explorer;
