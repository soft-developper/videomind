"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { X, AlertTriangle, Check } from "lucide-react";
import { clsx } from "clsx";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useUploadBlobs } from "@shelby-protocol/react";
import { reserveVideo, prepareVideo, confirmVideo } from "@/lib/api";
import { expirationMicros, shelbyClient, SHELBY_LOCATION } from "@/lib/shelby";
import { useRouter } from "next/navigation";

function bytes(n: number) {
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

type Stage = "idle" | "sending" | "wallet" | "confirming" | "done";

const LABEL: Record<Stage, string> = {
  idle:       "Upload and analyze",
  sending:    "Sending to server…",
  wallet:     "Waiting for wallet…",
  confirming: "Confirming on Shelby…",
  done:       "Starting AI pipeline…",
};

function readable(raw: string): string {
  const r = raw || "";
  if (/reject|cancel|denied|declined/i.test(r))
    return "You cancelled the signing request. Approve it to upload.";
  if (/INSUFFICIENT_BALANCE|insufficient.*(balance|fund|gas)|EINSUFFICIENT/i.test(r))
    return "Your wallet needs testnet APT (for gas) and ShelbyUSD (for storage). Fund it from the Shelby faucet, then try again.";
  if (/failed to sign and submit|sign and submit|submit.*transaction|transaction.*(failed|rejected by)|simulation/i.test(r))
    return "The transaction was signed but could not be submitted. This usually means the wallet has no testnet APT or ShelbyUSD yet - fund it from the Shelby faucet (a new Google-login wallet starts empty), then try again.";
  return r;
}

export function UploadZone() {
  const router = useRouter();
  const { account, signAndSubmitTransaction, connected } = useWallet();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  // Docs pass the client explicitly rather than relying only on context:
  // https://docs.shelby.xyz/sdks/react/guides/dapp-example
  const upload = useUploadBlobs({
    client: shelbyClient,
    onError: (e) => { setErr(readable(e.message)); setStage("idle"); },
  });

  const onDrop = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    setErr(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".webm", ".mov", ".avi", ".mkv"] },
    maxFiles: 1,
    maxSize: 2 * 1024 * 1024 * 1024,
    onDropRejected: (r) => {
      const c = r[0]?.errors[0]?.code;
      if (c === "file-too-large") setErr("That file is over 2 GB. Use a smaller one.");
      else if (c === "file-invalid-type") setErr("Unsupported format. Use MP4, WebM, MOV, AVI or MKV.");
      else setErr(r[0]?.errors[0]?.message ?? "File rejected.");
    },
  });

  const reset = () => {
    setFile(null); setTitle(""); setDesc("");
    setErr(null); setStage("idle"); setPct(0);
  };

  const go = async () => {
    if (!file || !title.trim()) return;
    if (!connected || !account || !signAndSubmitTransaction) {
      setErr("Connect a wallet first — the button is in the top bar.");
      return;
    }
    setErr(null);

    try {
      // Read bytes directly from the File object the user just picked --
      // instant, no network round trip. The old flow uploaded the file
      // to the backend, waited for it to be base64-encoded and sent
      // back down as JSON, then decoded it again here -- slow enough on
      // real videos that the wallet popup could take minutes or never
      // appear before the request timed out.
      setStage("sending"); setPct(0);
      const buf = new Uint8Array(await file.arrayBuffer());
      setPct(15);

      // Reserve an id + blob name FIRST (instant, no file). This lets the
      // backend file upload and the Shelby wallet upload run in parallel
      // instead of one after the other -- the file is no longer sent twice
      // in sequence, so wall-clock upload time drops toward the longer of
      // the two legs rather than their sum.
      const { id, videoBlobName } = await reserveVideo(
        file.name, title, desc, file.type || "video/mp4"
      );
      setPct(25);

      setStage("wallet");

      // ── DEBUG: everything the SDK needs, right before we call mutate ──
      console.log("[VideoMind] about to call uploadBlobs.mutate", {
        connected,
        hasAccount: !!account,
        address: account?.address?.toString(),
        hasSignFn: typeof signAndSubmitTransaction,
        blobName: videoBlobName,
        byteLength: buf.length,
        expirationMicros: expirationMicros(),
      });

      // Leg 1: the file bytes go to the backend (Whisper reads this copy).
      // Progress from this leg drives the bar (25 -> 80).
      const backendUpload = prepareVideo(
        file, title, desc,
        (pp) => setPct(25 + Math.round(pp * 0.55)),
        id
      );

      // Leg 2: the wallet signs and the blob goes to Shelby. Unchanged
      // Shelby call -- same signer shape, blobName, expiration, location.
      const shelbyUpload = new Promise<void>((res, rej) => {
        upload.mutate(
          {
            // Official docs pass account.accountAddress (the AccountAddress
            // OBJECT), not a stringified address. The SDK feeds this into
            // AccountAddress.from(..., {maxMissingChars: 63}).
            signer: { account: account.address as any, signAndSubmitTransaction },
            blobs: [{ blobName: videoBlobName, blobData: buf }],
            expirationMicros: expirationMicros(),
            // Explicit per-write location. Without a location the Move
            // contract rejects the write outright.
            options: { locationHint: SHELBY_LOCATION },
          },
          {
            onSuccess: () => {
              console.log("[VideoMind] uploadBlobs SUCCESS");
              res();
            },
            onError: (e) => {
              console.error("[VideoMind] uploadBlobs FAILED:", e);
              rej(new Error(readable(e.message)));
            },
          }
        );
      });

      // confirm only runs after BOTH the backend file upload AND the Shelby
      // upload have finished -- so the temp file is guaranteed present when
      // the pipeline kicks off, and the blob is committed on-chain.
      await Promise.all([backendUpload, shelbyUpload]);

      setStage("confirming"); setPct(85);
      await confirmVideo({
        id,
        accountAddress: account.address.toString(),
        txHash: `wallet-${Date.now()}`,
        videoBlobName,
      });

      setStage("done"); setPct(100);
      router.push(`/video/${id}`);
    } catch (e: any) {
      console.error("[VideoMind] upload flow threw:", e);
      setErr(readable(e?.message ?? "Upload failed."));
      setStage("idle"); setPct(0);
    }
  };

  const busy = stage !== "idle";
  const canGo = !!file && !!title.trim() && connected && !busy;

  return (
    <div className="space-y-4">

      {/* Wallet state */}
      {!connected ? (
        <div className="flex items-center gap-3 px-3 h-10 border border-signal-dim bg-signal-wash">
          <span className="dot dot-dead" />
          <p className="text-[12px] font-sans text-signal">
            Connect a wallet to upload. Your wallet signs the blob.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-3 h-10 border border-rule">
          <span className="dot dot-live" />
          <p className="tc">
            {account?.address?.toString().slice(0, 6)}…{account?.address?.toString().slice(-4)} will sign
          </p>
        </div>
      )}

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={clsx(
          "relative border border-dashed cursor-pointer transition-colors",
          isDragActive ? "drop-live" : "border-rule hover:border-rule-lit bg-slate"
        )}
      >
        <input {...getInputProps()} />

        {file ? (
          <div className="p-8 flex items-center gap-5">
            {/* Film-strip glyph — the file, as a filmstrip */}
            <svg width="40" height="48" viewBox="0 0 40 48" className="shrink-0" aria-hidden>
              <rect x="0" y="0" width="40" height="48" fill="#0A0A0C" stroke="#26282F" strokeWidth="1"/>
              {[6, 16, 26, 36].map((y) => (
                <g key={y}>
                  <rect x="3" y={y} width="4" height="6" fill="#26282F"/>
                  <rect x="33" y={y} width="4" height="6" fill="#26282F"/>
                </g>
              ))}
              <rect x="11" y="6" width="18" height="36" fill="#FF4D2E" opacity="0.9"/>
            </svg>

            <div className="min-w-0 flex-1">
              <p className="font-display text-[19px] text-paper leading-tight truncate">
                {file.name}
              </p>
              <p className="tc mt-1">{bytes(file.size)}</p>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); reset(); }}
              className="flex items-center gap-1.5 tc hover:text-error transition-colors shrink-0 no-min"
            >
              <X size={11} /> Remove
            </button>
          </div>
        ) : (
          <div className="p-12 text-center">
            <p className="font-display text-[24px] text-paper leading-tight">
              {isDragActive ? "Drop it." : "Drop a video here"}
            </p>
            <p className="tc mt-3">
              MP4 · WebM · MOV · AVI · MKV — up to 2 GB
            </p>
            <p className="tc mt-1 text-dim-2">or click to browse</p>
          </div>
        )}
      </div>

      {/* Metadata */}
      {file && (
        <div className="space-y-3">
          <div>
            <label htmlFor="t" className="eyebrow block mb-1.5">Title</label>
            <input
              id="t"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What is this recording?"
              className="w-full h-10 px-3 text-[14px] font-sans"
            />
          </div>
          <div>
            <label htmlFor="d" className="eyebrow block mb-1.5">Description — optional</label>
            <textarea
              id="d"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              placeholder="Anything that helps you find it later"
              className="w-full px-3 py-2 text-[14px] font-sans resize-none"
            />
          </div>
        </div>
      )}

      {/* Error */}
      {err && (
        <div className="border border-error/40 bg-error/5">
          <div className="flex items-start gap-3 p-3">
            <AlertTriangle size={13} className="text-error shrink-0 mt-0.5" />
            <p className="text-[13px] font-sans text-error leading-relaxed flex-1">{err}</p>
            <button onClick={() => setErr(null)} className="text-dim hover:text-paper shrink-0 no-min">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Progress — a bar that fills, in signal red. it's time passing. */}
      {busy && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="tc">{LABEL[stage]}</span>
            <span className="tc tc-signal tabular-nums">{pct}%</span>
          </div>
          <div className="h-px bg-rule">
            <div
              className="h-full bg-signal transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          {stage === "wallet" && (
            <p className="tc tc-signal">Approve the signing request in your wallet</p>
          )}
        </div>
      )}

      {/* THE BUTTON — always visible, disabled state is legible */}
      <button
        onClick={go}
        disabled={!canGo}
        className={clsx(
          "w-full h-11 text-[14px] font-sans font-medium transition-colors border",
          canGo
            ? "bg-signal border-signal text-void hover:bg-[#FF6449]"
            : "bg-transparent border-rule text-dim cursor-not-allowed"
        )}
      >
        {busy ? LABEL[stage] : (
          !file      ? "Choose a video first"
          : !title.trim() ? "Add a title"
          : !connected    ? "Connect a wallet"
          : "Upload and analyze"
        )}
      </button>
    </div>
  );
}
