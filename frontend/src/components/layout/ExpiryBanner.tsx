"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAccountBlobs, useUploadBlobs } from "@shelby-protocol/react";
import { AlertTriangle, RefreshCw, Loader2, CheckCircle, X } from "lucide-react";
import { expirationMicros } from "@/lib/shelby";

const WARN_HOURS = 24;
const WARN_MICROS = WARN_HOURS * 3_600_000_000;

type RenewState = "idle" | "fetching" | "signing" | "done" | "error";

export function ExpiryBanner() {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const walletAddress = account?.address?.toString();
  const [dismissed, setDismissed] = useState(false);
  const [renewState, setRenewState] = useState<RenewState>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => { setDismissed(false); setRenewState("idle"); }, [walletAddress]);

  // useAccountBlobs takes a single argument — no options object
  const { data: blobs, isLoading } = useAccountBlobs({
    account: walletAddress ?? "",
  } as any);

  const uploadBlobs = useUploadBlobs({
    onError: (err) => { setErrMsg(err.message); setRenewState("error"); },
  });

  // Guard: not connected, dismissed, loading, or no address
  if (!connected || !walletAddress || dismissed || isLoading) return null;

  const nowMicros = Date.now() * 1000;
  const expiringBlobs = (blobs ?? []).filter((blob: any) => {
    const exp = Number(blob.expires_at ?? 0);
    return exp > 0 && exp < nowMicros + WARN_MICROS;
  });

  if (expiringBlobs.length === 0) return null;

  if (renewState === "done") {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 glass-card rounded-2xl border border-volt/20 bg-volt/[0.06] shadow-xl">
        <CheckCircle size={16} className="text-volt" />
        <span className="text-sm font-syne font-semibold text-volt">All videos renewed — good for 47hrs ✓</span>
      </div>
    );
  }

  const expiredCount = expiringBlobs.filter((b: any) => Number(b.expires_at ?? 0) < nowMicros).length;
  const soonCount = expiringBlobs.length - expiredCount;

  const handleRenewAll = async () => {
    if (!account || !signAndSubmitTransaction) return;
    setRenewState("fetching");
    setErrMsg(null);

    try {
      const notExpired = expiringBlobs.filter((b: any) => Number(b.expires_at ?? 0) > nowMicros);
      const blobPayloads = await Promise.all(
        notExpired.map(async (blob: any) => {
          const url = `https://api.testnet.shelby.xyz/shelby/v1/blobs/${walletAddress}/${encodeURIComponent(blob.name)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed to fetch ${blob.name} (${res.status})`);
          const ab = await res.arrayBuffer();
          return { blobName: blob.name, blobData: new Uint8Array(ab) };
        })
      );

      setRenewState("signing");
      await new Promise<void>((resolve, reject) => {
        uploadBlobs.mutate(
          {
            signer: { account: account.address.toString() as any, signAndSubmitTransaction },
            blobs: blobPayloads,
            expirationMicros: expirationMicros(),
          },
          { onSuccess: () => resolve(), onError: (err) => reject(err) }
        );
      });

      setRenewState("done");
      setTimeout(() => setRenewState("idle"), 5000);
    } catch (err: any) {
      setErrMsg(err.message ?? "Renewal failed. Please try again.");
      setRenewState("error");
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
      <div className="glass-card rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.04] shadow-xl shadow-black/40 overflow-hidden">
        <div className="flex items-start gap-3 p-4">
          <div className="w-8 h-8 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle size={14} className="text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-syne font-semibold text-white">
              {expiredCount > 0
                ? `${expiredCount} video${expiredCount !== 1 ? "s" : ""} expired on Shelby`
                : `${soonCount} video${soonCount !== 1 ? "s" : ""} expiring within 24hrs`}
            </p>
            <p className="text-xs text-white/40 font-dm mt-0.5 leading-relaxed">
              {expiredCount > 0
                ? "Expired blobs cannot be played. Re-upload from the Upload page."
                : "Sign one transaction to renew all expiring videos for 47 more hours."}
            </p>
            {errMsg && (
              <p className="text-[11px] font-mono text-red-400/70 mt-1.5 leading-relaxed">{errMsg}</p>
            )}
          </div>
          <button onClick={() => setDismissed(true)} className="text-white/20 hover:text-white/50 transition-colors shrink-0 mt-0.5">
            <X size={14} />
          </button>
        </div>

        {soonCount > 0 && (
          <div className="px-4 pb-4 flex items-center gap-3">
            <button
              onClick={handleRenewAll}
              disabled={renewState !== "idle" && renewState !== "error"}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-volt text-black text-xs font-syne font-semibold hover:bg-volt-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {renewState === "idle"     && <><RefreshCw size={11} /> Renew All ({soonCount})</>}
              {renewState === "fetching" && <><Loader2 size={11} className="animate-spin" /> Fetching videos...</>}
              {renewState === "signing"  && <><Loader2 size={11} className="animate-spin" /> Check wallet...</>}
              {renewState === "error"    && <><RefreshCw size={11} /> Retry</>}
            </button>
            {renewState === "signing" && (
              <p className="text-[10px] font-mono text-volt/60 animate-pulse">⚡ One signature renews all</p>
            )}
            <button onClick={() => setDismissed(true)} className="ml-auto text-xs font-mono text-white/20 hover:text-white/40 transition-colors">
              Remind me later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
