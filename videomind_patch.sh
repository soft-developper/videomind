#!/usr/bin/env bash
# VideoMind — Complete patch script
# Run from your project root: /home/probeat/videomind
# Usage: bash videomind_patch.sh

set -e
ROOT="$(pwd)"
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"

echo "🚀 VideoMind patch starting from $ROOT"
echo ""

# ─── Verify we're in the right directory ─────────────────────────────────────
if [ ! -d "$FRONTEND" ] || [ ! -d "$BACKEND" ]; then
  echo "❌ Run this script from /home/probeat/videomind (the project root)"
  exit 1
fi

mkdir -p "$FRONTEND/src/components/layout"
mkdir -p "$FRONTEND/src/components/video"
mkdir -p "$FRONTEND/src/components/ui"
mkdir -p "$FRONTEND/src/app/video/[id]"
mkdir -p "$BACKEND/src/lib"
mkdir -p "$BACKEND/src/routes"
mkdir -p "$BACKEND/src/services"
mkdir -p "$BACKEND/src/cron"

echo "✅ Directories verified"

# ═══════════════════════════════════════════════════════════════════════════════
# BACKEND FILES
# ═══════════════════════════════════════════════════════════════════════════════

# ── backend/src/lib/shelbyClient.ts ──────────────────────────────────────────
cat > "$BACKEND/src/lib/shelbyClient.ts" << 'EOF'
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { Ed25519Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import "dotenv/config";

const MAX_EXPIRY_HOURS = 47;
const MICROS_PER_HOUR = 3_600_000_000;

export function expirationMicros(hours = MAX_EXPIRY_HOURS): number {
  return Date.now() * 1000 + hours * MICROS_PER_HOUR;
}

let _account: Ed25519Account | null = null;
export function getShelbyAccount(): Ed25519Account {
  if (_account) return _account;
  const rawKey = process.env.APTOS_PRIVATE_KEY;
  if (!rawKey) throw new Error("APTOS_PRIVATE_KEY not set in .env");
  _account = new Ed25519Account({ privateKey: new Ed25519PrivateKey(rawKey) });
  return _account;
}

let _client: ShelbyNodeClient | null = null;
export function getShelbyClient(): ShelbyNodeClient {
  if (_client) return _client;
  const apiKey = process.env.APTOS_API_KEY;
  if (!apiKey) throw new Error("APTOS_API_KEY not set in .env");
  _client = new ShelbyNodeClient({ network: Network.TESTNET, apiKey });
  return _client;
}

export async function uploadToShelby(
  blobData: Buffer,
  blobName: string
): Promise<{ blobName: string; accountAddress: string; txHash: string }> {
  const client = getShelbyClient();
  const signer = getShelbyAccount();

  const result = await client.upload({
    signer,
    blobData,
    blobName,
    expirationMicros: expirationMicros(),
  }) as { transaction?: { hash: string } } | void;

  const txHash =
    result && typeof result === "object" && result.transaction
      ? result.transaction.hash
      : `upload-${Date.now()}`;

  return { blobName, accountAddress: signer.accountAddress.toString(), txHash };
}

export async function downloadFromShelby(blobName: string, ownerAddress: string): Promise<Buffer> {
  const client = getShelbyClient();
  const blob = await client.download({ account: ownerAddress, blobName });
  const chunks: Buffer[] = [];
  for await (const chunk of blob.readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function shelbyBlobUrl(blobName: string, ownerAddress: string): string {
  const encodedPath = blobName.split("/").map(encodeURIComponent).join("/");
  return `https://api.testnet.shelby.xyz/shelby/v1/blobs/${ownerAddress}/${encodedPath}`;
}
EOF
echo "✅ backend/src/lib/shelbyClient.ts"

# ── backend/src/cron/renewBlobs.ts ───────────────────────────────────────────
cat > "$BACKEND/src/cron/renewBlobs.ts" << 'EOF'
import "dotenv/config";

// Video blobs are wallet-owned (uploaded by Petra on the frontend).
// The backend has no authority to renew them.
// Renewal is handled by the ExpiryBanner component on the frontend.
export async function renewExpiringBlobs() {
  console.log("[Renew] Video blobs are wallet-owned — renewal handled by frontend.");
  console.log("[Renew] Done. Renewed 0 blob(s).");
}

renewExpiringBlobs().catch(console.error);
EOF
echo "✅ backend/src/cron/renewBlobs.ts"

# ── backend/src/index.ts ─────────────────────────────────────────────────────
cat > "$BACKEND/src/index.ts" << 'EOF'
import "dotenv/config";
import express from "express";
import cors from "cors";
import { migrate } from "./lib/db.js";
import { renewExpiringBlobs } from "./cron/renewBlobs.js";
import videosRouter from "./routes/videos.js";
import chatRouter from "./routes/chat.js";
import statsRouter from "./routes/stats.js";
import cron from "node-cron";

const app = express();
const PORT = process.env.PORT ?? 4000;

const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/videos", videosRouter);
app.use("/api/chat", chatRouter);
app.use("/api/shelby", statsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "VideoMind API", timestamp: new Date().toISOString() });
});

