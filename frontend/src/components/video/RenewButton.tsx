"use client";

import { useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useUploadBlobs } from "@shelby-protocol/react";
import { RefreshCw, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { expirationMicros } from "@/lib/shelby";
import { clsx } from "clsx";

interface RenewButtonProps {
  streamUrl: string;
  videoBlobName: string;
  onRenewed?: () => void;
}

type RenewState = "idle" | "fetching" | "signing" | "done" | "error";

export function RenewButton({ streamUrl, videoBlobName, onRenewed }: RenewButtonProps) {
  const { account, signAndSubmitTransaction, connected } = useWallet();
  const [state, setState] = useState<RenewState>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const uploadBlobs = useUploadBlobs({
    onError: (err) => { setErrMsg(err.message); setState("error"); },
  });

  const handleRenew = async () => {
    if (!connected || !account || !signAndSubmitTransaction) return;
    setState("fetching");
    setErrMsg(null);

    try {
      const response = await fetch(streamUrl);
      if (!response.ok) throw new Error(`Could not fetch video (${response.status}). It may have already expired.`);
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      setState("signing");
      await new Promise<void>((resolve, reject) => {
        uploadBlobs.mutate(
          {
            signer: { account: account.address.toString() as any, signAndSubmitTransaction },
            blobs: [{ blobName: videoBlobName, blobData: bytes }],
            expirationMicros: expirationMicros(),
          },
          { onSuccess: () => resolve(), onError: (err) => reject(err) }
        );
      });

      setState("done");
      onRenewed?.();
      setTimeout(() => setState("idle"), 4000);
    } catch (err: any) {
      setErrMsg(err.message ?? "Renewal failed. Please try again.");
      setState("error");
    }
  };

  if (!connected) return null;

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleRenew}
        disabled={state === "fetching" || state === "signing" || state === "done"}
        className={clsx(
          "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-syne font-semibold transition-all",
          state === "done"    ? "bg-volt/10 border border-volt/20 text-volt cursor-default"
          : state === "error"  ? "bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 cursor-pointer"
          : state !== "idle"   ? "bg-volt/10 border border-volt/20 text-volt/50 cursor-not-allowed"
          : "bg-volt/10 border border-volt/20 text-volt hover:bg-volt/20 cursor-pointer"
        )}
      >
        {state === "idle"     && <><RefreshCw size={12} /> Renew on Shelby</>}
        {state === "fetching" && <><Loader2 size={12} className="animate-spin" /> Fetching from Shelby...</>}
        {state === "signing"  && <><Loader2 size={12} className="animate-spin" /> Check wallet...</>}
        {state === "done"     && <><CheckCircle size={12} /> Renewed — good for 47hrs</>}
        {state === "error"    && <><AlertTriangle size={12} /> Failed — tap to retry</>}
      </button>
      {state === "signing" && (
        <p className="text-[10px] font-mono text-volt/50 animate-pulse pl-1">⚡ Approve the signing request in Petra</p>
      )}
      {state === "error" && errMsg && (
        <p className="text-[10px] font-mono text-red-400/60 pl-1 leading-relaxed">{errMsg}</p>
      )}
    </div>
  );
}
