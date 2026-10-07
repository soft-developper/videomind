import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { SearchInterface } from "@/components/search/SearchInterface";

export default function SearchPage() {
  return (
    <AppShell>
      <PageHeader
        title="Search"
        description="Describe what you remember. Each result opens the video at the moment it was said."
      />
      <div className="section pb-16">
        <div className="max-w-[860px]">
          <SearchInterface />
        </div>
      </div>
    </AppShell>
  );
}
