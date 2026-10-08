// vm_record: record the screen or the camera in the browser, then upload it.
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { RecordStudio } from "@/components/record/RecordStudio";

export default function RecordPage() {
  return (
    <AppShell>
      <PageHeader
        title="Record"
        description="Record your screen or your camera with your voice. When you stop, it goes into your library like an upload: transcribed and split into chapters."
      />
      <div className="section pb-16">
        <RecordStudio />
      </div>
    </AppShell>
  );
}
