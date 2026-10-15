import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

// vm_admin: the same typeface and colours as the main site.
const ui = Instrument_Sans({ subsets: ["latin"], variable: "--font-ui", axes: ["wdth"], display: "swap" });

export const metadata: Metadata = {
  title: "VideoMind Admin",
  description: "The VideoMind admin dashboard.",
  robots: { index: false, follow: false },
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
};
export const viewport: Viewport = { themeColor: "#171A18" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={ui.variable}>
      <body className="bg-void text-paper antialiased">{children}</body>
    </html>
  );
}
