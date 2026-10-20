"use client";
// vm_profile: the signed in wallet. Its address, its credits (vm_credits),
// every video's store on Shelby (with the ones that need attention first),
// and what it used in the last 30 days.
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
import { getMyWallet, getMyCredits, type WalletOverview, type MyCredits } from "@/lib/api";
// vm_lang
import { useLocale, useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { intlLocale, type Locale } from "@/i18n/config";

// vm_credits: dollars in the reader's language, never rounded: $3.925 stays
// $3.925 and a price of $0.006 keeps its digits. Whole cents show two digits.
function useMoney() {
  const locale = useLocale() as Locale;
  // Arabic formats carry direction marks; the amounts sit in left to right
  // boxes, so the marks are taken out (they would move the minus sign).
  return (micros: number, sign = false) => {
    const x = micros / 1_000_000;
    const s = new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(x).replace(/[\u200e\u200f\u061c]/g, "");
    return sign && x > 0 ? `+${s}` : s;
  };
}

/** An amount inside a sentence, kept left to right in every language (Unicode isolate). */
const inline = (s: string) => `\u2066${s}\u2069`;

function CreditsSection({ c }: { c: MyCredits }) {
  const t = useTranslations("walletPage.credits");
  const tw = useTranslations("walletPage");
  const f = useFormat();
  const money = useMoney();
  return (
    <section aria-labelledby="cr-h" data-credits>
      <h2 id="cr-h" className="text-[15px] font-semibold text-paper">{t("title")}</h2>
      <div className="mt-3 flex items-end gap-x-8 gap-y-2 flex-wrap">
        <div>
          <p className="text-[12.5px] text-dim">{t("balance")}</p>
          <p className="text-[26px] font-display text-paper mt-0.5 tabular-nums" dir="ltr" data-credits-balance>{money(c.balanceMicros)}</p>
        </div>
        {c.heldMicros > 0 && (
          <p className="text-[13px] text-dim pb-1.5">
            {t("available", { amount: inline(money(c.availableMicros)) })}{tw("sep")}{t("onHold", { amount: inline(money(c.heldMicros)) })}
          </p>
        )}
      </div>
      <p className="text-[13px] text-dim mt-2 max-w-[70ch]">{c.charging ? t("charging") : t("notCharging")} {t("addSoon")}</p>

      <div className="grid md:grid-cols-2 gap-x-10 gap-y-8 mt-6">
        <div className="min-w-0">
          <h3 className="eyebrow mb-2">{t("activity")}</h3>
          {c.entries.length === 0 ? <p className="text-[14px] text-dim">{t("noActivity")}</p> : (
            <ul className="divide-y divide-rule border-y border-rule" aria-label={t("activity")}>
              {c.entries.slice(0, 10).map((e) => (
                <li key={e.id} className="flex items-baseline gap-3 py-2.5" data-credit-entry={e.kind}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] text-paper-2">{t(`kind.${e.kind}`)}</span>
                    {e.action && <span className="block text-[12.5px] text-dim truncate">{t.has(`action.${e.action}` as never) ? t(`action.${e.action}` as never) : e.action}</span>}
                  </span>
                  <span className="text-[12.5px] text-dim whitespace-nowrap">{f.date(e.at)}</span>
                  <span className={clsx("tc whitespace-nowrap", e.amountMicros > 0 ? "tc-marker" : "text-paper")} dir="ltr">{money(e.amountMicros, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="eyebrow mb-2">{t("prices")}</h3>
          <dl className="divide-y divide-rule border-y border-rule">
            {c.prices.map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-4 py-2.5" data-credit-price={p.id}>
                <dt className="text-[14px] text-paper-2">{t(`action.${p.id}`)}</dt>
                <dd className="text-[13.5px] text-paper text-end shrink-0">{p.microsPerUnit === 0 ? t("free") : t(`per.${p.unit}`, { price: inline(money(p.microsPerUnit)) })}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

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
  // vm_credits
  const tcr = useTranslations("walletPage.credits");
  const credits = useQuery({ queryKey: ["my-credits", wallet ?? null], queryFn: getMyCredits, enabled: !!wallet });

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

            {credits.data && <CreditsSection c={credits.data} />}
            {credits.isError && <p className="text-[14px] text-error" role="alert">{tcr("loadFailed")}</p>}

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
