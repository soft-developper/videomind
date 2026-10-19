"use client";
// vm_profile: the signed in wallet. Its address, every video's store on
// Shelby (with the ones that need attention first), and what it used in
// the last 30 days. Quantities only: there are no prices yet.
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { explorer } from "@/lib/explorer";
import { getMyWallet, type WalletOverview } from "@/lib/api";
// vm_lang
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

type Row = WalletOverview["videos"][number];

function useDetail() {
  const t = useTranslations("walletPage");
  const f = useFormat();
  return (v: Row): string => {
    if (v.state === "anchored" && v.paidUntil) {
      const days = Math.max(0, Math.ceil((v.paidUntil - Date.now()) / 86_400_000));
      return v.endingSoon ? t("endsIn", { count: days }) : t("paidUntil", { date: f.date(v.paidUntil) });
    }
    if (v.state === "lapsed" && v.paidUntil) return t("endedOn", { date: f.date(v.paidUntil) });
    if (v.state === "missing") return t("networkReset");
    return "";
  };
}

function VideoRow({ v }: { v: Row }) {
  const t = useTranslations("walletPage");
  const tc = useTranslations("common");
  const detail = useDetail();
  const action = v.canStoreAgain && (v.state === "never" ? t("store") : v.attention ? t("storeAgain") : null);
  return (
    <li className="flex items-center gap-3 py-3 border-t border-rule first:border-t-0">
      <span className="relative w-20 aspect-video rounded-sm overflow-hidden bg-screen shrink-0 hidden sm:block">
        {v.thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        )}
      </span>
      <span className="flex-1 min-w-0">
        <Link href={`/video/${v.id}`} className="block text-[14px] font-medium text-paper truncate hover:underline" dir="auto">{v.title}</Link>
        <span className="block text-[13px] mt-0.5">
          <span className={clsx(v.attention ? "text-warn" : v.state === "anchored" ? "tc-marker" : "text-dim")}>{t(`state.${v.state}`)}</span>
          {detail(v) && <span className="text-dim">{t("sep")}{detail(v)}</span>}
          {v.visibility === "private" && <span className="text-dim">{t("sep")}{tc("visibility.private")}</span>}
        </span>
      </span>
      {action && (
        <Link href={`/upload?anchor=${v.id}`} className="btn btn-ghost h-9 px-3 text-[13px] inline-flex items-center shrink-0">{action}</Link>
      )}
    </li>
  );
}

export default function WalletPage() {
  const t = useTranslations("walletPage");
  const tc = useTranslations("common");
  const f = useFormat();
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ["my-wallet", wallet ?? null], queryFn: getMyWallet, enabled: !!wallet });

  const total = (feature: string | null, metric: string) =>
    (data?.usage.totals ?? []).filter((t) => (feature === null || t.feature === feature) && t.metric === metric).reduce((a, t) => a + t.total, 0);
  const answers = (data?.usage.totals ?? []).filter((t) => t.feature === "ask" && t.metric === "output_tokens").reduce((a, t) => a + t.events, 0);
  const attention = data?.videos.filter((v) => v.attention) ?? [];
  const rest = data?.videos.filter((v) => !v.attention) ?? [];

  return (
    <AppShell>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="section pb-16">
        {!connected && (
          <EmptyState title={t("connect")} action={<WalletButton />}>
            {t("connectBody")}
          </EmptyState>
        )}
        {connected && !wallet && (
          <EmptyState title={t("signIn")}>
            {t("signInBody")}
          </EmptyState>
        )}
        {wallet && isLoading && <p className="text-[14px] text-dim">{tc("loading")}</p>}
        {wallet && isError && <p className="text-[14px] text-error" role="alert">{t("loadFailed")}</p>}

        {data && (
          <div className="max-w-[860px] space-y-10">
            <section aria-labelledby="addr-h">
              <h2 id="addr-h" className="eyebrow mb-2">{t("address")}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="tc text-paper-2 break-all" dir="ltr">{data.wallet}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(data.wallet).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
                  aria-label={t("copyAddress")} className="inline-flex items-center justify-center w-8 h-8 -my-2 rounded text-dim hover:text-paper hover:bg-slate-2 no-min"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <a href={explorer.account(data.wallet)} target="_blank" rel="noopener noreferrer" className="text-[13px] text-dim hover:text-paper inline-flex items-center gap-1 no-min">
                  Aptos Explorer <ExternalLink size={11} />
                </a>
              </div>
              <p className="text-[13px] text-dim mt-2">
                {t("network")} <Link href={`/u/${data.wallet}`} className="underline underline-offset-2 hover:text-paper">{t("publicPage")}</Link>
              </p>
            </section>

            <section aria-labelledby="sum-h">
              <h2 id="sum-h" className="sr-only">{t("summary")}</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
                {[
                  ["videos", t("videos"), f.number(data.summary.videos)],
                  ["verified", t("verified"), f.number(data.summary.verified)],
                  ["attention", t("attention"), f.number(data.summary.attention)],
                  ["stored", t("stored"), f.bytes(data.summary.storedBytesNow)],
                ].map(([id, k, val]) => (
                  <div key={id}>
                    <dt className="text-[12.5px] text-dim">{k}</dt>
                    <dd className={clsx("text-[20px] font-display text-paper mt-0.5", id === "attention" && data.summary.attention > 0 && "text-warn")}>{val}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {attention.length > 0 && (
              <section aria-labelledby="att-h">
                <h2 id="att-h" className="text-[15px] font-semibold text-paper">{t("attention")}</h2>
                <p className="text-[13px] text-dim mt-1">{t("attentionBody")}</p>
                <ul className="mt-2" aria-label={t("attention")}>{attention.map((v) => <VideoRow key={v.id} v={v} />)}</ul>
              </section>
            )}

            <section aria-labelledby="all-h">
              <h2 id="all-h" className="text-[15px] font-semibold text-paper">{attention.length ? t("everythingElse") : t("yourVideos")}</h2>
              {data.videos.length === 0 ? (
                <p className="text-[14px] text-dim mt-2">{t.rich("noVideos", { upload: (c) => <Link href="/upload" className="underline underline-offset-2 hover:text-paper">{c}</Link> })}</p>
              ) : rest.length === 0 ? (
                <p className="text-[14px] text-dim mt-2">{t("nothingElse")}</p>
              ) : (
                <ul className="mt-2" aria-label={t("videos")}>{rest.map((v) => <VideoRow key={v.id} v={v} />)}</ul>
              )}
            </section>

            <section aria-labelledby="use-h">
              <h2 id="use-h" className="text-[15px] font-semibold text-paper">{t("last30")}</h2>
              <dl className="mt-3 divide-y divide-rule border-y border-rule">
                {[
                  [t("transcribed"), t("minutes", { count: Math.round(total("transcribe", "audio_seconds") / 60) })],
                  [t("answers"), f.number(answers)],
                  [t("tokens"), f.number(Math.round(total(null, "input_tokens") + total(null, "output_tokens")))],
                ].map(([k, val]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-[14px] text-paper-2">{k}</dt>
                    <dd className="tc text-paper">{val}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[12.5px] text-dim mt-2">{t("amountsOnly")}</p>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
