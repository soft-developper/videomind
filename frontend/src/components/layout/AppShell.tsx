"use client";
// vm_shell: the frame every workspace page sits in. A sidebar on wide
// screens, a top bar with a slide in menu on narrow ones.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Home, Film, Upload, Disc, Radio, Search, BookOpen, MessageSquare,
  BarChart3, User, Settings, Menu, X, type LucideIcon,
} from "lucide-react";
import { getVideos } from "@/lib/api";
import { SHELBYNET_URLS } from "@/lib/network";
import { WalletButton } from "./WalletButton";
import { SignInNotice } from "./SignInNotice";
import { useSessionWallet } from "./AuthProvider";

/**
 * The preview shows the whole planned structure. Items that are not
 * built yet are listed, greyed out and marked "Soon", so the shape of
 * the product can be judged now. Set this to false to list only what works.
 */
const SHOW_PLANNED = true;

interface Item { label: string; href?: string; icon?: LucideIcon; match?: (path: string) => boolean }
interface Group { label?: string; items: Item[] }

const NAV: Group[] = [
  { items: [{ label: "Home", href: "/", icon: Home }] },
  {
    label: "Library",
    items: [
      { label: "All videos", href: "/library", icon: Film, match: (p) => p === "/library" || p.startsWith("/video/") },
      { label: "Courses" }, { label: "Lectures" }, { label: "Seminars" },
      { label: "Presentations" }, { label: "Events" }, { label: "Live recordings" },
    ],
  },
  {
    label: "Create",
    items: [
      { label: "Upload", href: "/upload", icon: Upload },
      { label: "Record", icon: Disc },
      { label: "Go live", icon: Radio },
    ],
  },
  {
    label: "Discover",
    items: [
      { label: "Search", href: "/search", icon: Search },
      { label: "Knowledge", href: "/learn", icon: BookOpen },
      { label: "Ask your library", href: "/assistant", icon: MessageSquare },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Analytics", icon: BarChart3 },
      { label: "Profile", icon: User },
      { label: "Settings", icon: Settings },
    ],
  },
];

function Mark() {
  // The playhead, in the one accent: it marks where you are.
  return (
    <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
      <path d="M7 15.2 0.6 1.6A1 1 0 0 1 1.5 0.2h11a1 1 0 0 1 0.9 1.4L7 15.2z" className="fill-signal" />
    </svg>
  );
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  const gb = n / (1024 * 1024 * 1024);
  if (gb < 1024) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  return `${(gb / 1024).toFixed(1)} TB`;
}

