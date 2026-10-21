"use client";
// vm_topup: adding credits with ShelbyUSD (Part 16b).
//
// The wallet sends ShelbyUSD to VideoMind's treasury with the standard
// fungible asset transfer, then the server reads that transaction from
// shelbynet and adds the credits once. The hash is kept in this browser
// until the server has answered, so a closed tab or a lost connection
// never loses a payment: the next visit checks it again. Anyone can also
// paste a hash by hand. 1 ShelbyUSD adds 1 dollar of credits.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale, type Locale } from "@/i18n/config";
import { ApiError, getTopupInfo, claimTopup } from "@/lib/api";
import { explorer } from "@/lib/explorer";

const FAUCET = "https://docs.shelby.xyz/apis/faucet/shelbyusd";
const PRESETS = [1, 5, 10];
const OTHER_NETWORKS = ["mainnet", "testnet", "devnet", "local"];

/** 10 to the power n, as a bigint (the build target has no bigint literals). */
const ten = (n: number) => BigInt("1" + "0".repeat(Math.max(0, n)));

/** "2.5" dollars to the token's smallest units, without floating point. Null when it is not an amount. */
export function toUnits(text: string, decimals: number): bigint | null {
  const m = /^\s*(\d{1,7})(?:[.,](\d{1,8}))?\s*$/.exec(text);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals) return null;
  return BigInt(m[1]) * ten(decimals) + BigInt(frac || "0");
}

/** Kinds of wallet error, as on the upload page. */
function walletReason(raw: string): "declined" | "funds" | "submit" | null {
  if (/reject|cancel|denied|declined/i.test(raw)) return "declined";
  if (/INSUFFICIENT_BALANCE|insufficient.*(balance|fund|gas)|EINSUFFICIENT/i.test(raw)) return "funds";
  if (/failed to sign and submit|sign and submit|submit.*transaction|transaction.*(failed|rejected by)|simulation/i.test(raw)) return "submit";
  return null;
}

// Codes after which a hash will never be added: stop retrying it.
const FINAL = new Set(["bad_hash", "failed", "wrong_sender", "sent_by_treasury", "nothing_received", "not_user_transaction", "too_small", "hash_used"]);
const keyOf = (wallet: string) => `vm.topup.pending.${wallet}`;
function readPending(wallet: string): string | null { try { return window.localStorage.getItem(keyOf(wallet)); } catch { return null; } }
function writePending(wallet: string, hash: string | null) {
  try { if (hash) window.localStorage.setItem(keyOf(wallet), hash); else window.localStorage.removeItem(keyOf(wallet)); } catch { /* private window: kept in memory only */ }
}

type State =
  | { at: "idle" }
  | { at: "wallet" }
  | { at: "checking"; hash: string }
  | { at: "done"; amount: string; again: boolean; hash: string }
  | { at: "failed"; why: string; hash?: string };

