"use client";
import { use } from "react";
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
// vm_lang
import { useTranslations } from "next-intl";

export default function StudioPage(props: { params: Promise<{ id: string }> }) {
  // vm_next15: params arrive as a promise in Next 15
  const params = use(props.params);
  const t = useTranslations("live");
  const tc = useTranslations("common");
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const { data } = useQuery({ queryKey: ["live", params.id], queryFn: () => getLiveEvent(params.id), enabled: !!wallet });
  const mine = !!data && !!wallet && data.event.wallet.toLowerCase() === wallet.toLowerCase();
  return (
    <AppShell>
      <PageHeader title={data?.event.title ?? t("studio")} back={{ href: "/live", label: t("title") }} />
      <div className="section pb-16">
        {!connected ? (
          <EmptyState title={t("connectStudio")} action={<WalletButton />} />
        ) : !wallet ? (
          <EmptyState title={t("signInStudio")}>{t("signInStudioBody")}</EmptyState>
        ) : !data ? (
          <p className="text-[14px] text-dim">{tc("loading")}</p>
        ) : !mine ? (
          <EmptyState title={t("notYours")} />
        ) : (
          <LiveStudio id={params.id} />
        )}
      </div>
    </AppShell>
  );
}
