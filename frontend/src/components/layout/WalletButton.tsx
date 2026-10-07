"use client";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown, LogOut, Copy, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";
import { useAuth } from "./AuthProvider";

/**
 * vm_shell: `block` makes the button fill its container (the sidebar),
 * `placement="up"` opens its menu above it instead of below, and `quiet`
 * draws Connect as a secondary button, for places where the page already
 * has its own main action.
 */
export function WalletButton({ block = false, placement = "down", quiet = false }: {
  block?: boolean; placement?: "up" | "down"; quiet?: boolean;
} = {}) {
  const { connect, disconnect, connected, isLoading, account, wallets = [] } = useWallet();
  // vm_signin: sign in right after a wallet the visitor picked connects,
  // and end the session when they disconnect.
  const { armSignIn, signOut, signedIn } = useAuth();
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

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const pop = clsx(
    "absolute z-50 popover",
    block ? "left-0 right-0" : "right-0 w-56",
    placement === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
  );

  if (isLoading) {
    return (
      <div className={clsx("flex items-center gap-2 px-3 h-9 border border-rule rounded", block && "w-full")}>
        <span className="dot dot-work" />
        <span className="text-[13px] text-dim">Connecting</span>
      </div>
    );
  }

  if (connected && account) {
    const addr = account.address.toString();
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setMenu((v) => !v)}
          aria-expanded={menu}
          className={clsx(
            "flex items-center gap-2 px-3 h-9 border border-rule rounded hover:border-rule-lit hover:bg-slate transition-colors",
            block && "w-full"
          )}
        >
          <span className={signedIn ? "dot dot-live" : "dot dot-dead"} />
          <span className="tc text-[13px] text-paper-2">{short(addr)}</span>
          <ChevronDown size={13} className={clsx("ml-auto text-dim transition-transform", menu !== (placement === "up") && "rotate-180")} />
        </button>

        {menu && (
          <div className={pop}>
            <div className="px-3 py-2.5 border-b border-rule">
              <p className="text-[13px] text-paper">{signedIn ? "Signed in" : "Connected, not signed in"}</p>
              <p className="tc mt-0.5">{short(addr)}</p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(addr);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-paper-2 hover:text-paper hover:bg-slate-2 transition-colors"
            >
              {copied ? <Check size={12} className="text-marker" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <button
              onClick={() => { void signOut(); disconnect(); setMenu(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-paper-2 hover:text-error hover:bg-slate-2 transition-colors border-t border-rule"
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
        aria-expanded={picker}
        className={clsx("btn px-3.5 h-9 flex items-center gap-1.5", quiet ? "btn-ghost text-paper" : "btn-signal", block && "w-full justify-center")}
      >
        Connect wallet
        <ChevronDown size={13} className={clsx("transition-transform", picker !== (placement === "up") && "rotate-180")} />
      </button>

      {picker && (
        <div className={pop}>
          <div className="px-3 py-2.5 border-b border-rule">
            <p className="text-[13px] text-paper">Choose a wallet</p>
          </div>

          {wallets.length === 0 && (
            <p className="px-3 py-3 text-[12px] font-sans text-dim leading-relaxed">
              No Aptos wallet found. Install{" "}
              <a
                href="https://petra.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-paper underline underline-offset-2"
              >
                Petra
              </a>{" "}
              to continue.
            </p>
          )}

          {wallets.map((w) => (
            <button
              key={w.name}
              onClick={() => { armSignIn(); connect(w.name); setPicker(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-sans text-paper-2 hover:text-paper hover:bg-slate-2 transition-colors"
            >
              {w.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.icon} alt="" className="w-4 h-4" />
              )}
              {w.name}
              {w.readyState === "Installed" && (
                <span className="ml-auto text-[12px] text-marker">Installed</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
