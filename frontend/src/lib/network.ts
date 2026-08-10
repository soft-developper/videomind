// src/lib/network.ts
//
// Official shelbynet URLs — confirmed live from docs.shelby.xyz on the
// Networks reference page (docs.shelby.xyz/protocol/architecture/networks).
// Shelby explicitly documents that shelbynet infra "will be wiped roughly
// once a week, or faster" -- these are hardcoded from the live docs as
// the source of truth rather than trusted purely from whatever an npm
// package bundled, which can drift between shelbynet redeployments.
//
// Network.SHELBYNET is also a first-class named network in
// @aptos-labs/ts-sdk (MAINNET | TESTNET | DEVNET | SHELBYNET | NETNA |
// LOCAL | CUSTOM) -- pass that enum directly to dappConfig, never
// Network.CUSTOM (that crashes the wallet adapter's bundled AptosConnect
// plugin with "Error: Network not supported").
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;

export const SHELBYNET_URLS = {
  fullnode: "https://api.shelbynet.shelby.xyz/v1",
  indexer: "https://api.shelbynet.shelby.xyz/v1/graphql",
  shelbyRpc: "https://api.shelbynet.shelby.xyz/shelby",
  faucet: "https://faucet.shelbynet.shelby.xyz",
  explorer: "https://explorer.shelby.xyz/shelbynet",
} as const;

export const SHELBYNET_EXPLORER = SHELBYNET_URLS.explorer;
