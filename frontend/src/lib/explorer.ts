// src/lib/explorer.ts
//
// Shelbynet uses the standard Aptos Explorer with ?network=shelbynet.
// (explorer.shelby.xyz currently returns 429 -- do not link there.)
// Confirmed working: https://explorer.aptoslabs.com/?network=shelbynet

const BASE = "https://explorer.aptoslabs.com";
const NET = "shelbynet";

export const explorer = {
  account: (address: string) => `${BASE}/account/${address}?network=${NET}`,
  txnByVersion: (version: number | string) => `${BASE}/txn/${version}?network=${NET}`,
  object: (address: string) => `${BASE}/object/${address}?network=${NET}`,
  network: () => `${BASE}/?network=${NET}`,
};

// The Shelby contract that owns all blob state
export const SHELBY_DEPLOYER =
  "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

// Shelbynet blob indexer (GraphQL)
export const SHELBY_INDEXER = "https://api.shelbynet.shelby.xyz/v1/graphql";
