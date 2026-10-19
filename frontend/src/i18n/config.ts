// vm_lang: the languages VideoMind's interface speaks. English is the
// default and the fallback for any message a language does not have yet.
// Plan: claude/language-plan.md (Part 15).

export const LOCALES = ["en", "es", "fr", "ar", "pt"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language named in itself, as the picker shows it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  ar: "العربية",
  pt: "Português",
};

/** The one cookie the site sets. It only remembers the language picked. */
export const LOCALE_COOKIE = "vm_lang";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Languages are switched on with NEXT_PUBLIC_LANGUAGES=on. While it is off
 * (production, until every page is translated) the site is English for
 * everyone, reads no cookie and shows no picker.
 */
export const LANGUAGES_ON = process.env.NEXT_PUBLIC_LANGUAGES === "on";

export const isLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const dirOf = (l: Locale): "rtl" | "ltr" => (l === "ar" ? "rtl" : "ltr");

/**
 * The locale given to Intl for numbers and dates. Arabic keeps Western
 * digits, so timecodes, sizes and addresses read the same everywhere.
 */
export const intlLocale = (l: Locale): string => (l === "ar" ? "ar-u-nu-latn" : l);

/**
 * The best supported language for an Accept-Language header, by its
 * quality values, matching on the main language (pt-BR is pt, es-419 is es).
 * Nothing supported means English.
 */
export function negotiate(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const wanted = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(quality) ? quality : 0, i };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const w of wanted) if (isLocale(w.lang)) return w.lang;
  return DEFAULT_LOCALE;
}

/** Writes the language cookie in the browser, only when someone picks a language. */
export function writeLocaleCookie(l: Locale) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${l}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  return m && isLocale(m[1]) ? m[1] : null;
}
