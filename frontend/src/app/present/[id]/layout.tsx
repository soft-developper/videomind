// vm_present: Presentation Mode is for a room, not for search engines or link previews.
import type { Metadata } from "next";
// vm_lang
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: `${t("presenting")} | VideoMind`, robots: { index: false, follow: false } };
}

export default function PresentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
