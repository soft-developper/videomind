"use client";
import { useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useUploadBlobs } from "@shelby-protocol/react";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import { expirationMicros } from "@/lib/shelby";
import { clsx } from "clsx";

type S = "idle" | "fetching" | "signing" | "done" | "error";

export function RenewButton({
  streamUrl, videoBlobName, onRenewed,
}: { streamUrl: string; videoBlobName: string; onRenewed?: () => void }) {
  const { account, signAndSubmitTransaction, connected } = useWallet();
  const [s, setS] = useState<S>("idle");
  const [err, setErr] = useState<string | null>(null);

  const upload = useUploadBlobs({
    onError: (e) => { setErr(e.message); setS("error"); },
  });

  const go = async () => {
    if (!connected || !account || !signAndSubmitTransaction) return;
    setS("fetching"); setErr(null);
    try {
      const r = await fetch(streamUrl);
      if (!r.ok) throw new Error("Blob already expired — re-upload the file.");
      const buf = new Uint8Array(await r.arrayBuffer());

      setS("signing");
      await new Promise<void>((res, rej) => {
        upload.mutate(
          {
            signer: { account: account.accountAddress, signAndSubmitTransaction },
            blobs: [{ blobName: videoBlobName, blobData: buf }],
            expirationMicros: expirationMicros(),
          },
          { onSuccess: () => res(), onError: (e) => rej(e) }
        );
      });

      setS("done"); onRenewed?.();
      setTimeout(() => setS("idle"), 4000);
    } catch (e: any) {
      setErr(e.message ?? "Renewal failed."); setS("error");
    }
  };

  if (!connected) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={go}
        disabled={s === "fetching" || s === "signing" || s === "done"}
        className={clsx(
          "flex items-center gap-1.5 h-8 px-3 text-[12px] font-sans transition-colors border no-min",
          s === "done"  ? "border-marker-dim text-marker cursor-default"
          : s === "error" ? "border-error/40 text-error hover:bg-error/10"
          : "border-rule text-dim hover:text-paper hover:border-rule-lit"
        )}
      >
        {s === "idle"     && <><RefreshCw size={10} /> Renew on Shelby</>}
        {s === "fetching" && <><span className="dot dot-work" /> Fetching…</>}
        {s === "signing"  && <><span className="dot dot-work" /> Check wallet</>}
        {s === "done"     && <><Check size={10} /> Good for 47h</>}
        {s === "error"    && <><AlertTriangle size={10} /> Retry</>}
      </button>
      {s === "error" && err && (
        <p className="tc text-error/70 max-w-[220px] text-right leading-relaxed">{err}</p>
      )}
    </div>
  );
}
