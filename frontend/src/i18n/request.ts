// vm_lang: which language a request is answered in, and its messages.
// next-intl without locale routing: addresses stay the same in every
// language. Order: the language cookie (set only when someone picks a
// language), then the browser's Accept-Language, then English.
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LANGUAGES_ON, LOCALE_COOKIE, isLocale, negotiate, type Locale } from "./config";
import en from "../messages/en.json";

type Tree = { [k: string]: string | Tree };

/** A language's messages over English's, so a message not translated yet shows in English. */
function over(base: Tree, top: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(top)) {
    const b = base[k];
    out[k] = typeof v === "object" && typeof b === "object" ? over(b, v) : v;
  }
  return out;
}

const load: Record<Exclude<Locale, "en">, () => Promise<Tree>> = {
  es: () => import("../messages/es.json").then((m) => m.default as Tree),
  fr: () => import("../messages/fr.json").then((m) => m.default as Tree),
  ar: () => import("../messages/ar.json").then((m) => m.default as Tree),
  pt: () => import("../messages/pt.json").then((m) => m.default as Tree),
};

export async function requestLocale(): Promise<Locale> {
  // Off: English for everyone, and no request is read, so pages stay static.
  if (!LANGUAGES_ON) return DEFAULT_LOCALE;
  const picked = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(picked)) return picked;
  return negotiate((await headers()).get("accept-language"));
}

export default getRequestConfig(async () => {
  const locale = await requestLocale();
  const messages = locale === "en" ? (en as Tree) : over(en as Tree, await load[locale]());
  return { locale, messages };
});
