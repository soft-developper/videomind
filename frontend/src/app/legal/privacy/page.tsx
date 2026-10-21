// vm_legal: the Privacy Policy. It describes what the code actually does;
// change it whenever what VideoMind collects or who processes it changes.
// vm_lang: every paragraph is a message in the "privacy" namespace. The
// English text governs; other languages are translations of it.
import type { Metadata } from "next";
import { useTranslations, type Messages } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LegalPage, Section, P, H3, UL, rich } from "@/components/legal/LegalPage";

type Key = Exclude<keyof Messages["privacy"], "s">;
type SectionId = keyof Messages["privacy"]["s"];
type Block = ["p" | "h3", Key] | ["ul", Key[]];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: `${t("doc.privacy.title")} | VideoMind`, description: t("doc.privacy.blurb") };
}

const BODY: Array<{ id: SectionId; blocks: Block[] }> = [
  { id: "overview", blocks: [["ul", ["o1", "o2", "o3", "o4", "o5", "o6"]]] },
  { id: "collect", blocks: [
    ["h3", "giveH"], ["ul", ["give1", "give2", "give3", "give4", "give5", "give6", "give7"]],
    ["h3", "madeH"], ["ul", ["made1", "made2", "made3", "made4", "made5", "made6"]],
    ["h3", "autoH"], ["ul", ["auto1", "auto2", "auto3", "auto4"]],
    ["h3", "otherH"], ["ul", ["other1", "other2"]],
  ] },
  { id: "use", blocks: [["ul", ["use1", "use2", "use3", "use4", "use5", "use6"]], ["p", "useP"]] },
  { id: "share", blocks: [["p", "shareP1"], ["ul", ["share1", "share2", "share3", "share4", "share5", "share6"]], ["p", "shareP2"], ["p", "shareP3"]] },
  { id: "google", blocks: [["p", "googleP"], ["ul", ["google1", "google2", "google3", "google4", "google5", "google6"]]] },
  { id: "shelby", blocks: [["p", "shelbyP"]] },
  { id: "device", blocks: [["p", "deviceP1"], ["ul", ["device0", "device1", "device2", "device3", "device4", "device5"]], ["p", "deviceP2"]] },
  { id: "store", blocks: [["p", "storeP"]] },
  { id: "keep", blocks: [["ul", ["keep1", "keep2", "keep3", "keep4", "keep5", "keep6", "keep7"]]] },
  { id: "choices", blocks: [["ul", ["choices1", "choices2", "choices3", "choices4", "choices5"]]] },
  { id: "children", blocks: [["p", "childrenP"]] },
  { id: "us", blocks: [["p", "usP1"], ["p", "usP2"]] },
  { id: "changes", blocks: [["p", "changesP"]] },
  { id: "contact", blocks: [["p", "contactP"]] },
];

export default function PrivacyPage() {
  const t = useTranslations("privacy");
  const tags = rich();
  const r = (k: Key) => t.rich(k, tags);
  const sections = BODY.map((s) => ({ id: s.id, title: t(`s.${s.id}`) }));
  return (
    <LegalPage
      doc="privacy"
      sections={sections}
      intro={<><P>{r("intro1")}</P><P>{r("intro2")}</P></>}
    >
      {BODY.map((s, i) => (
        <Section key={s.id} id={s.id} n={i + 1} title={sections[i].title}>
          {s.blocks.map((b, j) =>
            b[0] === "ul" ? <UL key={j}>{b[1].map((k) => <li key={k}>{r(k)}</li>)}</UL>
            : b[0] === "h3" ? <H3 key={j}>{r(b[1])}</H3>
            : <P key={j}>{r(b[1])}</P>)}
        </Section>
      ))}
    </LegalPage>
  );
}
