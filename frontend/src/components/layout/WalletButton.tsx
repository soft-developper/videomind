"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Wallet, ChevronDown, LogOut, Copy, CheckCircle, Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

export function WalletButton() {
  // In wallet-adapter-react v7, connect() returns void — no Promise.
  // We track connecting state manually via isLoading from the context.
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

  // Close wallet picker once connected
  useEffect(() => {
    if (connected) setShowWallets(false);
  }, [connected]);

  function copyAddress() {
    if (!account?.address) return;
    navigator.clipboard.writeText(account.address.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function short(addr: string) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  // ── Connecting / loading state ─────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-dark-700 border border-white/10">
        <Loader2 size={13} className="text-volt animate-spin" />
        <span className="text-xs font-mono text-white/50">Connecting...</span>
      </div>
    );
  }

  // ── Connected state ───────────────────────────────────────────────────
  if (connected && account) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu((v) => !v)}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-volt/20 bg-volt/5 hover:bg-volt/10 transition-all"
        >
          <div className="w-2 h-2 rounded-full bg-volt status-pulse" />
          <span className="font-mono text-xs text-volt">
            {short(account.address.toString())}
          </span>
          <ChevronDown
            size={12}
            className={clsx("text-volt/60 transition-transform", showMenu && "rotate-180")}
          />
        </button>

        {showMenu && (
          <div className="absolute right-0 top-full mt-2 w-56 glass-card rounded-xl overflow-hidden z-50 shadow-xl shadow-black/40">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-1">
                Connected wallet
              </p>
              <p className="font-mono text-xs text-white/70 break-all">
                {short(account.address.toString())}
              </p>
            </div>

            <button
              onClick={copyAddress}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/60 hover:text-white hover:bg-white/[0.04] transition-all"
            >
              {copied
                ? <CheckCircle size={14} className="text-volt" />
                : <Copy size={14} />}
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

  // ── Not connected ─────────────────────────────────────────────────────
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowWallets((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-volt text-black font-syne font-semibold text-xs hover:bg-volt-dim transition-all volt-glow"
      >
        <Wallet size={13} />
        Connect Wallet
        <ChevronDown
          size={12}
          className={clsx("transition-transform", showWallets && "rotate-180")}
        />
      </button>

      {showWallets && (
        <div className="absolute right-0 top-full mt-2 w-56 glass-card rounded-xl overflow-hidden z-50 shadow-xl shadow-black/40">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <p className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
              Select wallet
            </p>
          </div>

          {wallets.length === 0 && (
            <div className="px-4 py-4 text-center">
              <p className="text-xs text-white/30 font-dm leading-relaxed">
                No Aptos wallets detected.
                <br />
                Install{" "}
                <a
                  href="https://petra.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-volt underline"
                >
                  Petra Wallet
                </a>{" "}
                to continue.
              </p>
            </div>
          )}

          {wallets.map((wallet) => (
            <button
              key={wallet.name}
              onClick={() => {
                // v7: connect() returns void, not a Promise
                connect(wallet.name);
                setShowWallets(false);
              }}
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