export function AddCredits({ wallet, money }: { wallet: string; money: (micros: number) => string }) {
  const t = useTranslations("walletPage.credits.add");
  const tu = useTranslations("upload.wallet");
  const qc = useQueryClient();
  const { account, connected, network, signAndSubmitTransaction } = useWallet();
  const info = useQuery({ queryKey: ["topup-info", wallet], queryFn: getTopupInfo, staleTime: 30_000 });
  const [amount, setAmount] = useState("5");
  const [state, setState] = useState<State>({ at: "idle" });
  const [pending, setPending] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const tried = useRef(false);
  const locale = useLocale() as Locale;

  const usd = (units: bigint, decimals: number) => money(Number(units / ten(decimals - 6)));
  const claim = useCallback(async (hash: string) => {
    setState({ at: "checking", hash });
    // A transfer just sent can take a few seconds to show on shelbynet.
    for (let i = 0; i < 4; i++) {
      try {
        const r = await claimTopup(hash);
        writePending(wallet, null); setPending(null);
        setState({ at: "done", amount: money(r.amountMicros), again: r.alreadyAdded, hash });
        qc.invalidateQueries({ queryKey: ["my-credits"] });
        qc.invalidateQueries({ queryKey: ["topup-info"] });
        return;
      } catch (e) {
        const code = e instanceof ApiError ? e.code : undefined;
        if (code === "tx_not_found" && i < 3) { await new Promise((r) => setTimeout(r, 4000)); continue; }
        if (code && FINAL.has(code)) { writePending(wallet, null); setPending(null); }
        setState({ at: "failed", why: e instanceof ApiError ? e.message : t("checkFailed"), hash });
        return;
      }
    }
  }, [wallet, money, qc, t]);

  // A transfer this browser sent but the server never answered for: check it once on arrival.
  useEffect(() => {
    if (tried.current || !info.data?.enabled) return;
    tried.current = true;
    const h = readPending(wallet);
    if (h) { setPending(h); void claim(h); }
  }, [info.data, wallet, claim]);

  const d = info.data;
  if (info.isLoading) return null;
  if (!d || !d.enabled || !d.treasury) {
    return <p className="text-[13px] text-dim" data-topup="off">{t("off")}</p>;
  }

  const units = toUnits(amount, d.decimals);
  const min = toUnits(String(d.minUsd), d.decimals)!, max = toUnits(String(d.maxUsd), d.decimals)!;
  const have = d.walletUnits != null ? BigInt(d.walletUnits) : null;
  const problem = units == null ? t("badAmount")
    : units < min ? t("tooLow", { min: `\u2066${usd(min, d.decimals)}\u2069` })
    : units > max ? t("tooHigh", { max: `\u2066${usd(max, d.decimals)}\u2069` })
    : null;
  const short = units != null && have != null && units > have;
  const otherNet = network?.name && OTHER_NETWORKS.includes(String(network.name).toLowerCase()) ? String(network.name) : null;
  const busy = state.at === "wallet" || state.at === "checking";

  const send = async () => {
    if (!units || problem || !connected || !account) return;
    setState({ at: "wallet" });
    let hash: string;
    try {
      const r = await signAndSubmitTransaction({
        data: {
          function: "0x1::primary_fungible_store::transfer",
          typeArguments: ["0x1::fungible_asset::Metadata"],
          functionArguments: [d.asset, d.treasury!, Number(units)],
        },
      });
      hash = String((r as { hash?: string }).hash ?? "");
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("submit transaction failed");
    } catch (e: any) {
      const k = walletReason(String(e?.message ?? e ?? ""));
      setState({ at: "failed", why: k ? tu(k) : t("walletFailed") });
      return;
    }
    // Kept before asking the server, so the payment is never lost.
    writePending(wallet, hash); setPending(hash);
    await claim(hash);
  };

  return (
    <div id="add-credits" className="mt-6 rounded-lg border border-rule p-4 sm:p-5 max-w-[640px] scroll-mt-20" data-topup="on">
      <h3 className="text-[14px] font-semibold text-paper">{t("title")}</h3>
      <p className="text-[13px] text-dim mt-1">{t("body")}</p>

      <div className="mt-4 flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1 text-[12.5px] text-dim">
          {t("amount")}
          <span className="relative">
            <span className="absolute start-3 top-1/2 -translate-y-1/2 text-dim" aria-hidden>$</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" disabled={busy}
              className="h-10 ps-7 pe-3 w-32 text-[14px] tabular-nums" data-topup-amount aria-invalid={!!problem} />
          </span>
        </label>
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => setAmount(String(p))} disabled={busy}
            className={clsx("btn btn-ghost h-10 px-3 text-[13px] no-min", amount === String(p) && "border-paper-2 text-paper")}>
            <span dir="ltr">{money(p * 1_000_000)}</span>
          </button>
        ))}
        <button type="button" onClick={() => void send()} disabled={busy || !!problem || !connected} className="btn btn-signal h-10 px-4" data-topup-send>
          {state.at === "wallet" ? t("wallet") : state.at === "checking" ? t("checking") : t("add", { amount: units != null && !problem ? `\u2066${usd(units, d.decimals)}\u2069` : "" })}
        </button>
      </div>

      <div className="mt-2 text-[12.5px] text-dim space-y-1">
        {problem && amount.trim() !== "" && <p className="text-warn">{problem}</p>}
        {have != null && <p>{t("youHave", { amount: `\u2066${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 6 }).format(Number(have) / 10 ** d.decimals)}\u2069` })}</p>}
        {short && !problem && <p className="text-warn">{t("notEnough")} <a href={FAUCET} target="_blank" rel="noreferrer" className="underline hover:text-paper">{t("getTest")}</a></p>}
        {otherNet && <p className="text-warn">{t("otherNetwork", { network: otherNet })}</p>}
        <p>{t("network")}</p>
      </div>

      <div aria-live="polite" className="mt-3">
        {state.at === "done" && (
          <p className="text-[13.5px] text-marker" data-topup-done>
            {state.again ? t("alreadyAdded") : t("added", { amount: `\u2066${state.amount}\u2069` })}{" "}
            <a href={explorer.txn(state.hash)} target="_blank" rel="noreferrer" className="underline text-dim hover:text-paper inline-flex items-center gap-1">{t("view")} <ExternalLink size={11} /></a>
          </p>
        )}
        {state.at === "failed" && (
          <p className="text-[13.5px] text-error" role="alert" data-topup-failed>{state.why}</p>
        )}
        {pending && state.at !== "checking" && state.at !== "done" && (
          <p className="text-[13px] text-paper-2 mt-1">
            {t("pending")} <button type="button" onClick={() => void claim(pending)} className="underline hover:text-paper no-min">{t("checkAgain")}</button>
          </p>
        )}
      </div>

      <details className="mt-4 text-[13px]">
        <summary className="cursor-pointer text-dim hover:text-paper">{t("manualTitle")}</summary>
        <p className="text-dim mt-2">{t("manualBody")}</p>
        <div className="mt-2 flex gap-2 flex-wrap">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="0x..." dir="ltr" spellCheck={false} aria-label={t("hash")}
            className="h-9 px-3 text-[13px] tc flex-1 min-w-[220px]" data-topup-hash />
          <button type="button" disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(manual.trim())} onClick={() => void claim(manual.trim())} className="btn btn-ghost h-9 px-3.5">{t("check")}</button>
        </div>
      </details>
    </div>
  );
}
