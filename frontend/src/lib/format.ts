"use client";
// vm_lang: numbers, sizes, lengths and times in the reader's language.
// Built on Intl, so units and word order come from the browser's own data
// ("12 MB", "12 Mo", "hace 5 minutos"). Timecodes (clock() in VideoCard)
// stay the same in every language.
import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale, type Locale } from "@/i18n/config";

export function bytesIn(locale: Locale, n: number): string {
  const unit = (value: number, u: string, digits: number) =>
    new Intl.NumberFormat(intlLocale(locale), { style: "unit", unit: u, unitDisplay: "short", maximumFractionDigits: digits }).format(value);
  if (n < 1024 * 1024) return unit(Math.max(1, Math.round(n / 1024)), "kilobyte", 0);
  if (n < 1024 * 1024 * 1024) { const mb = n / (1024 * 1024); return unit(mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb), "megabyte", 1); }
  const gb = n / (1024 * 1024 * 1024);
  if (gb < 1024) return unit(gb < 10 ? Math.round(gb * 100) / 100 : Math.round(gb), "gigabyte", 2);
  return unit(Math.round((gb / 1024) * 10) / 10, "terabyte", 1);
}

/** Whole minutes and hours, short: "58 min", "1 h 5 min". Null under a minute. */
export function lengthIn(locale: Locale, seconds: number): string | null {
  const min = Math.round(seconds / 60);
  if (!isFinite(min) || min < 1) return null;
  const nf = (v: number, u: "hour" | "minute") =>
    new Intl.NumberFormat(intlLocale(locale), { style: "unit", unit: u, unitDisplay: "short" }).format(v);
  if (min < 60) return nf(min, "minute");
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${nf(h, "hour")} ${nf(m, "minute")}` : nf(h, "hour");
}

export function useFormat() {
  const locale = useLocale() as Locale;
  const t = useTranslations("common");
  return useMemo(() => {
    const il = intlLocale(locale);
    const rtf = new Intl.RelativeTimeFormat(il, { numeric: "always", style: "long" });
    return {
      locale,
      number: (n: number) => new Intl.NumberFormat(il).format(n),
      bytes: (n: number) => bytesIn(locale, n),
      /** A video's length, or "Under a minute". Null when unknown. */
      length: (seconds?: number | null) => {
        if (!seconds || !isFinite(seconds)) return null;
        return lengthIn(locale, seconds) ?? t("underMinute");
      },
      /** Time left, for "x left" phrases: "under a minute" when below one. */
      left: (seconds: number) => lengthIn(locale, seconds) ?? t("underMinuteLower"),
      /** How long ago, up to a week; then the date. */
      ago: (ms: number) => {
        const min = Math.floor((Date.now() - ms) / 60000);
        if (min < 1) return t("justNow");
        if (min < 60) return rtf.format(-min, "minute");
        const h = Math.floor(min / 60);
        if (h < 24) return rtf.format(-h, "hour");
        const days = Math.floor(h / 24);
        if (days < 7) return rtf.format(-days, "day");
        return new Intl.DateTimeFormat(il, { month: "short", day: "numeric" }).format(new Date(ms));
      },
      date: (ms: number, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) => new Intl.DateTimeFormat(il, opts).format(new Date(ms)),
    };
  }, [locale, t]);
}

// vm_credits: dollars in the reader's language, never rounded: $3.925 stays
// $3.925 and a price of $0.006 keeps its digits. Whole cents show two digits.
export function useMoney() {
  const locale = useLocale() as Locale;
  // Arabic formats carry direction marks; the amounts sit in left to right
  // boxes, so the marks are taken out (they would move the minus sign).
  return (micros: number, sign = false) => {
    const x = micros / 1_000_000;
    const s = new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(x).replace(/[\u200e\u200f\u061c]/g, "");
    return sign && x > 0 ? `+${s}` : s;
  };
}

/** An amount inside a sentence, kept left to right in every language (Unicode isolate). */
export const inline = (s: string) => `\u2066${s}\u2069`;

