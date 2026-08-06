"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { clsx } from "clsx";
import { WalletButton } from "./WalletButton";
import { ExpiryBanner } from "./ExpiryBanner";
import { useState, useEffect } from "react";

const NAV = [
  { href: "/",          label: "Library" },
  { href: "/upload",    label: "Upload" },
  { href: "/search",    label: "Search" },
  { href: "/assistant", label: "Assistant" },
  { href: "/learn",     label: "Learn" },
  { href: "/about",     label: "About" },
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
      <nav className="fixed top-0 inset-x-0 z-50 h-14 bg-void border-b border-rule">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-4">

          {/* Mark — a playhead triangle. the product IS a playhead. */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
              <path
                d="M7 16L0 0h14L7 16z"
                className="fill-signal group-hover:fill-[#FF6449] transition-colors"
              />
            </svg>
            <span className="font-display text-[19px] leading-none text-paper tracking-tight">
              VideoMind
            </span>
          </Link>

          {/* Links — text only. no icons. */}
          <div className="hidden md:flex items-center">
            {NAV.map(({ href, label }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "px-3 py-1.5 text-[13px] font-sans transition-colors relative",
                    active ? "text-paper" : "text-dim hover:text-paper-2"
                  )}
                >
                  {label}
                  {active && (
                    <span className="absolute bottom-0 left-3 right-3 h-px bg-signal" />
                  )}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <span className="dot dot-live" />
              <span className="tc">Shelbynet</span>
            </div>
            <WalletButton />
            <button
              onClick={() => setOpen((v) => !v)}
              className="md:hidden w-8 h-8 flex items-center justify-center text-dim hover:text-paper transition-colors"
              aria-label="Menu"
            >
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
      </nav>

      <ExpiryBanner />

      {/* Mobile drawer */}
      <div className={clsx(
        "fixed inset-0 z-40 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}>
        <div
          className={clsx(
            "absolute inset-0 bg-void/90 transition-opacity duration-200",
            open ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setOpen(false)}
        />
        <div className={clsx(
          "absolute top-14 inset-x-0 bg-void border-b border-rule transition-transform duration-200",
          open ? "translate-y-0" : "-translate-y-full"
        )}>
          {NAV.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex items-center px-6 py-3.5 text-sm font-sans border-b border-rule/50 transition-colors",
                  active ? "text-paper bg-slate" : "text-dim"
                )}
              >
                {active && <span className="w-0.5 h-4 bg-signal mr-3 -ml-3" />}
                {label}
              </Link>
            );
          })}
          <div className="flex items-center gap-2 px-6 py-3">
            <span className="dot dot-live" />
            <span className="tc">Shelbynet</span>
          </div>
        </div>
      </div>
    </>
  );
}
