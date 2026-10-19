// vm_lang: the page for an address that leads nowhere, in the reader's language.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PublicBar, LegalFooter } from "@/components/legal/LegalPage";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="min-h-screen bg-void flex flex-col">
      <PublicBar />
      <main className="flex-1 pt-14 flex items-center justify-center px-4">
        <div className="text-center space-y-3 max-w-sm py-16">
          <h1 className="font-display text-[22px] text-paper">{t("title")}</h1>
          <p className="text-[14px] text-dim leading-relaxed">{t("body")}</p>
          <Link href="/" className="btn btn-ghost h-9 px-3.5 inline-flex items-center mt-2">{t("home")}</Link>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
