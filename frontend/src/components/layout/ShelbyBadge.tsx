"use client";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { Zap, Database } from "lucide-react";
import { api } from "@/lib/api";

async function fetchStats(wallet: string) {
  const res = await api.get("/api/shelby/stats", { params: { wallet } });
  return res.data as {
    totalVideos: number; readyVideos: number;
    blobCount: number; processing: number;
  };
}

export function ShelbyBadge() {
  const { connected, account } = useWallet();
  const walletAddress = account?.address?.toString();

  const { data } = useQuery({
    queryKey: ["shelby-badge", walletAddress],
    queryFn: () => fetchStats(walletAddress!),
    refetchInterval: 30_000,
    enabled: !!walletAddress && connected,
  });

  if (!connected || !walletAddress) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 glass-card rounded-xl border border-volt/10">
      <div className="w-8 h-8 rounded-lg bg-volt/10 border border-volt/20 flex items-center justify-center">
        <Database size={13} className="text-volt" />
      </div>
      <div>
        <p className="text-[10px] font-mono text-white/25 uppercase tracking-widest">
          Your Shelby blobs
        </p>
        <div className="flex items-center gap-1.5">
          <span className="font-syne font-bold text-white text-sm">
            {data?.blobCount ?? "—"}
          </span>
          <div className="w-1.5 h-1.5 rounded-full bg-volt status-pulse" />
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-[10px] font-mono text-white/20">
          {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
        </span>
        <Zap size={12} className="text-volt/40" />
      </div>
    </div>
  );
}
