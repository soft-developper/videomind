// src/lib/network.ts
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;
export const SHELBYNET_EXPLORER = "https://explorer.shelby.xyz/shelbynet";

// Blob HTTP gateway — verified from @shelby-protocol/sdk's own constants
// (NetworkToShelbyRPCBaseUrl[Network.SHELBYNET]).
export const SHELBYNET_BLOB_GATEWAY = "https://shelby.shelbynet.shelby.xyz/shelby";