cron.schedule("0 */6 * * *", () => {
  console.log("[Cron] Running scheduled blob renewal check...");
  renewExpiringBlobs().catch(console.error);
});

async function main() {
  await migrate();
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║       VideoMind API Server               ║
║       Running on port ${PORT}              ║
║       Shelby Testnet ✓                   ║
║       Turso DB ✓                         ║
╚══════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => { console.error("Failed to start:", err); process.exit(1); });
EOF
echo "✅ backend/src/index.ts"

# ═══════════════════════════════════════════════════════════════════════════════
# FRONTEND FILES
# ═══════════════════════════════════════════════════════════════════════════════

# ── frontend/src/lib/shelby.ts ───────────────────────────────────────────────
cat > "$FRONTEND/src/lib/shelby.ts" << 'EOF'
import { ShelbyClient } from "@shelby-protocol/sdk/browser";

export const shelbyClient = new ShelbyClient({
  network: "testnet" as any,
  apiKey: process.env.NEXT_PUBLIC_APTOS_API_KEY,
});

export function expirationMicros(): number {
  return Date.now() * 1000 + 47 * 3_600_000_000;
}
EOF
echo "✅ frontend/src/lib/shelby.ts"

# ── frontend/src/components/layout/AppProviders.tsx ──────────────────────────
cat > "$FRONTEND/src/components/layout/AppProviders.tsx" << 'EOF'
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { ShelbyClientProvider } from "@shelby-protocol/react";
import { useState } from "react";
import { shelbyClient } from "@/lib/shelby";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 10_000 } },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <AptosWalletAdapterProvider
        autoConnect
        dappConfig={{
          network: "testnet" as any,
          aptosApiKeys: { testnet: process.env.NEXT_PUBLIC_APTOS_API_KEY },
        }}
        onError={(error) => console.error("[Wallet]", error)}
      >
        <ShelbyClientProvider client={shelbyClient}>
          {children}
        </ShelbyClientProvider>
      </AptosWalletAdapterProvider>
    </QueryClientProvider>
  );
}
EOF
echo "✅ frontend/src/components/layout/AppProviders.tsx"

# ── frontend/src/components/layout/WalletButton.tsx ──────────────────────────
cat > "$FRONTEND/src/components/layout/WalletButton.tsx" << 'EOF'
"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Wallet, ChevronDown, LogOut, Copy, CheckCircle, Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

