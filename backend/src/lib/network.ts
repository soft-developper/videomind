// src/lib/network.ts
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;
export const SHELBYNET_EXPLORER = "https://explorer.shelby.xyz/shelbynet";

// Shelby RPC (blob read/write gateway)
export const SHELBYNET_BLOB_GATEWAY = "https://api.shelbynet.shelby.xyz/shelby";

// Shelby's DEDICATED blob indexer -- not the generic Aptos chain indexer.
export const SHELBYNET_BLOB_INDEXER =
  "https://api.shelbynet.aptoslabs.com/nocode/v1/public/alias/shelby/shelbynet/v1/graphql";
