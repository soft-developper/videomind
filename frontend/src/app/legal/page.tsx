// vm_legal: the list of VideoMind's legal documents.
import type { Metadata } from "next";
import Link from "next/link";
import { LegalBar, LegalFooter, LEGAL, LEGAL_DOCS } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Legal | VideoMind",
  description: "VideoMind's Privacy Policy and Terms of Service.",
};

export default function LegalIndex() {
  return (
    <div className="min-h-screen bg-void">
      <LegalBar />
      <main className="pt-14">
        <div className="section"><div className="max-w-[820px] mx-auto pt-10 pb-16">
          <h1 className="font-display text-[30px] sm:text-[38px] leading-tight text-paper">Legal information</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-paper-2">The documents that apply when you use VideoMind. Each takes effect on {LEGAL.effective}.</p>
          <div className="mt-8 grid sm:grid-cols-2 gap-4">
            {LEGAL_DOCS.map((d) => (
              <Link key={d.href} href={d.href} className="panel p-5 block hover:border-rule-lit">
                <span className="block text-[16px] text-paper">{d.title}</span>
                <span className="block text-[13.5px] text-dim mt-1">{d.blurb}</span>
              </Link>
            ))}
          </div>
          <section className="mt-10 space-y-3" aria-labelledby="requests">
            <h2 id="requests" className="font-display text-[20px] text-paper">Requests and questions</h2>
            <p className="text-[15px] leading-relaxed text-paper-2">
              To ask a privacy question, ask us to delete your information, or report content, write to{" "}
              <a href={`mailto:${LEGAL.contact}`} className="text-paper underline underline-offset-2">{LEGAL.contact}</a>.
              Deletion requests are completed within 7 days.
            </p>
          </section>
        </div></div>
      </main>
      <LegalFooter />
    </div>
  );
}
