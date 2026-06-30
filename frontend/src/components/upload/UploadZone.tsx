"use client";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Film, X, AlertCircle, Wallet, CheckCircle, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useUploadBlobs } from "@shelby-protocol/react";
import { prepareVideo, confirmVideo } from "@/lib/api";
import { expirationMicros } from "@/lib/shelby";
import { useRouter } from "next/navigation";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

type Stage = "idle" | "sending" | "wallet" | "confirming" | "processing";

const STAGE_LABELS: Record<Stage, string> = {
  idle:       "Upload & Analyze",
  sending:    "Sending to server...",
  wallet:     "Waiting for wallet...",
  confirming: "Confirming on-chain...",
  processing: "AI pipeline running...",
};

function friendlyError(raw: string): string {
  if (raw.includes("INSUFFICIENT_BALANCE")) return "Your wallet doesn't have enough APT or ShelbyUSD. Please top up from the testnet faucet.";
  if (raw.includes("User rejected") || raw.includes("rejected")) return "Transaction rejected in wallet. Please try again and approve the signing request.";
  if (raw.includes("Cannot reach") || raw.includes("timed out") || raw.includes("too large")) return raw;
  return raw;
}

export function UploadZone() {
  const router = useRouter();
  const { account, signAndSubmitTransaction, connected } = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadBlobs = useUploadBlobs({
    onError: (err) => { setError(friendlyError(err.message)); setStage("idle"); },
  });

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".webm", ".mov", ".avi", ".mkv"] },
    maxFiles: 1,
    maxSize: 2 * 1024 * 1024 * 1024,
    onDropRejected: (files) => {
      const code = files[0]?.errors[0]?.code;
      if (code === "file-too-large") setError("File exceeds the 2 GB limit.");
      else if (code === "file-invalid-type") setError("Unsupported file type. Please upload MP4, WebM, MOV, AVI or MKV.");
      else setError(files[0]?.errors[0]?.message ?? "File rejected.");
    },
  });

  const reset = () => { setFile(null); setTitle(""); setDescription(""); setError(null); setStage("idle"); setProgress(0); };

  const handleSubmit = async () => {
    if (!file || !title.trim()) return;
    if (!connected || !account || !signAndSubmitTransaction) {
      setError("Please connect your Aptos wallet first using the button in the top navigation.");
      return;
    }
    setError(null);

    try {
      setStage("sending");
      setProgress(0);
      const { id, videoBlobName, base64Data } = await prepareVideo(file, title, description, (pct) => setProgress(Math.round(pct * 0.5)));

      const raw = atob(base64Data);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      setStage("wallet");
      setProgress(55);

      await new Promise<void>((resolve, reject) => {
        uploadBlobs.mutate(
          {
            signer: { account: account.address.toString() as any, signAndSubmitTransaction },
            blobs: [{ blobName: videoBlobName, blobData: bytes }],
            expirationMicros: expirationMicros(),
          },
          { onSuccess: () => resolve(), onError: (err) => reject(new Error(friendlyError(err.message))) }
        );
      });

      setProgress(80);
      setStage("confirming");
      await confirmVideo({ id, accountAddress: account.address.toString(), txHash: `wallet-upload-${Date.now()}`, videoBlobName });

      setProgress(100);
      setStage("processing");
      router.push(`/video/${id}`);
    } catch (err: any) {
      setError(friendlyError(err?.message ?? "Upload failed. Please try again."));
      setStage("idle");
      setProgress(0);
    }
  };

  const busy = stage !== "idle";

  return (
    <div className="space-y-6">
      {!connected ? (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-volt/[0.06] border border-volt/20">
          <Wallet size={16} className="text-volt shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-volt font-syne font-semibold">Wallet required</p>
            <p className="text-xs text-volt/60 font-dm mt-0.5">Connect your Aptos wallet from the top navigation to upload videos to Shelby.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-dark-800 border border-white/[0.06]">
          <CheckCircle size={13} className="text-volt" />
          <span className="text-xs font-mono text-white/50">
            {account?.address?.toString().slice(0, 8)}...{account?.address?.toString().slice(-6)} connected
          </span>
        </div>
      )}

      <div
        {...getRootProps()}
        className={clsx("relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer overflow-hidden", isDragActive ? "upload-zone-active border-volt" : "border-white/10 hover:border-white/20 bg-dark-800/50")}
      >
        <input {...getInputProps()} />
        <div className="p-14 flex flex-col items-center gap-5 text-center">
          {file ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-volt/10 border border-volt/20 flex items-center justify-center"><Film size={28} className="text-volt" /></div>
              <div>
                <p className="font-syne font-semibold text-white text-lg">{file.name}</p>
                <p className="text-white/40 text-sm mt-1 font-mono">{formatBytes(file.size)}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); reset(); }} className="flex items-center gap-1.5 text-xs text-white/30 hover:text-red-400 transition-colors">
                <X size={12} /> Remove file
              </button>
            </>
          ) : (
            <>
              <div className={clsx("w-20 h-20 rounded-2xl border flex items-center justify-center transition-all duration-300", isDragActive ? "bg-volt/20 border-volt" : "bg-dark-700 border-white/10")}>
                <Upload size={32} className={isDragActive ? "text-volt" : "text-white/30"} strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-syne font-semibold text-white text-xl">{isDragActive ? "Drop to upload" : "Drop your video here"}</p>
                <p className="text-white/30 text-sm mt-2">MP4, WebM, MOV, AVI, MKV · Up to 2 GB</p>
              </div>
              <span className="px-4 py-2 rounded-lg bg-volt/10 border border-volt/20 text-volt text-sm font-mono">or click to browse</span>
            </>
          )}
        </div>
        {isDragActive && <div className="scan-line" />}
      </div>

      {file && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-white/40 uppercase tracking-widest mb-2">Title *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give your video a title" className="w-full bg-dark-800 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 font-dm focus:outline-none focus:border-volt/40 focus:bg-dark-700 transition-all" />
          </div>
          <div>
            <label className="block text-xs font-mono text-white/40 uppercase tracking-widest mb-2">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this video about? (optional)" rows={3} className="w-full bg-dark-800 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 font-dm focus:outline-none focus:border-volt/40 focus:bg-dark-700 transition-all resize-none" />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 overflow-hidden">
          <div className="flex items-start gap-3 p-4">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-syne font-semibold text-red-400">Upload failed</p>
              <p className="text-xs text-red-400/70 font-dm mt-1 leading-relaxed">{error}</p>
            </div>
          </div>
          <div className="border-t border-red-500/20 px-4 py-2.5">
            <button onClick={() => setError(null)} className="flex items-center gap-1.5 text-xs text-red-400/60 hover:text-red-400 transition-colors font-mono">
              <RefreshCw size={11} /> Dismiss and retry
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="space-y-3">
          <div className="flex justify-between text-xs font-mono text-white/40">
            <span>{STAGE_LABELS[stage]}</span>
            <span className="text-volt">{progress}%</span>
          </div>
          <div className="h-1 bg-dark-700 rounded-full overflow-hidden">
            <div className="h-full progress-bar rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          {stage === "wallet" && <p className="text-xs text-volt/60 font-mono text-center animate-pulse">⚡ Check your wallet extension — a signing request is waiting</p>}
          {stage === "sending" && <p className="text-xs text-white/25 font-mono text-center">Uploading file to server for processing...</p>}
          {stage === "confirming" && <p className="text-xs text-white/25 font-mono text-center">Shelby upload confirmed — starting AI pipeline...</p>}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!file || !title.trim() || busy || !connected}
        className={clsx("w-full py-4 rounded-xl font-syne font-semibold text-sm tracking-wide transition-all duration-300", file && title.trim() && !busy && connected ? "bg-volt text-black hover:bg-volt-dim volt-glow cursor-pointer" : "bg-dark-700 text-white/20 cursor-not-allowed")}
      >
        {busy ? STAGE_LABELS[stage] : "Upload & Analyze"}
      </button>
    </div>
  );
}
