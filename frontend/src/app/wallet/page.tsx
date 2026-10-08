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
import { getMyWallet, type WalletOverview, type WalletState } from "@/lib/api";

function bytes(n: number) {
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
const LABEL: Record<WalletState, string> = {
  never: "Not stored on Shelby", checking: "Confirming on Shelby", anchored: "Verified on Shelby",
  lapsed: "Paid period ended", missing: "No longer on Shelby", unverified: "Not confirmed",
};
type Row = WalletOverview["videos"][number];

function detail(v: Row): string {
  if (v.state === "anchored" && v.paidUntil) {
    const days = Math.max(0, Math.ceil((v.paidUntil - Date.now()) / 86_400_000));
    return v.endingSoon ? `Paid period ends in ${days} day${days === 1 ? "" : "s"}` : `Paid until ${day(v.paidUntil)}`;
  }
  if (v.state === "lapsed" && v.paidUntil) return `Ended ${day(v.paidUntil)}`;
  if (v.state === "missing") return "The test network was reset";
  return "";
}

function VideoRow({ v }: { v: Row }) {
  const action = v.canStoreAgain && (v.state === "never" ? "Store on Shelby" : v.attention ? "Store again" : null);
  return (
    <li className="flex items-center gap-3 py-3 border-t border-rule first:border-t-0">
      <span className="relative w-20 aspect-video rounded-sm overflow-hidden bg-screen shrink-0 hidden sm:block">
        {v.thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        )}
      </span>
      <span className="flex-1 min-w-0">
        <Link href={`/video/${v.id}`} className="block text-[14px] font-medium text-paper truncate hover:underline">{v.title}</Link>
        <span className="block text-[13px] mt-0.5">
          <span className={clsx(v.attention ? "text-warn" : v.state === "anchored" ? "tc-marker" : "text-dim")}>{LABEL[v.state]}</span>
          {detail(v) && <span className="text-dim">. {detail(v)}</span>}
          {v.visibility === "private" && <span className="text-dim">. Private</span>}
        </span>
      </span>
      {action && (
        <Link href={`/upload?anchor=${v.id}`} className="btn btn-ghost h-9 px-3 text-[13px] inline-flex items-center shrink-0">{action}</Link>
      )}
    </li>
  );
}

export default function WalletPage() {
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
      <PageHeader title="Wallet" description="Your address, your videos on Shelby, and what your library used in the last 30 days." />
      <div className="section pb-16">
        {!connected && (
          <EmptyState title="Connect a wallet to see it here" action={<WalletButton />}>
            Your library, your stores on Shelby and your usage belong to your wallet.
          </EmptyState>
        )}
        {connected && !wallet && (
          <EmptyState title="Sign in to see your wallet">
            Your wallet is connected. One signature proves it is yours. The prompt is at the bottom of the page.
          </EmptyState>
        )}
        {wallet && isLoading && <p className="text-[14px] text-dim">Loading</p>}
        {wallet && isError && <p className="text-[14px] text-error" role="alert">Your wallet page could not be loaded. Try again in a minute.</p>}

        {data && (
          <div className="max-w-[860px] space-y-10">
            <section aria-labelledby="addr-h">
              <h2 id="addr-h" className="eyebrow mb-2">Address</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="tc text-paper-2 break-all">{data.wallet}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(data.wallet).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
                  aria-label="Copy the wallet address" className="inline-flex items-center justify-center w-8 h-8 -my-2 rounded text-dim hover:text-paper hover:bg-slate-2 no-min"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <a href={explorer.account(data.wallet)} target="_blank" rel="noopener noreferrer" className="text-[13px] text-dim hover:text-paper inline-flex items-center gap-1 no-min">
                  Aptos Explorer <ExternalLink size={11} />
                </a>
              </div>
              <p className="text-[13px] text-dim mt-2">
                Network: shelbynet, Shelby&apos;s test network. <Link href={`/u/${data.wallet}`} className="underline underline-offset-2 hover:text-paper">Your public page</Link>
              </p>
            </section>

            <section aria-labelledby="sum-h">
              <h2 id="sum-h" className="sr-only">Summary</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
                {[
                  ["Videos", String(data.summary.videos)],
                  ["Verified on Shelby", String(data.summary.verified)],
                  ["Need attention", String(data.summary.attention)],
                  ["In VideoMind storage", bytes(data.summary.storedBytesNow)],
                ].map(([k, val]) => (
                  <div key={k}>
                    <dt className="text-[12.5px] text-dim">{k}</dt>
                    <dd className={clsx("text-[20px] font-display text-paper mt-0.5", k === "Need attention" && data.summary.attention > 0 && "text-warn")}>{val}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {attention.length > 0 && (
              <section aria-labelledby="att-h">
                <h2 id="att-h" className="text-[15px] font-semibold text-paper">Need attention</h2>
                <p className="text-[13px] text-dim mt-1">Their proof on Shelby has ended, is ending, or could not be confirmed. They still play from VideoMind.</p>
                <ul className="mt-2" aria-label="Need attention">{attention.map((v) => <VideoRow key={v.id} v={v} />)}</ul>
              </section>
            )}

            <section aria-labelledby="all-h">
              <h2 id="all-h" className="text-[15px] font-semibold text-paper">{attention.length ? "Everything else" : "Your videos on Shelby"}</h2>
              {data.videos.length === 0 ? (
                <p className="text-[14px] text-dim mt-2">No videos yet. <Link href="/upload" className="underline underline-offset-2 hover:text-paper">Upload one</Link>.</p>
              ) : rest.length === 0 ? (
                <p className="text-[14px] text-dim mt-2">Nothing else.</p>
              ) : (
                <ul className="mt-2" aria-label="Videos">{rest.map((v) => <VideoRow key={v.id} v={v} />)}</ul>
              )}
            </section>

            <section aria-labelledby="use-h">
              <h2 id="use-h" className="text-[15px] font-semibold text-paper">Last 30 days</h2>
              <dl className="mt-3 divide-y divide-rule border-y border-rule">
                {[
                  ["Audio transcribed", `${Math.round(total("transcribe", "audio_seconds") / 60)} min`],
                  ["Questions answered on your videos", String(answers)],
                  ["AI tokens, in and out", Math.round(total(null, "input_tokens") + total(null, "output_tokens")).toLocaleString()],
                ].map(([k, val]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-[14px] text-paper-2">{k}</dt>
                    <dd className="tc text-paper">{val}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[12.5px] text-dim mt-2">Amounts only. VideoMind has no prices yet.</p>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
