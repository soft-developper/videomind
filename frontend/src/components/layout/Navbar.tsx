"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, Upload, Search, LayoutGrid, Zap, Menu, X, Info } from "lucide-react";
import { clsx } from "clsx";
import { WalletButton } from "./WalletButton";
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

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-lg bg-volt/20 group-hover:bg-volt/30 transition-colors" />
              <Brain className="relative w-8 h-8 p-1.5 text-volt" strokeWidth={1.5} />
            </div>
            <span className="font-syne font-800 text-lg tracking-tight text-white">
              Video<span className="text-volt">Mind</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-dm transition-all duration-200",
                    active
                      ? "text-volt bg-volt/10 border border-volt/20"
                      : "text-white/50 hover:text-white hover:bg-white/[0.06]"
                  )}
                >
                  <Icon size={13} />
                  {label}
                </Link>
              );
            })}
          </div>

          {/* Right side */}
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

      {/* Mobile drawer */}
      <div className={clsx(
        "fixed inset-0 z-40 md:hidden transition-all duration-300",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}>
        <div
          className={clsx(
            "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setOpen(false)}
        />
        <div className={clsx(
          "absolute top-16 left-0 right-0 glass-card border-b border-white/[0.06] transition-transform duration-300",
          open ? "translate-y-0" : "-translate-y-full"
        )}>
          <div className="p-4 space-y-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-dm transition-all",
                    active
                      ? "text-volt bg-volt/10 border border-volt/20"
                      : "text-white/60 hover:text-white hover:bg-white/[0.06]"
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
