"use client";
// vm_lang: choosing the interface language. A native select, so it works
// with a keyboard, a screen reader and on phones without extra code.
// Picking writes the one language cookie, saves the choice to the signed
// in wallet so it follows them to other devices, and redraws the page.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Languages } from "lucide-react";
import { clsx } from "clsx";
import {
  LOCALES, LOCALE_NAMES, LANGUAGES_ON, isLocale, writeLocaleCookie, readLocaleCookie, type Locale,
} from "@/i18n/config";
import { getMySettings, saveMySettings } from "@/lib/api";
import { useSessionWallet } from "./AuthProvider";

export function LanguagePicker({ variant = "field", id }: { variant?: "sidebar" | "field" | "bar"; id?: string }) {
  const t = useTranslations("language");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const qc = useQueryClient();
  const wallet = useSessionWallet();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const pick = async (next: string) => {
    if (!isLocale(next) || next === locale) return;
    setNote(null);
    writeLocaleCookie(next);
    if (wallet) {
      try {
        const r = await saveMySettings({ language: next });
        qc.setQueryData(["my-settings", wallet], (cur: any) => (cur ? { ...cur, settings: r.settings } : cur));
      } catch {
        // The cookie already holds the choice in this browser.
        setNote(t("notSaved"));
      }
    }
    start(() => router.refresh());
  };

  const select = (
    <select
      id={id}
      value={locale}
      disabled={pending}
      onChange={(e) => void pick(e.target.value)}
      aria-label={variant !== "field" ? t("label") : undefined}
      data-language-picker={variant}
      className={clsx(
        variant === "sidebar"
          ? "h-7 px-1 -me-1 text-[12.5px] bg-transparent border-0 text-paper-2 hover:text-paper cursor-pointer no-min"
          : variant === "bar"
            ? "h-9 ps-1 pe-1 text-[13px] bg-transparent border-0 text-paper-2 hover:text-paper cursor-pointer no-min"
            : "h-9 px-2.5 text-[13.5px] w-full max-w-[320px]"
      )}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l} lang={l} dir="auto">{LOCALE_NAMES[l]}</option>
      ))}
    </select>
  );

  if (variant === "bar") {
    // On public pages, in the top bar: the icon names it, the select shows the language.
    return (
      <span className="flex items-center gap-1 text-dim">
        <Languages size={14} aria-hidden />
        {select}
      </span>
    );
  }
  if (variant === "sidebar") {
    // A row like Storage and Shelby above it: label, then the value.
    return (
      <div className="flex items-center justify-between gap-3 ps-2.5 pe-1.5">
        <span className="flex items-center gap-1.5 text-[13px] text-dim">
          <Languages size={13} aria-hidden />
          {t("label")}
        </span>
        {select}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {select}
      {note && <p className="text-[13px] text-warn" role="status">{note}</p>}
    </div>
  );
}

/**
 * Keeps the browser and the signed in wallet on the same language. When a
 * wallet signs in with a saved language, the page switches to it. When it
 * has none saved but this browser has a picked one, that one is saved.
 */
export function LanguageSync() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const wallet = useSessionWallet();
  const done = useRef<string | null>(null);
  const me = useQuery({
    queryKey: ["my-settings", wallet ?? null],
    queryFn: getMySettings,
    enabled: LANGUAGES_ON && !!wallet,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!LANGUAGES_ON || !wallet || !me.data || done.current === wallet) return;
    done.current = wallet;
    const saved = me.data.settings.language;
    if (saved && saved !== locale) {
      writeLocaleCookie(saved);
      router.refresh();
    } else if (!saved) {
      const picked = readLocaleCookie();
      if (picked) void saveMySettings({ language: picked }).catch(() => {});
    }
  }, [wallet, me.data, locale, router]);

  return null;
}
