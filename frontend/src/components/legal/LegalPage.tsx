// vm_legal: the frame of every legal page, laid out like Atlassian's legal
// pages: a "Legal" path above the title, the date it takes effect, an
// introduction, the list of sections, then the sections and related pages.
import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL = {
  effective: "9 October 2026",
  contact: "privacy@vidzmind.xyz",
  site: "https://vidzmind.xyz",
};

export const LEGAL_DOCS = [
  { href: "/legal/privacy", title: "Privacy Policy", blurb: "What VideoMind collects, why, who helps us run it, and the choices you have." },
  { href: "/legal/terms", title: "Terms of Service", blurb: "The rules for using VideoMind, what you own, and what we promise and do not." },
];

export function LegalBar() {
  return (
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
  );
}

/** The small footer on public pages. */
export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`border-t border-rule ${className}`}>
      <div className="section max-w-[1400px] mx-auto py-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-dim">
        <span>© 2026 VideoMind</span>
        <Link href="/legal/privacy" className="hover:text-paper">Privacy Policy</Link>
        <Link href="/legal/terms" className="hover:text-paper">Terms of Service</Link>
        <Link href="/legal" className="hover:text-paper">Legal</Link>
      </div>
    </footer>
  );
}

export function LegalPage({ title, crumb, intro, sections, children }: {
  title: string;
  crumb: string;
  intro: ReactNode;
  sections: Array<{ id: string; title: string }>;
  children: ReactNode;
}) {
  const others = LEGAL_DOCS.filter((d) => d.title !== title);
  return (
    <div className="min-h-screen bg-void">
      <LegalBar />
      <main className="pt-14">
        <div className="section"><article className="max-w-[820px] mx-auto pt-10 pb-16 [overflow-wrap:anywhere]">
          <nav aria-label="Breadcrumb" className="text-[13px] text-dim mb-3">
            <Link href="/legal" className="hover:text-paper underline underline-offset-2">Legal</Link>
            <span className="mx-2" aria-hidden>/</span>
            <span className="text-paper-2">{crumb}</span>
          </nav>
          <h1 className="font-display text-[30px] sm:text-[38px] leading-tight text-paper">{title}</h1>
          <p className="mt-2 text-[14px] italic text-paper-2">Effective starting {LEGAL.effective}</p>

          <div className="mt-8 space-y-4">{intro}</div>

          <nav aria-label="On this page" className="mt-8 panel px-5 py-4">
            <p className="text-[13px] font-medium text-paper mb-2">On this page</p>
            <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[14px]">
              {sections.map((s, i) => (
                <li key={s.id}><a href={`#${s.id}`} className="text-paper-2 hover:text-paper underline underline-offset-2">{i + 1}. {s.title}</a></li>
              ))}
            </ol>
          </nav>

          <div className="mt-10 space-y-12">{children}</div>

          {others.length > 0 && (
            <section aria-labelledby="related" className="mt-16">
              <h2 id="related" className="font-display text-[20px] text-paper mb-4">Related content</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {others.map((d) => (
                  <Link key={d.href} href={d.href} className="panel p-5 block hover:border-rule-lit">
                    <span className="block text-[15px] text-paper">{d.title}</span>
                    <span className="block text-[13.5px] text-dim mt-1">{d.blurb}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article></div>
      </main>
      <LegalFooter />
    </div>
  );
}

/** One numbered section with an anchor. */
export function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-4">
      <h2 id={`${id}-h`} className="font-display text-[22px] text-paper">{n}. {title}</h2>
      {children}
    </section>
  );
}

export const P = ({ children }: { children: ReactNode }) => <p className="text-[15px] leading-relaxed text-paper-2">{children}</p>;
export const H3 = ({ children }: { children: ReactNode }) => <h3 className="text-[16px] font-semibold text-paper pt-2">{children}</h3>;
export const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc pl-6 space-y-2 text-[15px] leading-relaxed text-paper-2 marker:text-dim">{children}</ul>;
export const A = ({ href, children }: { href: string; children: ReactNode }) => {
  const outside = /^https?:|^mailto:/.test(href);
  return outside
    ? <a href={href} className="text-paper underline underline-offset-2" {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>
    : <Link href={href} className="text-paper underline underline-offset-2">{children}</Link>;
};
export const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-paper">{children}</strong>;
