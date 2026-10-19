// vm_live: your live events.
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiveList } from "@/components/live/LiveList";
// vm_lang
import { getTranslations } from "next-intl/server";

export default async function LivePage() {
  const t = await getTranslations("live");
  return (
    <AppShell>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="section pb-16"><LiveList /></div>
    </AppShell>
  );
}
