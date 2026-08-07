// src/lib/network.ts
// Network.SHELBYNET is a first-class named network in @aptos-labs/ts-sdk —
// verified directly from the SDK's own Network enum:
//   MAINNET | TESTNET | DEVNET | SHELBYNET | NETNA | LOCAL | CUSTOM
//
// The SDK's internal endpoint maps (NetworkToNodeAPI, NetworkToFaucetAPI,
// NetworkToIndexerAPI) already resolve Network.SHELBYNET to the correct
// URLs — there is no need to hand-construct an AptosConfig or pass
// Network.CUSTOM. Doing so is what causes the wallet adapter's bundled
// AptosConnect plugin to throw "Error: Network not supported" at mount.
//
// Shelby Testnet is retired: @shelby-protocol/sdk's own constants file
// literally comments "// Shelby Testnet has been retired." next to a
// disabled Network.TESTNET entry.
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;

// Explorer isn't in the SDK's endpoint maps — construct manually.
export const SHELBYNET_EXPLORER = "https://explorer.shelby.xyz/shelbynet";
