"use client";
// vm_live: the host's studio for one live event.
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { useQuery } from "@tanstack/react-query";
import { LiveStudio } from "@/components/live/LiveStudio";
import { getLiveEvent } from "@/lib/api";

export default function StudioPage({ params }: { params: { id: string } }) {
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const { data } = useQuery({ queryKey: ["live", params.id], queryFn: () => getLiveEvent(params.id), enabled: !!wallet });
  const mine = !!data && !!wallet && data.event.wallet.toLowerCase() === wallet.toLowerCase();
  return (
    <AppShell>
      <PageHeader title={data?.event.title ?? "Live studio"} back={{ href: "/live", label: "Go live" }} />
      <div className="section pb-16">
        {!connected ? (
          <EmptyState title="Connect a wallet to open the studio" action={<WalletButton />} />
        ) : !wallet ? (
          <EmptyState title="Sign in to open the studio">One signature proves the wallet is yours. The prompt is at the bottom of the page.</EmptyState>
        ) : !data ? (
          <p className="text-[14px] text-dim">Loading</p>
        ) : !mine ? (
          <EmptyState title="This live event belongs to a different wallet" />
        ) : (
          <LiveStudio id={params.id} />
        )}
      </div>
    </AppShell>
  );
}
