// vm_legal: the frame of every legal page, laid out like Atlassian's legal
// pages: a "Legal" path above the title, the date it takes effect, an
// introduction, the list of sections, then the sections and related pages.
//
// vm_lang: the documents are written in English, and that version governs.
// In another language the page says so at the top and offers the English.
// Every paragraph is a message with tags for links and bold text (see rich).
import Link from "next/link";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LanguagePicker } from "@/components/layout/LanguagePicker";
import { LANGUAGES_ON, intlLocale, type Locale } from "@/i18n/config";
import { EnglishVersion } from "./EnglishVersion";

export const LEGAL = {
  contact: "privacy@vidzmind.xyz",
  site: "https://vidzmind.xyz",
};

/** When each document takes effect (UTC dates). */
export const EFFECTIVE = { privacy: "2026-10-22", terms: "2026-10-22" } as const;
export type LegalDoc = keyof typeof EFFECTIVE;
export const LEGAL_DOCS: Array<{ href: string; doc: LegalDoc }> = [
  { href: "/legal/privacy", doc: "privacy" },
  { href: "/legal/terms", doc: "terms" },
];

/** "19 October 2026", in the reader's language. */
export function useEffective() {
  const il = intlLocale(useLocale() as Locale);
  return (doc: LegalDoc) =>
    new Intl.DateTimeFormat(il, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${EFFECTIVE[doc]}T00:00:00Z`));
}

/** The tags a legal message may use, all in one place. */
export function rich(mail = `mailto:${LEGAL.contact}`) {
  return {
    b: (c: ReactNode) => <B>{c}</B>,
    code: (c: ReactNode) => <code className="tc">{c}</code>,
    site: (c: ReactNode) => <A href={LEGAL.site}>{c}</A>,
    mail: (c: ReactNode) => <A href={mail}>{c}</A>,
    terms: (c: ReactNode) => <A href="/legal/terms">{c}</A>,
    privacy: (c: ReactNode) => <A href="/legal/privacy">{c}</A>,
    settings: (c: ReactNode) => <A href="/settings">{c}</A>,
    google: (c: ReactNode) => <A href="#google">{c}</A>,
    use: (c: ReactNode) => <A href="#use">{c}</A>,
    credits: (c: ReactNode) => <A href="#credits">{c}</A>,
    gapi: (c: ReactNode) => <A href="https://developers.google.com/terms/api-services-user-data-policy">{c}</A>,
    ytterms: (c: ReactNode) => <A href="https://www.youtube.com/t/terms">{c}</A>,
    gprivacy: (c: ReactNode) => <A href="http://www.google.com/policies/privacy">{c}</A>,
    gperms: (c: ReactNode) => <A href="https://security.google.com/settings/security/permissions">{c}</A>,
  };
}

/** The top bar of every public page: the name, the language, and a way in. */
export function PublicBar() {
  const t = useTranslations("public");
  return (
    <nav className="fixed top-0 inset-x-0 z-50 h-14 bg-side border-b border-rule">
      <div className="section h-full flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5">
          <svg width="13" height="15" viewBox="0 0 14 16" fill="none" aria-hidden>
            <path d="M7 15.2 0.6 1.6A1 1 0 0 1 1.5 0.2h11a1 1 0 0 1 0.9 1.4L7 15.2z" className="fill-signal" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight leading-none text-paper">VideoMind</span>
        </Link>
        <div className="flex items-center gap-2">
          {LANGUAGES_ON && <LanguagePicker variant="bar" />}
          <Link href="/" className="btn btn-ghost h-9 px-3.5 flex items-center">{t("open")}</Link>
        </div>
      </div>
    </nav>
  );
}
/** The same bar, by the name the legal pages first gave it. */
export const LegalBar = PublicBar;

/** The small footer on public pages. */
export function LegalFooter({ className = "" }: { className?: string }) {
  const t = useTranslations("legal");
  return (
    <footer className={`border-t border-rule ${className}`}>
      <div className="section max-w-[1400px] mx-auto py-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-dim">
        <span>© 2026 VideoMind</span>
        <Link href="/legal/privacy" className="hover:text-paper">{t("doc.privacy.title")}</Link>
        <Link href="/legal/terms" className="hover:text-paper">{t("doc.terms.title")}</Link>
        <Link href="/legal" className="hover:text-paper">{t("legal")}</Link>
      </div>
    </footer>
  );
}

/** Says the English version governs, on every legal page shown in another language. */
export function GovernsNotice() {
  const t = useTranslations("legal");
  const locale = useLocale();
  if (locale === "en") return null;
  return (
    <aside className="mt-6 panel px-5 py-4 space-y-2" data-legal-translation>
      <p className="text-[14px] leading-relaxed text-paper-2">{t("translation")}</p>
      <EnglishVersion label={t("readEnglish")} />
    </aside>
  );
}

export function LegalPage({ doc, intro, sections, children }: {
  doc: LegalDoc;
  intro: ReactNode;
  sections: Array<{ id: string; title: string }>;
  children: ReactNode;
}) {
  const t = useTranslations("legal");
  const effective = useEffective();
  const others = LEGAL_DOCS.filter((d) => d.doc !== doc);
  return (
    <div className="min-h-screen bg-void">
      <PublicBar />
      <main className="pt-14">
        <div className="section"><article className="max-w-[820px] mx-auto pt-10 pb-16 [overflow-wrap:anywhere]">
          <nav aria-label={t("breadcrumb")} className="text-[13px] text-dim mb-3">
            <Link href="/legal" className="hover:text-paper underline underline-offset-2">{t("legal")}</Link>
            <span className="mx-2" aria-hidden>/</span>
            <span className="text-paper-2">{t(`doc.${doc}.title`)}</span>
          </nav>
          <h1 className="font-display text-[30px] sm:text-[38px] leading-tight text-paper">{t(`doc.${doc}.title`)}</h1>
          <p className="mt-2 text-[14px] italic text-paper-2">{t("effective", { date: effective(doc) })}</p>
          <GovernsNotice />

          <div className="mt-8 space-y-4">{intro}</div>

          <nav aria-label={t("onThisPage")} className="mt-8 panel px-5 py-4">
            <p className="text-[13px] font-medium text-paper mb-2">{t("onThisPage")}</p>
            <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[14px]">
              {sections.map((s, i) => (
                <li key={s.id}><a href={`#${s.id}`} className="text-paper-2 hover:text-paper underline underline-offset-2">{i + 1}. {s.title}</a></li>
              ))}
            </ol>
          </nav>

          <div className="mt-10 space-y-12">{children}</div>

          {others.length > 0 && (
            <section aria-labelledby="related" className="mt-16">
              <h2 id="related" className="font-display text-[20px] text-paper mb-4">{t("related")}</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {others.map((d) => (
                  <Link key={d.href} href={d.href} className="panel p-5 block hover:border-rule-lit">
                    <span className="block text-[15px] text-paper">{t(`doc.${d.doc}.title`)}</span>
                    <span className="block text-[13.5px] text-dim mt-1">{t(`doc.${d.doc}.blurb`)}</span>
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
export const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc ps-6 space-y-2 text-[15px] leading-relaxed text-paper-2 marker:text-dim">{children}</ul>;
export const A = ({ href, children }: { href: string; children: ReactNode }) => {
  const outside = /^https?:|^mailto:/.test(href);
  return outside
    ? <a href={href} className="text-paper underline underline-offset-2" {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>
    : <Link href={href} className="text-paper underline underline-offset-2">{children}</Link>;
};
export const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-paper">{children}</strong>;
