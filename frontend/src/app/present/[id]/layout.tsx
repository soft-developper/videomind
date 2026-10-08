// vm_present: Presentation Mode is for a room, not for search engines or link previews.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Presenting | VideoMind",
  robots: { index: false, follow: false },
};

export default function PresentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
