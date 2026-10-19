"use client";
// vm_shell: the frame every workspace page sits in. A sidebar on wide
// screens, a top bar with a slide in menu on narrow ones.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "next-intl";
import { clsx } from "clsx";
import {
  Home, Film, Upload, Disc, Radio, Search, BookOpen, MessageSquare,
  BarChart3, User, Settings, Menu, X, type LucideIcon,
  // vm_profile
  Wallet,
} from "lucide-react";
import { getVideos } from "@/lib/api";
import { SHELBYNET_URLS } from "@/lib/network";
import { WalletButton } from "./WalletButton";
import { SignInNotice } from "./SignInNotice";
import { useSessionWallet } from "./AuthProvider";
// vm_lang
import { LanguagePicker } from "./LanguagePicker";
import { LANGUAGES_ON, intlLocale, type Locale } from "@/i18n/config";

/**
 * The preview shows the whole planned structure. Items that are not
 * built yet are listed, greyed out and marked "Soon", so the shape of
 * the product can be judged now. Set this to false to list only what works.
 */
const SHOW_PLANNED = true;

// vm_lang: labels are message keys under "nav".
type NavKey = Parameters<ReturnType<typeof useTranslations<"nav">>>[0];
interface Item { label: NavKey; href?: string; icon?: LucideIcon; match?: (path: string) => boolean }
interface Group { label?: NavKey; items: Item[] }

const NAV: Group[] = [
  { items: [{ label: "home", href: "/", icon: Home }] },
  {
    label: "library",
    items: [
      { label: "allVideos", href: "/library", icon: Film, match: (p) => p === "/library" || p.startsWith("/video/") },
      // vm_info: Courses lists collections. The rest list videos by category (see src/lib/categories.ts).
      { label: "courses", href: "/library/courses", match: (p) => p.startsWith("/library/courses") },
      { label: "lectures", href: "/library/lectures" }, { label: "seminars", href: "/library/seminars" },
      { label: "presentations", href: "/library/presentations" }, { label: "events", href: "/library/events" },
      { label: "liveRecordings", href: "/library/live" },
    ],
  },
  {
    label: "create",
    items: [
      { label: "upload", href: "/upload", icon: Upload },
      { label: "record", href: "/record", icon: Disc },   // vm_record
      { label: "goLive", href: "/live", icon: Radio, match: (p) => p === "/live" || p.endsWith("/studio") },   // vm_live
    ],
  },
  {
    label: "discover",
    items: [
      { label: "search", href: "/search", icon: Search },
      { label: "knowledge", href: "/learn", icon: BookOpen },
      { label: "askLibrary", href: "/assistant", icon: MessageSquare },
    ],
  },
  {
    label: "workspace",
    items: [
      { label: "analytics", href: "/analytics", icon: BarChart3 },   // vm_analytics
      // vm_profile
      { label: "wallet", href: "/wallet", icon: Wallet },
      { label: "profile", href: "/profile", icon: User, match: (p) => p === "/profile" || p.startsWith("/u/") },
      { label: "settings", href: "/settings", icon: Settings },   // vm_settings
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

// vm_lang: sizes in the reader's language (Intl units: "12 MB", "12 Mo").
function formatBytes(n: number, locale: Locale): string {
  const unit = (value: number, u: string, digits: number) =>
    new Intl.NumberFormat(intlLocale(locale), { style: "unit", unit: u, unitDisplay: "short", maximumFractionDigits: digits }).format(value);
  if (n < 1024 * 1024) return unit(Math.max(1, Math.round(n / 1024)), "kilobyte", 0);
  if (n < 1024 * 1024 * 1024) return unit(Math.round(n / (1024 * 1024)), "megabyte", 0);
  const gb = n / (1024 * 1024 * 1024);
  if (gb < 1024) return unit(gb < 10 ? Math.round(gb * 10) / 10 : Math.round(gb), "gigabyte", 1);
  return unit(Math.round((gb / 1024) * 10) / 10, "terabyte", 1);
}

/** Storage used by this wallet's library. Shares the library's own query, so it costs no extra request there. */
function StorageRow() {
  const t = useTranslations("shell");
  const locale = useLocale() as Locale;
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
      <span className="text-[13px] text-dim">{t("storage")}</span>
      <span className="tc text-paper-2">
        {data.length === 0 ? t("nothingStored") : t("storageUsed", { size: formatBytes(bytes, locale), count: data.length })}
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
  const t = useTranslations("shell");
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
          {state === "up" ? t("online") : state === "down" ? t("notResponding") : t("checking")}
        </span>
      </span>
    </div>
  );
}

function NavList({ path }: { path: string }) {
  const t = useTranslations("nav");
  return (
    <nav aria-label={t("main")} className="flex-1 overflow-y-auto px-2.5 pb-4 scrollbar-hide">
      {NAV.map((group, gi) => {
        const items = group.items.filter((it) => SHOW_PLANNED || it.href);
        if (!items.length) return null;
        return (
          <div key={gi} className={gi === 0 ? "" : "mt-5"}>
            {group.label && (
              <p className="px-2.5 mb-1 text-[12px] font-medium text-dim">{t(group.label)}</p>
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
                    <span className="truncate">{t(it.label)}</span>
                    {!it.href && <span className="ms-auto text-[11px] text-dim-2">{t("soon")}</span>}
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
                        {active && <span className="absolute start-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-signal" />}
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
  const t = useTranslations("shell");
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
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[70] btn btn-signal px-3 h-9 inline-flex items-center"
      >
        {t("skip")}
      </a>

      {/* Top bar, narrow screens only */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-[52px] bg-side border-b border-rule flex items-center gap-2 px-3">
        <button
          onClick={() => setOpen(true)}
          aria-label={t("openMenu")}
          aria-expanded={open}
          className="w-9 h-9 -ms-1 flex items-center justify-center rounded text-paper-2 hover:text-paper hover:bg-slate"
        >
          <Menu size={18} />
        </button>
        <Link href="/" className="flex items-center gap-2 me-auto">
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
        aria-label={t("sidebar")}
        className={clsx(
          "fixed inset-y-0 start-0 z-50 w-[272px] lg:w-[236px] bg-side border-e border-rule flex flex-col",
          "transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full lg:rtl:translate-x-0"
        )}
      >
        <div className="h-[56px] shrink-0 flex items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="text-[15px] font-semibold tracking-tight text-paper">VideoMind</span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            aria-label={t("closeMenu")}
            className="lg:hidden w-9 h-9 -me-2 flex items-center justify-center rounded text-paper-2 hover:text-paper hover:bg-slate"
          >
            <X size={18} />
          </button>
        </div>

        <NavList path={path} />

        <div className="shrink-0 border-t border-rule px-2.5 pt-3.5 pb-3 space-y-2.5">
          <StorageRow />
          <ShelbyRow />
          {/* vm_lang */}
          {LANGUAGES_ON && <LanguagePicker variant="sidebar" />}
          <div className="pt-1">
            <WalletButton block quiet placement="up" />
          </div>
          {/* vm_legal */}
          <div className="flex gap-4 px-1 text-[12px] text-dim">
            <Link href="/legal/privacy" className="hover:text-paper">{t("privacy")}</Link>
            <Link href="/legal/terms" className="hover:text-paper">{t("terms")}</Link>
          </div>
        </div>
      </aside>

      <div className="lg:ps-[236px]">
        <main id="content" className="pt-[52px] lg:pt-0 min-h-screen">
          {children}
        </main>
      </div>

      <SignInNotice />
    </div>
  );
}
