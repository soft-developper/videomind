// vm_generate: make a video from a description (Part 17b2).
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { GenerateForm } from "@/components/generate/GenerateForm";
import { getTranslations } from "next-intl/server";

const TIPS = ["subject", "action", "camera", "light", "sound"] as const;

export default async function GeneratePage() {
  const t = await getTranslations("generatePage");
  return (
    <AppShell>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="section pb-16">
        <div className="grid lg:grid-cols-[minmax(0,640px)_300px] gap-x-14 gap-y-10 items-start">
          <GenerateForm />
          <aside>
            <h2 className="font-display text-[14px] text-paper mb-1">{t("tipsTitle")}</h2>
            <ul>
              {TIPS.map((k) => (
                <li key={k} className="py-3 border-b border-rule">
                  <p className="text-[14px] font-medium text-paper leading-snug">{t(`tips.${k}.n`)}</p>
                  <p className="text-[13px] text-dim mt-0.5 leading-relaxed">{t(`tips.${k}.d`)}</p>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-dim mt-4 leading-relaxed">{t("example")}</p>
            <p className="text-[13px] text-dim mt-4 leading-relaxed">{t("after")}</p>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
