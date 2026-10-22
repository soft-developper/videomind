// vm_legal: the Terms of Service.
// vm_lang: every paragraph is a message in the "terms" namespace. The
// English text governs; other languages are translations of it.
import type { Metadata } from "next";
import { useTranslations, type Messages } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LegalPage, Section, P, UL, rich } from "@/components/legal/LegalPage";

type Key = Exclude<keyof Messages["terms"], "s">;
type SectionId = keyof Messages["terms"]["s"];
type Block = ["p", Key] | ["ul", Key[]];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: `${t("doc.terms.title")} | VideoMind`, description: t("doc.terms.blurb") };
}

const BODY: Array<{ id: SectionId; blocks: Block[] }> = [
  { id: "overview", blocks: [["ul", ["o1", "o2", "o3", "o4", "o5", "o6"]]] },
  { id: "who", blocks: [["p", "whoP"]] },
  { id: "wallet", blocks: [["p", "walletP"]] },
  { id: "content", blocks: [["p", "contentP1"], ["p", "contentP2"], ["p", "contentP3"]] },
  { id: "rules", blocks: [["p", "rulesP1"], ["ul", ["rules1", "rules2", "rules3", "rules4", "rules5", "rules6"]], ["p", "rulesP2"]] },
  { id: "ai", blocks: [["p", "aiP"], ["p", "aiP2"]] },  // aiP2: vm_generate, Part 17b2
  { id: "live", blocks: [["ul", ["live1", "live2", "live3", "live4"]]] },
  { id: "youtube", blocks: [["p", "youtubeP"]] },
  { id: "shelby", blocks: [["p", "shelbyP"]] },
  // vm_credits: Part 16f
  { id: "credits", blocks: [["p", "creditsP1"], ["ul", ["credits1", "credits2", "credits3", "credits4", "credits5", "credits6"]], ["p", "creditsP2"]] },
  { id: "limits", blocks: [["p", "limitsP1"], ["p", "limitsP2"]] },
  { id: "copyright", blocks: [["p", "copyrightP"]] },
  { id: "ending", blocks: [["p", "endingP"]] },
  { id: "warranty", blocks: [["p", "warrantyP"]] },
  { id: "liability", blocks: [["p", "liabilityP1"], ["p", "liabilityP2"]] },
  { id: "law", blocks: [["p", "lawP"]] },
  { id: "general", blocks: [["ul", ["general1", "general2", "general3", "general4"]]] },
  { id: "contact", blocks: [["p", "contactP"]] },
];

export default function TermsPage() {
  const t = useTranslations("terms");
  const tags = rich();
  const r = (k: Key) => t.rich(k, tags);
  const sections = BODY.map((s) => ({ id: s.id, title: t(`s.${s.id}`) }));
  return (
    <LegalPage
      doc="terms"
      sections={sections}
      intro={<><P>{r("intro1")}</P><P>{r("intro2")}</P></>}
    >
      {BODY.map((s, i) => (
        <Section key={s.id} id={s.id} n={i + 1} title={sections[i].title}>
          {s.blocks.map((b, j) =>
            b[0] === "ul" ? <UL key={j}>{b[1].map((k) => <li key={k}>{r(k)}</li>)}</UL>
            : <P key={j}>{r(b[1])}</P>)}
        </Section>
      ))}
    </LegalPage>
  );
}
