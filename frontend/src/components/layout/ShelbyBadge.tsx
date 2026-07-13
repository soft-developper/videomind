"use client";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function ShelbyBadge() {
  const { connected, account } = useWallet();
  const wallet = account?.address?.toString();

  const { data } = useQuery({
    queryKey: ["shelby-badge", wallet],
    queryFn: async () => {
      const r = await api.get("/api/shelby/stats", { params: { wallet } });
      return r.data as { blobCount: number };
    },
    refetchInterval: 30_000,
    enabled: !!wallet && connected,
  });

  if (!connected || !wallet) return null;

  return (
    <div className="flex items-center gap-3 px-3 h-10 border border-rule">
      <span className="dot dot-live" />
      <span className="tc">
        {data?.blobCount ?? "—"} blob{data?.blobCount !== 1 ? "s" : ""} on Shelby
      </span>
      <span className="tc text-dim-2 ml-auto">
        {wallet.slice(0, 6)}…{wallet.slice(-4)}
      </span>
    </div>
  );
}
