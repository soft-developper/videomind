// src/lib/network.ts
// Shelbynet is a separate, isolated Aptos validator network — NOT the
// standard Aptos Testnet. Every URL below is specific to it.
// Ref: https://docs.shelby.xyz/protocol/architecture/networks

export const SHELBYNET = {
  name: "shelbynet",
  fullnode: "https://api.shelbynet.shelby.xyz/v1",
  faucet: "https://faucet.shelbynet.shelby.xyz",
  indexer: "https://api.shelbynet.shelby.xyz/v1/graphql",
  blobGateway: "https://api.shelbynet.shelby.xyz/shelby",
  explorer: "https://explorer.shelby.xyz/shelbynet",
} as const;
