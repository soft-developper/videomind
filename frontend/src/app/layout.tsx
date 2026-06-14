import type { Metadata } from "next";
import { Syne, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/layout/AppProviders";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  weight: ["400", "500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["300", "400", "500"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "VideoMind — AI Video Intelligence on Shelby Protocol",
  description:
    "Turn every video into an AI-searchable knowledge base. Transcription, chapters, highlights, and semantic search — all stored on Shelby Protocol.",
  keywords: [
    "Shelby Protocol", "AI video", "video intelligence", "Aptos", "decentralized storage",
    "Whisper", "Claude AI", "video search", "transcript", "knowledge base",
  ],
  authors: [{ name: "VideoMind" }],
  openGraph: {
    title: "VideoMind — AI Video Intelligence on Shelby Protocol",
    description:
      "Upload any video. AI generates transcript, chapters, highlights & answers. Everything stored on Shelby Protocol.",
    type: "website",
    locale: "en_US",
    siteName: "VideoMind",
  },
  twitter: {
    card: "summary_large_image",
    title: "VideoMind — AI Video Intelligence on Shelby Protocol",
    description:
      "Upload any video. AI generates transcript, chapters, highlights & answers. Everything stored on Shelby Protocol.",
  },
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body className="bg-dark-950 text-white font-dm antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
