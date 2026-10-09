// vm_live: your live events.
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiveList } from "@/components/live/LiveList";

export default function LivePage() {
  return (
    <AppShell>
      <PageHeader
        title="Go live"
        description="Stream your camera or screen to a page anyone can watch, and to YouTube Live or Twitch if you like. The recording goes into your library afterwards."
      />
      <div className="section pb-16"><LiveList /></div>
    </AppShell>
  );
}
