"use client";
// vm_live: the public page of a live event. No wallet needed.
import Link from "next/link";
import { LiveWatch } from "@/components/live/LiveWatch";
import { LegalFooter } from "@/components/legal/LegalPage";

export default function WatchLivePage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-screen bg-void">
      <nav className="fixed top-0 inset-x-0 z-50 h-14 bg-side border-b border-rule">
        <div className="section h-full flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
              <path d="M7 15.2 0.6 1.6A1 1 0 0 1 1.5 0.2h11a1 1 0 0 1 0.9 1.4L7 15.2z" className="fill-signal" />
            </svg>
            <span className="text-[15px] font-semibold tracking-tight leading-none text-paper">VideoMind</span>
          </Link>
          <Link href="/" className="btn btn-ghost h-9 px-3.5 flex items-center">Open VideoMind</Link>
        </div>
      </nav>
      <main className="pt-14 pb-16 section max-w-[1100px] mx-auto"><LiveWatch id={params.id} /></main>
      <LegalFooter />
    </div>
  );
}
