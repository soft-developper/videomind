"use client";
import { use } from "react";
// vm_live: the public page of a live event. No wallet needed.
import { LiveWatch } from "@/components/live/LiveWatch";
import { LegalFooter, PublicBar } from "@/components/legal/LegalPage";

export default function WatchLivePage(props: { params: Promise<{ id: string }> }) {
  // vm_next15: params arrive as a promise in Next 15
  const params = use(props.params);
  return (
    <div className="min-h-screen bg-void">
      <PublicBar />
      <main className="pt-14 pb-16 section max-w-[1100px] mx-auto"><LiveWatch id={params.id} /></main>
      <LegalFooter />
    </div>
  );
}