/** Storage used by this wallet's library. Shares the library's own query, so it costs no extra request there. */
function StorageRow() {
  const wallet = useSessionWallet();
  const { data } = useQuery({
    queryKey: ["videos", wallet],
    queryFn: () => getVideos(wallet),
    enabled: !!wallet,
    staleTime: 8000,
  });
  if (!wallet || !data) return null;
  const bytes = data.reduce((sum, v) => sum + (v.meta?.sizeBytes ?? 0), 0);
  return (
    <div className="flex items-baseline justify-between gap-3 px-2.5">
      <span className="text-[13px] text-dim">Storage</span>
      <span className="tc text-paper-2">
        {data.length === 0 ? "Nothing stored yet" : `${formatBytes(bytes)} in ${data.length} video${data.length === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

/**
 * Whether the Shelby network answers right now. This asks the network
 * itself once a minute, so it goes red during an outage instead of
 * showing a dot that is always green.
 */
function ShelbyRow() {
  const { data, isLoading } = useQuery({
    queryKey: ["shelby-reachable"],
    queryFn: async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const r = await fetch(`${SHELBYNET_URLS.fullnode}/accounts/0x1`, { signal: ctl.signal, cache: "no-store" });
        return r.ok;
      } catch { return false; }
      finally { clearTimeout(timer); }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const state = isLoading ? "checking" : data ? "up" : "down";
  return (
    <div className="flex items-center justify-between gap-3 px-2.5">
      <span className="text-[13px] text-dim">Shelby</span>
      <span className="flex items-center gap-2">
        <span className={clsx("dot", state === "up" ? "dot-live" : state === "down" ? "dot-dead" : "dot-off")} />
        <span className={clsx("tc", state === "down" ? "text-error" : "text-paper-2")}>
          {state === "up" ? "Online" : state === "down" ? "Not responding" : "Checking"}
        </span>
      </span>
    </div>
  );
}

function NavList({ path }: { path: string }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 pb-4 scrollbar-hide">
      {NAV.map((group, gi) => {
        const items = group.items.filter((it) => SHOW_PLANNED || it.href);
        if (!items.length) return null;
        return (
          <div key={gi} className={gi === 0 ? "" : "mt-5"}>
            {group.label && (
              <p className="px-2.5 mb-1 text-[12px] font-medium text-dim">{group.label}</p>
            )}
            <ul>
              {items.map((it) => {
                const Icon = it.icon;
                const active = !!it.href && (it.match ? it.match(path) : path === it.href);
                const inner = (
                  <>
                    <span className="w-4 shrink-0 flex justify-center">
                      {Icon && <Icon size={15} strokeWidth={1.75} />}
                    </span>
                    <span className="truncate">{it.label}</span>
                    {!it.href && <span className="ml-auto text-[11px] text-dim-2">Soon</span>}
                  </>
                );
                return (
                  <li key={it.label}>
                    {it.href ? (
                      <Link
                        href={it.href}
                        aria-current={active ? "page" : undefined}
                        className={clsx(
                          "relative flex items-center gap-2.5 h-8 px-2.5 rounded text-[13.5px] transition-colors",
                          active ? "bg-slate-2 text-paper font-medium" : "text-paper-2 hover:bg-slate hover:text-paper"
                        )}
                      >
                        {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-signal" />}
                        {inner}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        className="flex items-center gap-2.5 h-8 px-2.5 text-[13.5px] text-dim-2 cursor-default select-none"
                      >
                        {inner}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="min-h-screen bg-void">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] btn btn-signal px-3 h-9 inline-flex items-center"
      >
        Skip to content
      </a>

      {/* Top bar, narrow screens only */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-[52px] bg-side border-b border-rule flex items-center gap-2 px-3">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="w-9 h-9 -ml-1 flex items-center justify-center rounded text-paper-2 hover:text-paper hover:bg-slate"
        >
          <Menu size={18} />
        </button>
        <Link href="/" className="flex items-center gap-2 mr-auto">
          <Mark />
          <span className="text-[15px] font-semibold tracking-tight text-paper">VideoMind</span>
        </Link>
        <WalletButton quiet />
      </header>

      {/* Dimmed backdrop behind the slide in menu */}
      <div
        onClick={() => setOpen(false)}
        className={clsx(
          "lg:hidden fixed inset-0 z-40 bg-screen/70 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      />

      <aside
        aria-label="Sidebar"
        className={clsx(
          "fixed inset-y-0 left-0 z-50 w-[272px] lg:w-[236px] bg-side border-r border-rule flex flex-col",
          "transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-[56px] shrink-0 flex items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="text-[15px] font-semibold tracking-tight text-paper">VideoMind</span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="lg:hidden w-9 h-9 -mr-2 flex items-center justify-center rounded text-paper-2 hover:text-paper hover:bg-slate"
          >
            <X size={18} />
          </button>
        </div>

        <NavList path={path} />

        <div className="shrink-0 border-t border-rule px-2.5 pt-3.5 pb-3 space-y-2.5">
          <StorageRow />
          <ShelbyRow />
          <div className="pt-1">
            <WalletButton block quiet placement="up" />
          </div>
        </div>
      </aside>

      <div className="lg:pl-[236px]">
        <main id="content" className="pt-[52px] lg:pt-0 min-h-screen">
          {children}
        </main>
      </div>

      <SignInNotice />
    </div>
  );
}
