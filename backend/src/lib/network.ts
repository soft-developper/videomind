// src/lib/network.ts
import { Network } from "@aptos-labs/ts-sdk";

export const SHELBYNET_NETWORK = Network.SHELBYNET;
export const SHELBYNET_EXPLORER = "https://explorer.shelby.xyz/shelbynet";

// Blob HTTP gateway — verified from @shelby-protocol/sdk's own constants
// (NetworkToShelbyRPCBaseUrl[Network.SHELBYNET]).
// Confirmed live from docs.shelby.xyz/protocol/architecture/networks
export const SHELBYNET_BLOB_GATEWAY = "https://api.shelbynet.shelby.xyz/shelby";
