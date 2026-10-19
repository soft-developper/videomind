import { AppShell } from "@/components/layout/AppShell";
import { ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
// vm_lang
import { getTranslations } from "next-intl/server";

const SHELBY = ["signs", "namespaced", "prepaid", "sdk"] as const;
const STEPS = ["store", "read", "map", "ask"] as const;

const NOTES = ["react", "sdk", "wallet", "claude", "whisper", "turso", "next", "express"] as const;
const STACK: Array<[string, (typeof NOTES)[number]]> = [
  ["@shelby-protocol/react",   "react"],
  ["@shelby-protocol/sdk",     "sdk"],
  ["@aptos-labs/wallet-adapter-react", "wallet"],
  ["Anthropic Claude",         "claude"],
  ["OpenAI Whisper",           "whisper"],
  ["Turso / libSQL",           "turso"],
  ["Next.js 14",               "next"],
  ["Express",                  "express"],
];

export default async function AboutPage() {
  const t = await getTranslations("about");
  return (
    <AppShell>
      <div>

        {/* Hero */}
        <section className="border-b border-rule">
          <div className="section [&>*]:max-w-[760px] py-16 sm:py-20">
            <p className="eyebrow mb-6">{t("eyebrow")}</p>
            <h1 className="font-display text-[38px] sm:text-[50px] leading-[1.02] text-paper">
              {t("headline1")}
              <br />
              {t("headline2")}
            </h1>
            <p className="text-[15px] font-sans text-paper-2/80 mt-6 max-w-xl leading-[1.65]">
              {t("intro")}
            </p>
            <div className="flex gap-3 mt-8 flex-wrap">
              <Link href="/upload" className="btn btn-signal h-10 px-5 flex items-center gap-2">
                {t("upload")} <ArrowRight size={13} className="rtl:rotate-180" />
              </Link>
              <Link href="/library" className="btn btn-ghost h-10 px-5 flex items-center">
                {t("library")}
              </Link>
            </div>
          </div>
        </section>

        {/* Shelby integration: not numbered, this is not a sequence. */}
        <section className="border-b border-rule">
          <div className="section [&>*]:max-w-[760px] py-12">
            <p className="eyebrow mb-8">{t("shelbyTitle")}</p>
            <div className="space-y-0">
              {SHELBY.map((k) => (
                <div key={k} className="py-5 border-t border-rule last:border-b">
                  <h2 className="font-display text-[20px] text-paper leading-tight">
                    {t(`shelby.${k}.t`)}
                  </h2>
                  <p className="text-[13px] font-sans text-dim mt-2 leading-relaxed max-w-xl">
                    {t(`shelby.${k}.d`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pipeline: this is a sequence, so it is numbered. */}
        <section className="border-b border-rule">
          <div className="section [&>*]:max-w-[760px] py-12">
            <p className="eyebrow mb-8">{t("stepsTitle")}</p>
            <div className="space-y-0">
              {STEPS.map((k, i) => (
                <div key={k} className="flex gap-5 py-4 border-t border-rule last:border-b">
                  <span className="tc tabular-nums shrink-0 pt-1">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p className="font-display text-[18px] text-paper leading-none">{t(`steps.${k}.t`)}</p>
                    <p className="text-[13px] font-sans text-dim mt-1.5">{t(`steps.${k}.d`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stack */}
        <section className="border-b border-rule">
          <div className="section [&>*]:max-w-[760px] py-12">
            <p className="eyebrow mb-8">{t("stackTitle")}</p>
            <div>
              {STACK.map(([lib, note]) => (
                <div
                  key={lib}
                  className="flex items-baseline justify-between gap-6 py-2.5 border-t border-rule last:border-b"
                >
                  <span className="tc text-paper-2" dir="ltr">{lib}</span>
                  <span className="text-[12px] font-sans text-dim text-end">{t(`stack.${note}`)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <section className="section [&>*]:max-w-[760px] py-16">
          <p className="font-display text-[26px] text-paper mb-6">
            {t("closing")}
          </p>
          <div className="flex gap-3 flex-wrap">
            <a
              href="https://github.com/soft-developper/videomind"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost h-9 px-4 flex items-center gap-1.5"
            >
              GitHub <ExternalLink size={11} />
            </a>
            <a
              href="https://explorer.aptoslabs.com/?network=shelbynet"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-marker h-9 px-4 flex items-center gap-1.5"
            >
              Shelby Explorer <ExternalLink size={11} />
            </a>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
