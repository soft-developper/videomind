"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { ShelbyClientProvider } from "@shelby-protocol/react";
import { useState } from "react";
import { shelbyClient } from "@/lib/shelby";
import { SHELBYNET } from "@/lib/network";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 10_000 } },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <AptosWalletAdapterProvider
        autoConnect
        dappConfig={{
          // Shelbynet is a custom Aptos network — not testnet/mainnet/devnet.
          // Petra must have this same network added under Settings → Network
          // → Add Network, or switched to it if already present.
          network: "custom" as any,
          fullnode: SHELBYNET.fullnode,
          faucet: SHELBYNET.faucet,
          aptosApiKeys: {
            shelbynet: process.env.NEXT_PUBLIC_APTOS_API_KEY,
          } as any,
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