export function WalletButton() {
  const { connect, disconnect, connected, isLoading, account, wallets = [] } = useWallet();
  const [showMenu, setShowMenu] = useState(false);
  const [showWallets, setShowWallets] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setShowWallets(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => { if (connected) setShowWallets(false); }, [connected]);

  function copyAddress() {
    if (!account?.address) return;
    navigator.clipboard.writeText(account.address.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function short(addr: string) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-dark-700 border border-white/10">
        <Loader2 size={13} className="text-volt animate-spin" />
        <span className="text-xs font-mono text-white/50">Connecting...</span>
      </div>
    );
  }

  if (connected && account) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu((v) => !v)}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-volt/20 bg-volt/5 hover:bg-volt/10 transition-all"
        >
          <div className="w-2 h-2 rounded-full bg-volt status-pulse" />
          <span className="font-mono text-xs text-volt">{short(account.address.toString())}</span>
          <ChevronDown size={12} className={clsx("text-volt/60 transition-transform", showMenu && "rotate-180")} />
        </button>

        {showMenu && (
          <div className="absolute right-0 top-full mt-2 w-56 glass-card rounded-xl overflow-hidden z-50 shadow-xl shadow-black/40">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">Connected wallet</p>
              <p className="font-mono text-xs text-white/70 break-all">{short(account.address.toString())}</p>
            </div>
            <button
              onClick={copyAddress}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/60 hover:text-white hover:bg-white/[0.04] transition-all"
            >
              {copied ? <CheckCircle size={14} className="text-volt" /> : <Copy size={14} />}
              {copied ? "Copied!" : "Copy address"}
            </button>
            <button
              onClick={() => { disconnect(); setShowMenu(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400/70 hover:text-red-400 hover:bg-red-500/[0.06] transition-all border-t border-white/[0.06]"
            >
              <LogOut size={14} />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowWallets((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-volt text-black font-syne font-semibold text-xs hover:bg-volt-dim transition-all volt-glow"
      >
        <Wallet size={13} />
        Connect Wallet
        <ChevronDown size={12} className={clsx("transition-transform", showWallets && "rotate-180")} />
      </button>

      {showWallets && (
        <div className="absolute right-0 top-full mt-2 w-56 glass-card rounded-xl overflow-hidden z-50 shadow-xl shadow-black/40">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">Select wallet</p>
          </div>

          {wallets.length === 0 && (
            <div className="px-4 py-4 text-center">
              <p className="text-xs text-white/30 font-dm leading-relaxed">
                No Aptos wallets detected.<br />
                Install{" "}
                <a href="https://petra.app" target="_blank" rel="noopener noreferrer" className="text-volt underline">
                  Petra Wallet
                </a>{" "}
                to continue.
              </p>
            </div>
          )}

          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              onClick={() => { connect(wallet.name); setShowWallets(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:text-white hover:bg-white/[0.04] transition-all"
            >
              {wallet.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 rounded" />
              )}
              <span className="font-dm">{wallet.name}</span>
              {wallet.readyState === "Installed" && (
                <span className="ml-auto text-[10px] font-mono text-volt/60">Installed</span>
              )}
              {wallet.readyState === "NotDetected" && (
                <span className="ml-auto text-[10px] font-mono text-white/20">Not installed</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
EOF
echo "✅ frontend/src/components/layout/WalletButton.tsx"

# ── frontend/src/components/layout/ExpiryBanner.tsx ──────────────────────────
cat > "$FRONTEND/src/components/layout/ExpiryBanner.tsx" << 'EOF'
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

  const { data: blobs, isLoading } = useAccountBlobs(
    { account: walletAddress! },
    { enabled: !!walletAddress && connected }
  );

  const uploadBlobs = useUploadBlobs({
    onError: (err) => { setErrMsg(err.message); setRenewState("error"); },
  });

  if (!connected || !walletAddress || dismissed || isLoading) return null;

  const nowMicros = Date.now() * 1000;
  const expiringBlobs = (blobs ?? []).filter((blob) => {
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

  const expiredCount = expiringBlobs.filter((b) => Number(b.expires_at ?? 0) < nowMicros).length;
  const soonCount = expiringBlobs.length - expiredCount;

  const handleRenewAll = async () => {
    if (!account || !signAndSubmitTransaction) return;
    setRenewState("fetching");
    setErrMsg(null);

    try {
      const blobPayloads = await Promise.all(
        expiringBlobs
          .filter((b) => Number(b.expires_at ?? 0) > nowMicros)
          .map(async (blob) => {
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
              {renewState === "idle"    && <><RefreshCw size={11} /> Renew All ({soonCount})</>}
              {renewState === "fetching"&& <><Loader2 size={11} className="animate-spin" /> Fetching videos...</>}
              {renewState === "signing" && <><Loader2 size={11} className="animate-spin" /> Check wallet...</>}
              {renewState === "error"   && <><RefreshCw size={11} /> Retry</>}
            </button>
            {renewState === "signing" && (
              <p className="text-[10px] font-mono text-volt/60 animate-pulse">
                ⚡ One signature renews all
              </p>
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
EOF
echo "✅ frontend/src/components/layout/ExpiryBanner.tsx"

# ── frontend/src/components/layout/Navbar.tsx ────────────────────────────────
cat > "$FRONTEND/src/components/layout/Navbar.tsx" << 'EOF'
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Upload, Search, LayoutGrid, Zap, Menu, X, Info } from "lucide-react";
import { clsx } from "clsx";
import { WalletButton } from "./WalletButton";
import { ExpiryBanner } from "./ExpiryBanner";
import { useState, useEffect } from "react";

const NAV = [
  { href: "/",       label: "Library", icon: LayoutGrid },
  { href: "/upload", label: "Upload",  icon: Upload },
  { href: "/search", label: "Search",  icon: Search },
  { href: "/about",  label: "About",   icon: Info },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/[0.06] glass-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-lg bg-volt/20 group-hover:bg-volt/30 transition-colors" />
              <Brain className="relative w-8 h-8 p-1.5 text-volt" strokeWidth={1.5} />
            </div>
            <span className="font-syne font-800 text-lg tracking-tight text-white">
              Video<span className="text-volt">Mind</span>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-dm transition-all duration-200",
                    active ? "text-volt bg-volt/10 border border-volt/20" : "text-white/50 hover:text-white hover:bg-white/[0.06]"
                  )}
                >
                  <Icon size={13} />
                  {label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-volt/20 bg-volt/5">
              <Zap size={12} className="text-volt" />
              <span className="font-mono text-xs text-volt/80 hidden lg:block">Shelby Testnet</span>
              <div className="w-1.5 h-1.5 rounded-full bg-volt status-pulse" />
            </div>
            <WalletButton />
            <button
              onClick={() => setOpen((v) => !v)}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg bg-dark-700 border border-white/10 text-white/60 hover:text-white transition-colors"
              aria-label="Toggle menu"
            >
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Expiry banner — shown when wallet-owned blobs are expiring */}
      <ExpiryBanner />

      {/* Mobile drawer */}
      <div className={clsx("fixed inset-0 z-40 md:hidden transition-all duration-300", open ? "pointer-events-auto" : "pointer-events-none")}>
        <div
          className={clsx("absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300", open ? "opacity-100" : "opacity-0")}
          onClick={() => setOpen(false)}
        />
        <div className={clsx("absolute top-16 left-0 right-0 glass-card border-b border-white/[0.06] transition-transform duration-300", open ? "translate-y-0" : "-translate-y-full")}>
          <div className="p-4 space-y-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-dm transition-all",
                    active ? "text-volt bg-volt/10 border border-volt/20" : "text-white/60 hover:text-white hover:bg-white/[0.06]"
                  )}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              );
            })}
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-volt/10 bg-volt/[0.03] mt-2">
              <Zap size={12} className="text-volt" />
              <span className="font-mono text-xs text-volt/60">Shelby Testnet</span>
              <div className="w-1.5 h-1.5 rounded-full bg-volt status-pulse ml-auto" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
EOF
echo "✅ frontend/src/components/layout/Navbar.tsx"

# ── frontend/src/components/video/RenewButton.tsx ────────────────────────────
cat > "$FRONTEND/src/components/video/RenewButton.tsx" << 'EOF'
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
EOF
echo "✅ frontend/src/components/video/RenewButton.tsx"

# ── frontend/src/app/video/[id]/page.tsx ─────────────────────────────────────
cat > "$FRONTEND/src/app/video/[id]/page.tsx" << 'EOF'
"use client";
import { useQuery } from "@tanstack/react-query";
import { getVideo } from "@/lib/api";
import { Navbar } from "@/components/layout/Navbar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { InsightsPanel } from "@/components/video/InsightsPanel";
import { ProcessingStatus } from "@/components/video/ProcessingStatus";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { RenewButton } from "@/components/video/RenewButton";
import { SkeletonVideoPage } from "@/components/ui/SkeletonCard";
import {
  ArrowLeft, Zap, ExternalLink, FileText,
  AlertTriangle, MessageSquare, Brain, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { clsx } from "clsx";

export default function VideoPage({ params }: { params: { id: string } }) {
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const { data: video, isLoading, refetch } = useQuery({
    queryKey: ["video", params.id],
    queryFn: () => getVideo(params.id),
    refetchInterval: (query) =>
      query.state.data?.status && ["ready", "error"].includes(query.state.data.status) ? false : 5000,
    retry: 2,
  });

  const onReady = useCallback(() => { refetch(); }, [refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen gradient-mesh">
        <Navbar />
        <main className="pt-20 sm:pt-24 pb-16 px-4 sm:px-6 max-w-7xl mx-auto">
          <SkeletonVideoPage />
        </main>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen gradient-mesh flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-dark-800 border border-white/10 flex items-center justify-center mx-auto">
            <AlertTriangle size={20} className="text-white/20" />
          </div>
          <p className="text-white/40 font-dm">Video not found</p>
          <Link href="/" className="text-volt text-sm font-mono hover:underline">← Back to library</Link>
        </div>
      </div>
    );
  }

  const isReady      = video.status === "ready";
  const isError      = video.status === "error";
  const isProcessing = !["ready", "error"].includes(video.status);

  return (
    <div className="min-h-screen gradient-mesh">
      <Navbar />
      <main className="pt-16 sm:pt-20 pb-24 lg:pb-16 px-4 sm:px-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-start gap-3 py-5 border-b border-white/[0.06] mb-6">
          <Link href="/" className="flex items-center gap-1.5 text-white/30 hover:text-white text-xs font-mono transition-colors mt-1 shrink-0">
            <ArrowLeft size={12} /> Library
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-syne font-800 text-lg sm:text-xl text-white leading-tight line-clamp-2">{video.title}</h1>
            {video.description && <p className="text-sm text-white/40 font-dm mt-1 line-clamp-1">{video.description}</p>}
          </div>
          {video.shelby.accountAddress && (
            <a
              href={`https://explorer.shelby.xyz/testnet/accounts/${video.shelby.accountAddress}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-volt/20 bg-volt/5 hover:bg-volt/10 transition-all group shrink-0"
            >
              <Zap size={11} className="text-volt" />
              <span className="font-mono text-[10px] text-volt/70 group-hover:text-volt hidden sm:block">
                {video.shelby.accountAddress.slice(0, 6)}...{video.shelby.accountAddress.slice(-4)}
              </span>
              <ExternalLink size={10} className="text-volt/40" />
            </a>
          )}
        </div>

        {/* Processing */}
        {isProcessing && (
          <div className="max-w-lg mx-auto py-8">
            <ProcessingStatus videoId={params.id} onReady={onReady} />
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="max-w-lg mx-auto py-8">
            <div className="glass-card rounded-2xl p-8 text-center space-y-4">
              <AlertTriangle size={32} className="text-red-400 mx-auto" />
              <div>
                <p className="font-syne font-semibold text-white">Processing failed</p>
                <p className="text-sm text-white/40 font-dm mt-1">Something went wrong during AI processing.</p>
              </div>
              <Link href="/upload" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-volt text-black font-syne font-semibold text-sm hover:bg-volt-dim transition-all">
                Try uploading again
              </Link>
            </div>
          </div>
        )}

        {/* Ready layout */}
        {isReady && (
          <div className="grid lg:grid-cols-[1fr_380px] gap-6">
            <div className="space-y-5">
              {/* Video player */}
              <VideoPlayer
                streamUrl={video.streamUrl ?? null}
                title={video.title}
                shelbyAddress={video.shelby.accountAddress}
                blobName={video.shelby.videoBlobName}
              />

              {/* Renew button */}
              {video.streamUrl && (
                <div className="flex items-center justify-between px-1">
                  <p className="text-[11px] font-mono text-white/20">
                    Shelby blobs expire after 48hrs
                  </p>
                  <RenewButton
                    streamUrl={video.streamUrl}
                    videoBlobName={video.shelby.videoBlobName}
                    onRenewed={() => refetch()}
                  />
                </div>
              )}

              {/* Tags */}
              {video.ai?.tags && video.ai.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {video.ai.tags.map((tag) => (
                    <span key={tag} className="px-3 py-1 rounded-full bg-dark-800 border border-white/[0.06] text-xs font-mono text-white/35">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* AI Insights */}
              <InsightsPanel video={video} />

              {/* Full transcript */}
              {video.ai?.transcript && video.ai.transcript.length > 0 && (
                <div className="glass-card rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-3 p-4 border-b border-white/[0.06]">
                    <FileText size={14} className="text-white/40" />
                    <p className="text-sm font-syne font-semibold text-white">Full Transcript</p>
                    <span className="ml-auto font-mono text-xs text-white/25">{video.ai.transcript.length} segments</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-4 space-y-2">
                    {video.ai.transcript.map((seg, i) => (
                      <div key={i} className="flex items-start gap-3 group">
                        <span className="font-mono text-[10px] text-volt/50 shrink-0 mt-1 w-10 text-right">
                          {Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, "0")}
                        </span>
                        <p className="text-sm text-white/55 font-dm leading-relaxed group-hover:text-white/80 transition-colors">{seg.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Desktop chat */}
            <div className="hidden lg:block lg:sticky lg:top-20 lg:h-[calc(100vh-5rem)]">
              <div className="glass-card rounded-2xl h-full flex flex-col overflow-hidden">
                <ChatPanel videoId={params.id} videoTitle={video.title} />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile chat */}
      {isReady && (
        <>
          <button
            onClick={() => setMobileChatOpen(true)}
            className="lg:hidden fixed bottom-6 right-4 z-30 flex items-center gap-2 px-4 py-3 rounded-2xl bg-volt text-black font-syne font-semibold text-sm shadow-lg shadow-volt/20 volt-glow"
          >
            <MessageSquare size={16} />
            Ask AI
          </button>

          <div className={clsx("lg:hidden fixed inset-0 z-40 transition-all duration-300", mobileChatOpen ? "pointer-events-auto" : "pointer-events-none")}>
            <div
              className={clsx("absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300", mobileChatOpen ? "opacity-100" : "opacity-0")}
              onClick={() => setMobileChatOpen(false)}
            />
            <div className={clsx("absolute bottom-0 left-0 right-0 glass-card rounded-t-3xl border-t border-white/[0.08] transition-transform duration-300 flex flex-col h-[85vh]", mobileChatOpen ? "translate-y-0" : "translate-y-full")}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-2">
                  <Brain size={14} className="text-volt" />
                  <span className="text-sm font-syne font-semibold text-white">Ask the Video</span>
                </div>
                <button onClick={() => setMobileChatOpen(false)} className="w-8 h-8 rounded-lg bg-dark-700 border border-white/10 flex items-center justify-center text-white/40 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChatPanel videoId={params.id} videoTitle={video.title} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
EOF
echo "✅ frontend/src/app/video/[id]/page.tsx"

# ── frontend/src/components/upload/UploadZone.tsx ────────────────────────────
cat > "$FRONTEND/src/components/upload/UploadZone.tsx" << 'EOF'
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
EOF
echo "✅ frontend/src/components/upload/UploadZone.tsx"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo "✅ All files written successfully!"
echo "════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  git add ."
echo "  git commit -m 'feat: expiry banner + renew button + all TypeScript fixes'"
echo "  git push"
echo ""
echo "Vercel will auto-deploy from your push."
