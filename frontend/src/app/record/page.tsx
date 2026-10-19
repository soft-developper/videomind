// vm_record: record the screen or the camera in the browser, then upload it.
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { RecordStudio } from "@/components/record/RecordStudio";
// vm_lang
import { getTranslations } from "next-intl/server";

export default async function RecordPage() {
  const t = await getTranslations("record");
  return (
    <AppShell>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="section pb-16">
        <RecordStudio />
      </div>
    </AppShell>
  );
}
