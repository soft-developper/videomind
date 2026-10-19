import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Noto_Sans_Arabic } from "next/font/google";
// vm_lang
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { dirOf, type Locale } from "@/i18n/config";
import "./globals.css";
import { AppProviders } from "@/components/layout/AppProviders";

// vm_shell: one typeface for the whole interface. The width axis lets
// timecodes and other data be set narrower (see .tc in globals.css)
// without a second family.
const ui = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
  axes: ["wdth"],
  display: "swap",
});

// vm_lang: Arabic letters, with the same weight and width axes as the UI
// face. Only Arabic glyphs are in it (unicode range), so the browser only
// downloads it when Arabic text is on screen. No metric fallback: that
// fallback would also catch Latin letters before Instrument Sans.
const arabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  axes: ["wdth"],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

// vm_lang: the site's description in the reader's language.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: "VideoMind",
    description: t("description"),
    keywords: [
      "Shelby Protocol", "AI video", "video intelligence", "Aptos",
      "decentralized storage", "transcript", "video search",
    ],
    openGraph: {
      title: "VideoMind",
      description: t("ogDescription"),
      type: "website",
      siteName: "VideoMind",
    },
    twitter: {
      card: "summary_large_image",
      title: "VideoMind",
      description: t("twitterDescription"),
    },
    icons: {
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: "/apple-icon.svg" }],
    },
    manifest: "/manifest.json",
  };
}

export const viewport: Viewport = {
  themeColor: "#171A18",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = (await getLocale()) as Locale;
  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={`${ui.variable} ${arabic.variable}`}
    >
      <body className="bg-void text-paper antialiased">
        <NextIntlClientProvider>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
