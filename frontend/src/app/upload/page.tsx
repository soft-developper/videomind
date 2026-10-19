import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Suspense } from "react";
import { UploadZone } from "@/components/upload/UploadZone";
// vm_lang
import { getTranslations } from "next-intl/server";

const STEPS = ["uploaded", "transcribed", "chaptered", "stored"] as const;

export default async function UploadPage() {
  const t = await getTranslations("uploadPage");
  return (
    <AppShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <div className="section pb-16">
        <div className="grid lg:grid-cols-[minmax(0,640px)_300px] gap-x-14 gap-y-10 items-start">
            {/* vm_upload: the component reads the page address, which needs a Suspense boundary */}
            <Suspense fallback={<div className="h-48 scan rounded-lg" />}>
              <UploadZone />
            </Suspense>

            <aside>
              <h2 className="font-display text-[14px] text-paper mb-1">{t("next")}</h2>
              {/* This is a sequence, so it is numbered. */}
              <ol>
                {STEPS.map((k, i) => (
                  <li key={k} className="flex gap-3.5 py-3.5 border-b border-rule">
                    <span className="tc w-4 shrink-0 pt-px">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-paper leading-snug">{t(`steps.${k}.n`)}</p>
                      <p className="text-[13px] text-dim mt-0.5 leading-relaxed">{t(`steps.${k}.d`)}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-[13px] text-dim mt-4 leading-relaxed">
                {t("prepaid")}
              </p>
            </aside>
        </div>
      </div>
    </AppShell>
  );
}
