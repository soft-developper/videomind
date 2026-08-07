"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { ShelbyClientProvider } from "@shelby-protocol/react";
import { Network } from "@aptos-labs/ts-sdk";
import { useState } from "react";
import { shelbyClient } from "@/lib/shelby";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 10_000 } },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <AptosWalletAdapterProvider
        autoConnect
        dappConfig={{
          // Network.SHELBYNET is a real enum member — the SDK already
          // knows its fullnode, faucet and indexer internally.
          // Do NOT use Network.CUSTOM here; it crashes the bundled
          // AptosConnect wallet plugin at mount with
          // "Error: Network not supported".
          network: Network.SHELBYNET,
          aptosApiKeys: {
            [Network.SHELBYNET]: process.env.NEXT_PUBLIC_APTOS_API_KEY,
          },
        }}
        onError={(error) => console.error("[Wallet]", error)}
      >
        <ShelbyClientProvider client={shelbyClient}>
          {children}
        </ShelbyClientProvider>
      </AptosWalletAdapterProvider>
    </QueryClientProvider>
  );
}
