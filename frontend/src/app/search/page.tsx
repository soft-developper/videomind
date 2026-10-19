import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { SearchInterface } from "@/components/search/SearchInterface";
// vm_lang
import { getTranslations } from "next-intl/server";

export default async function SearchPage() {
  const t = await getTranslations("search");
  return (
    <AppShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <div className="section pb-16">
        <div className="max-w-[860px]">
          <SearchInterface />
        </div>
      </div>
    </AppShell>
  );
}
