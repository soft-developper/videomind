"use client";
// vm_charge: prices before an action, a way to add credits from any "not
// enough credits" message, and a notice when credits run low (Part 16c2).
//
// Nothing here shows while charging is off, or for an action priced at 0:
// then nothing costs anything and there is nothing to say.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { clsx } from "clsx";
import { getCreditPrices, getMyCredits, type CreditAction } from "@/lib/api";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { useMoney, inline } from "@/lib/format";

/** Below this much, the notice says credits are low. */
export const LOW_MICROS = 500_000;
// No jump to a section: Add credits sits near the top of the Wallet page.
export const ADD_CREDITS_HREF = "/wallet";
/** Server codes that mean the signed in wallet has to add credits. */
export const isNoCredits = (code?: string | null) => code === "not_enough_credits" || code === "no_credits";

export function useCredits() {
  const wallet = useSessionWallet();
  const prices = useQuery({ queryKey: ["credit-prices"], queryFn: getCreditPrices, staleTime: 60_000 });
  const mine = useQuery({ queryKey: ["my-credits", wallet ?? null], queryFn: getMyCredits, enabled: !!wallet, staleTime: 15_000 });
  const charging = !!prices.data?.charging;
  const priceOf = (a: CreditAction) => prices.data?.prices.find((p) => p.id === a)?.microsPerUnit ?? 0;
  return {
    charging, priceOf, signedIn: !!wallet,
    available: mine.data?.availableMicros ?? null,
    /** The price of an action when it costs something right now, else null. */
    costOf: (a: CreditAction) => (charging && priceOf(a) > 0 ? priceOf(a) : null),
  };
}

export type PriceWording = "process" | "answer" | "search" | "paths" | "libraryAnswer" | "captions";
const ACTION: Record<PriceWording, CreditAction> = {
  process: "process_video", answer: "ask", search: "search", paths: "learn_paths", libraryAnswer: "learn_ask", captions: "live_captions",
};

/** One short line with the price of an action, and what the wallet has. Shows nothing when the action is free. */
export function PriceTag({ what, className }: { what: PriceWording; className?: string }) {
  const t = useTranslations("credits");
  const money = useMoney();
  const c = useCredits();
  const cost = c.costOf(ACTION[what]);
  if (cost == null) return null;
  const short = c.available != null && c.available < cost;
  return (
    <p className={clsx("text-[12px] leading-relaxed", short ? "text-warn" : "text-dim", className)} data-price-tag={what}>
      {t(`price.${what}`, { price: inline(money(cost)) })}
      {c.available != null && <> {t("have", { amount: inline(money(c.available)) })}</>}
      {short && <> <Link href={ADD_CREDITS_HREF} className="underline hover:text-paper">{t("add")}</Link></>}
    </p>
  );
}

/** The link to add credits, put after a "not enough credits" message. */
export function AddCreditsLink({ className }: { className?: string }) {
  const t = useTranslations("credits");
  return <Link href={ADD_CREDITS_HREF} className={clsx("underline underline-offset-2 hover:text-paper", className)} data-add-credits-link>{t("add")}</Link>;
}

const DISMISS = "vm.credits.low.hidden";

/** A thin notice at the top of every page while charging is on and credits are low or gone. */
export function CreditsNotice({ path }: { path: string }) {
  const t = useTranslations("credits");
  const money = useMoney();
  const c = useCredits();
  const [hidden, setHidden] = useState<number | null>(null);
  useEffect(() => { try { setHidden(Number(sessionStorage.getItem(DISMISS)) || null); } catch { /* storage blocked */ } }, []);
  if (!c.charging || !c.signedIn || c.available == null || c.available >= LOW_MICROS || path.startsWith("/wallet")) return null;
  // Hidden for this tab until the balance changes.
  if (hidden != null && hidden === c.available) return null;
  const out = c.available <= 0;
  return (
    <div role="status" className={clsx("border-b px-4 sm:px-6 py-2 text-[13px] flex items-center gap-3 flex-wrap", out ? "border-error/40 bg-error/5 text-error" : "border-warn/30 bg-warn/5 text-warn")} data-credits-notice={out ? "out" : "low"}>
      <span className="flex-1 min-w-0">{out ? t("out") : t("low", { amount: inline(money(c.available)) })}</span>
      <AddCreditsLink className="font-medium" />
      <button type="button" onClick={() => { try { sessionStorage.setItem(DISMISS, String(c.available)); } catch {} setHidden(c.available); }} className="text-dim hover:text-paper no-min">{t("hide")}</button>
    </div>
  );
}
