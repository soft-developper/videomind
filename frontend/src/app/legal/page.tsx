// vm_legal: the list of VideoMind's legal documents.
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { PublicBar, LegalFooter, GovernsNotice, LEGAL_DOCS, rich, useEffective } from "@/components/legal/LegalPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: `${t("legal")} | VideoMind`, description: t("indexDescription") };
}

export default function LegalIndex() {
  const t = useTranslations("legal");
  const effective = useEffective();
  return (
    <div className="min-h-screen bg-void">
      <PublicBar />
      <main className="pt-14">
        <div className="section"><div className="max-w-[820px] mx-auto pt-10 pb-16">
          <h1 className="font-display text-[30px] sm:text-[38px] leading-tight text-paper">{t("indexTitle")}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-paper-2">{t("indexIntro")}</p>
          <GovernsNotice />
          <div className="mt-8 grid sm:grid-cols-2 gap-4">
            {LEGAL_DOCS.map((d) => (
              <Link key={d.href} href={d.href} className="panel p-5 block hover:border-rule-lit">
                <span className="block text-[16px] text-paper">{t(`doc.${d.doc}.title`)}</span>
                <span className="block text-[13.5px] text-dim mt-1">{t(`doc.${d.doc}.blurb`)}</span>
                <span className="block text-[12.5px] text-dim mt-2">{t("effective", { date: effective(d.doc) })}</span>
              </Link>
            ))}
          </div>
          <section className="mt-10 space-y-3" aria-labelledby="requests">
            <h2 id="requests" className="font-display text-[20px] text-paper">{t("requests")}</h2>
            <p className="text-[15px] leading-relaxed text-paper-2">{t.rich("requestsBody", rich())}</p>
          </section>
        </div></div>
      </main>
      <LegalFooter />
    </div>
  );
}
