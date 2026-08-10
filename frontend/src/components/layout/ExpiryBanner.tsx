"use client";
import { useState, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAccountBlobs, useUploadBlobs } from "@shelby-protocol/react";
import { X, RefreshCw, Check } from "lucide-react";
import { expirationMicros } from "@/lib/shelby";

const WARN_MICROS = 24 * 3_600_000_000;
type Blob = Record<string, any>;
type S = "idle" | "fetching" | "signing" | "done" | "error";

export function ExpiryBanner() {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const wallet = account?.address?.toString();
  const [hid, setHid] = useState(false);
  const [s, setS] = useState<S>("idle");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setHid(false); setS("idle"); }, [wallet]);

  // shelbynet's blob indexer does not yet expose the `blobs` GraphQL
  // field (infra gap from the testnet -> shelbynet migration), confirmed
  // by tracing every call site of getBlobs/getAccountBlobs in the SDK --
  // only this hook calls it. Uploads (useUploadBlobs -> registerBlob())
  // never touch the indexer and are completely unaffected.
  //
  // enabled: false switches this off entirely until Shelby's indexer
  // supports the query, so it never fires and never appears in the
  // console or network tab. Flip back to true once it's fixed.
  const EXPIRY_CHECK_ENABLED = false;
  const { data: raw, isLoading } = useAccountBlobs({
    account: wallet ?? "",
    enabled: EXPIRY_CHECK_ENABLED && !!wallet && connected,
  } as any);
  const blobs = (raw ?? []) as Blob[];

  const upload = useUploadBlobs({
    onError: (e) => { setErr(e.message); setS("error"); },
  });

  if (!connected || !wallet || hid || isLoading) return null;

  const now = Date.now() * 1000;
  const exp = (b: Blob) => Number(b["expires_at"] ?? b["expiresAt"] ?? 0);
  const soon = blobs.filter((b) => exp(b) > 0 && exp(b) < now + WARN_MICROS);
  if (soon.length === 0) return null;

  if (s === "done") {
    return (
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 h-10 bg-void border border-marker-dim">
        <Check size={12} className="text-marker" />
        <span className="text-[12px] font-sans text-marker">Renewed — good for 47 hours</span>
      </div>
    );
  }

  const dead = soon.filter((b) => exp(b) < now).length;
  const live = soon.length - dead;

  const renewAll = async () => {
    if (!account || !signAndSubmitTransaction) return;
    setS("fetching"); setErr(null);
    try {
      const payloads = await Promise.all(
        soon.filter((b) => exp(b) > now).map(async (b) => {
          const name = String(b["name"] ?? b["blobName"] ?? "");
          const r = await fetch(
            `https://api.shelbynet.shelby.xyz/shelby/v1/blobs/${wallet}/${encodeURIComponent(name)}`
          );
          if (!r.ok) throw new Error(`Couldn't fetch ${name}`);
          return { blobName: name, blobData: new Uint8Array(await r.arrayBuffer()) };
        })
      );

      setS("signing");
      await new Promise<void>((res, rej) => {
        upload.mutate(
          {
            signer: { account: account.address.toString() as any, signAndSubmitTransaction },
            blobs: payloads,
            expirationMicros: expirationMicros(),
          },
          { onSuccess: () => res(), onError: (e) => rej(e) }
        );
      });

      setS("done");
      setTimeout(() => setS("idle"), 5000);
    } catch (e: any) {
      setErr(e.message ?? "Renewal failed."); setS("error");
    }
  };

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
      <div className="bg-void border border-warn/40">
        <div className="flex items-start gap-3 p-3">
          <span className="dot dot-work mt-1.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-sans text-paper">
              {dead > 0
                ? `${dead} blob${dead !== 1 ? "s" : ""} expired on Shelby`
                : `${live} blob${live !== 1 ? "s" : ""} expire within 24 hours`}
            </p>
            <p className="tc mt-0.5 leading-relaxed">
              {dead > 0
                ? "Expired blobs can't be played. Re-upload the file."
                : "One signature renews them all for another 47 hours."}
            </p>
            {err && <p className="tc text-error/70 mt-1">{err}</p>}
          </div>
          <button onClick={() => setHid(true)} className="text-dim hover:text-paper shrink-0 no-min">
            <X size={12} />
          </button>
        </div>

        {live > 0 && (
          <div className="flex items-center gap-3 px-3 pb-3">
            <button
              onClick={renewAll}
              disabled={s === "fetching" || s === "signing"}
              className="flex items-center gap-1.5 h-8 px-3 bg-signal text-void text-[12px] font-sans hover:bg-[#FF6449] transition-colors disabled:opacity-50 no-min"
            >
              {s === "idle"     && <><RefreshCw size={10} /> Renew all {live}</>}
              {s === "fetching" && "Fetching…"}
              {s === "signing"  && "Check wallet"}
              {s === "error"    && <><RefreshCw size={10} /> Retry</>}
            </button>
            <button onClick={() => setHid(true)} className="tc hover:text-paper transition-colors ml-auto no-min">
              Later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
