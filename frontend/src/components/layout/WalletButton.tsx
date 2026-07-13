"use client";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown, LogOut, Copy, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

export function WalletButton() {
  const { connect, disconnect, connected, isLoading, account, wallets = [] } = useWallet();
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenu(false); setPicker(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => { if (connected) setPicker(false); }, [connected]);

  const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 h-8 border border-rule">
        <span className="dot dot-work" />
        <span className="tc">Connecting</span>
      </div>
    );
  }

  if (connected && account) {
    const addr = account.address.toString();
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setMenu((v) => !v)}
          className="flex items-center gap-2 px-3 h-8 border border-rule hover:border-rule-lit transition-colors"
        >
          <span className="dot dot-live" />
          <span className="tc text-paper-2">{short(addr)}</span>
          <ChevronDown size={11} className={clsx("text-dim transition-transform", menu && "rotate-180")} />
        </button>

        {menu && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-void border border-rule z-50">
            <div className="px-3 py-2.5 border-b border-rule">
              <p className="eyebrow mb-1">Wallet</p>
              <p className="tc text-paper-2">{short(addr)}</p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(addr);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-paper-2 hover:text-paper hover:bg-slate transition-colors"
            >
              {copied ? <Check size={12} className="text-marker" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <button
              onClick={() => { disconnect(); setMenu(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-dim hover:text-error hover:bg-slate transition-colors border-t border-rule"
            >
              <LogOut size={12} />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setPicker((v) => !v)}
        className="btn btn-signal px-3.5 h-8 flex items-center gap-1.5"
      >
        Connect wallet
        <ChevronDown size={11} className={clsx("transition-transform", picker && "rotate-180")} />
      </button>

      {picker && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-void border border-rule z-50">
          <div className="px-3 py-2 border-b border-rule">
            <p className="eyebrow">Select wallet</p>
          </div>

          {wallets.length === 0 && (
            <p className="px-3 py-3 text-[12px] font-sans text-dim leading-relaxed">
              No Aptos wallet found. Install{" "}
              <a
                href="https://petra.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal underline"
              >
                Petra
              </a>{" "}
              to continue.
            </p>
          )}

          {wallets.map((w) => (
            <button
              key={w.name}
              onClick={() => { connect(w.name); setPicker(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-paper-2 hover:text-paper hover:bg-slate transition-colors"
            >
              {w.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.icon} alt="" className="w-4 h-4" />
              )}
              {w.name}
              {w.readyState === "Installed" && (
                <span className="ml-auto tc tc-marker">ready</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
