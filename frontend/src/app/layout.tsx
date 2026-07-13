import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter_Tight, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/layout/AppProviders";

// Display — editorial serif. Video is media; media has an editorial voice.
const instrument = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument",
  weight: ["400"],
  style: ["normal", "italic"],
});

// Body — narrow, dense, gets out of the way.
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  weight: ["400", "500", "600"],
});

// Data — timecodes, durations, blob names.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "VideoMind — see the shape of any video",
  description:
    "Upload a video. AI reads it, maps it, and answers questions about it. Stored on Shelby Protocol, owned by your wallet.",
  keywords: [
    "Shelby Protocol", "AI video", "video intelligence", "Aptos",
    "decentralized storage", "transcript", "video search",
  ],
  openGraph: {
    title: "VideoMind — see the shape of any video",
    description:
      "AI reads your video, maps its structure, and answers questions about it. Stored on Shelby Protocol.",
    type: "website",
    siteName: "VideoMind",
  },
  twitter: {
    card: "summary_large_image",
    title: "VideoMind — see the shape of any video",
    description: "AI reads your video, maps its structure, and answers questions about it.",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.svg" }],
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0A0A0C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${instrument.variable} ${interTight.variable} ${mono.variable}`}
    >
      <body className="bg-void text-paper antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
