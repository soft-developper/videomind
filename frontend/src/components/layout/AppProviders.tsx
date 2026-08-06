"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { ShelbyClientProvider } from "@shelby-protocol/react";
import { AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { useState, useMemo } from "react";
import { shelbyClient } from "@/lib/shelby";
import { SHELBYNET } from "@/lib/network";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 10_000 } },
  }));

  // dappConfig expects an AptosConfig instance, not a plain object with
  // network/fullnode/faucet as loose top-level keys.
  const aptosConfig = useMemo(() => new AptosConfig({
    network: Network.CUSTOM,
    fullnode: SHELBYNET.fullnode,
    faucet: SHELBYNET.faucet,
  }), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AptosWalletAdapterProvider
        autoConnect
        dappConfig={aptosConfig as any}
        onError={(error) => console.error("[Wallet]", error)}
      >
        <ShelbyClientProvider client={shelbyClient}>
          {children}
        </ShelbyClientProvider>
      </AptosWalletAdapterProvider>
    </QueryClientProvider>
  );
}
