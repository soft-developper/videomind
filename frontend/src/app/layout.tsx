import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
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

export const metadata: Metadata = {
  title: "VideoMind",
  description:
    "A library for long videos. Every lecture, seminar and talk becomes searchable, chaptered and transcribed. Stored on Shelby, owned by your wallet.",
  keywords: [
    "Shelby Protocol", "AI video", "video intelligence", "Aptos",
    "decentralized storage", "transcript", "video search",
  ],
  openGraph: {
    title: "VideoMind",
    description:
      "A library for long videos. Every lecture, seminar and talk becomes searchable, chaptered and transcribed.",
    type: "website",
    siteName: "VideoMind",
  },
  twitter: {
    card: "summary_large_image",
    title: "VideoMind",
    description: "A library for long videos. Searchable, chaptered and transcribed.",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.svg" }],
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#171A18",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={ui.variable}
    >
      <body className="bg-void text-paper antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
