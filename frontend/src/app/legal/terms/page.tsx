// vm_legal: the Terms of Service.
import type { Metadata } from "next";
import { LegalPage, Section, P, UL, A, B, LEGAL } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service | VideoMind",
  description: "The rules for using VideoMind, what you own, and what we promise and do not.",
};

const SECTIONS = [
  { id: "overview", title: "Terms overview" },
  { id: "who", title: "Who we are and who can use VideoMind" },
  { id: "wallet", title: "Your wallet and your account" },
  { id: "content", title: "Your content" },
  { id: "rules", title: "Rules for using VideoMind" },
  { id: "ai", title: "AI features" },
  { id: "live", title: "Live events and chat" },
  { id: "youtube", title: "Publishing to YouTube" },
  { id: "shelby", title: "Shelby and the Aptos network" },
  { id: "limits", title: "Limits, fees and changes" },
  { id: "copyright", title: "Copyright complaints" },
  { id: "ending", title: "Ending your use" },
  { id: "warranty", title: "No warranties" },
  { id: "liability", title: "Limits on liability" },
  { id: "law", title: "Governing law" },
  { id: "general", title: "General terms" },
  { id: "contact", title: "How to contact us" },
];

export default function TermsPage() {
  const mail = `mailto:${LEGAL.contact}`;
  return (
    <LegalPage
      title="Terms of Service"
      crumb="Terms of Service"
      sections={SECTIONS}
      intro={<>
        <P>
          These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between you and VideoMind (&ldquo;VideoMind&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), operated by its
          founder, an individual. They cover your use of the website at <A href={LEGAL.site}>vidzmind.xyz</A> and the services on it (the &ldquo;Services&rdquo;).
          Our <A href="/legal/privacy">Privacy Policy</A> explains how we handle information and is part of these Terms.
        </P>
        <P><B>By connecting a wallet, uploading, watching, chatting or otherwise using the Services, you agree to these Terms. If you do not agree, do not use the Services.</B></P>
      </>}
    >
      <Section id="overview" n={1} title="Terms overview">
        <UL>
          <li>You own your videos. You give us only the permission we need to run the Services for you.</li>
          <li>You are responsible for your wallet and for what you upload, stream, write and publish.</li>
          <li>AI output can be wrong. Check anything important.</li>
          <li>Anything stored on Shelby is public and cannot be deleted by us.</li>
          <li>The Services are new and provided as they are, without guarantees, and may change.</li>
        </UL>
      </Section>

      <Section id="who" n={2} title="Who we are and who can use VideoMind">
        <P>VideoMind is operated by its founder, an individual. You must be at least 13 years old to use the Services. If you are under 18, or under the age of majority where you live, a parent or guardian must agree to these Terms for you. You may not use the Services if the law forbids it.</P>
      </Section>

      <Section id="wallet" n={3} title="Your wallet and your account">
        <P>You sign in by proving you control an Aptos wallet. Your wallet is your account: whoever controls it controls your library. Keep your keys safe. We never hold them and cannot recover a lost wallet or undo a transaction you sign. You are responsible for everything done with your wallet on the Services.</P>
      </Section>

      <Section id="content" n={4} title="Your content">
        <P>&ldquo;Your content&rdquo; means the videos, recordings, live streams, titles, notes, chat messages and anything else you upload, stream or write. You keep all rights you have in it.</P>
        <P>You give VideoMind a worldwide, non exclusive, royalty free licence to store, copy, process, transcribe, analyze, display and send your content, only as needed to provide the Services to you and to the people you share with, and to follow your settings (private, unlisted, public, live, publish to YouTube). This licence ends when you delete the content, except for copies already shared with others at your choice (for example on YouTube or Shelby) and backups removed on their usual schedule.</P>
        <P>You promise that you have the rights needed to upload, stream and publish your content, including permission from people who appear or speak in it, and that it does not break these Terms or the law.</P>
      </Section>

      <Section id="rules" n={5} title="Rules for using VideoMind">
        <P>Do not use the Services to:</P>
        <UL>
          <li>upload, stream or share anything illegal, or anything that sexualizes or endangers children;</li>
          <li>infringe anyone&rsquo;s copyright, trademark, privacy or other rights;</li>
          <li>harass, threaten or abuse people, or promote violence or hatred against them;</li>
          <li>spread malware, scams or spam, or pretend to be someone else;</li>
          <li>get around limits, access controls or security, or overload the Services; or</li>
          <li>collect other people&rsquo;s information without their permission.</li>
        </UL>
        <P>We may remove content, end live events or limit access that we reasonably believe breaks these rules.</P>
      </Section>

      <Section id="ai" n={6} title="AI features">
        <P>Transcripts, chapters, summaries, answers, captions and other output are made by AI services (currently OpenAI and Anthropic) and can be incomplete or wrong. They are not professional advice. Check anything important against the video itself. You are responsible for how you use the output.</P>
      </Section>

      <Section id="live" n={7} title="Live events and chat">
        <UL>
          <li>The host is responsible for what is shown and said in a live event, and for choosing who may write in its chat.</li>
          <li>Everyone in a chat is responsible for their own messages. The host can delete messages and block people, and we may do the same.</li>
          <li>Live captions are made automatically and can be wrong.</li>
          <li>The recording of a live event is made in the host&rsquo;s own browser, and becomes a video only if the host uploads it.</li>
        </UL>
      </Section>

      <Section id="youtube" n={8} title="Publishing to YouTube">
        <P>The YouTube features use YouTube API Services. <B>By using them you agree to be bound by the <A href="https://www.youtube.com/t/terms">YouTube Terms of Service</A>.</B> Google&rsquo;s handling of your data is described in the <A href="http://www.google.com/policies/privacy">Google Privacy Policy</A>. You are responsible for what you publish to your channel and for following YouTube&rsquo;s rules. Google may limit uploads, and we cannot guarantee that an upload is accepted.</P>
      </Section>

      <Section id="shelby" n={9} title="Shelby and the Aptos network">
        <P>You can choose to store videos on Shelby, a decentralized storage network on Aptos, through transactions you sign with your own wallet. Anything stored there is public and cannot be deleted or changed by us. Shelby&rsquo;s current networks are early: storage is paid for a limited period, and data may be lost or wiped. Any network fees are yours. We do not control Shelby or Aptos and are not responsible for them. Keep your own copies of anything important.</P>
      </Section>

      <Section id="limits" n={10} title="Limits, fees and changes">
        <P>The Services are free to use today. They have daily and per item limits (for example on uploads, clips, live events, captions and YouTube uploads) to keep them working for everyone. If we introduce paid plans, we will tell you before you are charged, and nothing you already have will be charged without your agreement.</P>
        <P>The Services are new and may change, pause or stop. We may change features or limits, and we will try to give notice of important changes.</P>
      </Section>

      <Section id="copyright" n={11} title="Copyright complaints">
        <P>If you believe content on VideoMind infringes your copyright, write to <A href={mail}>{LEGAL.contact}</A> with: your contact details; the work you own; the address of the content on VideoMind; a statement that you believe in good faith the use is not authorized; a statement, under penalty of perjury, that your notice is accurate and that you own or may act for the owner of the right; and your physical or electronic signature. We will remove content when appropriate and may end the access of people who infringe repeatedly.</P>
      </Section>

      <Section id="ending" n={12} title="Ending your use">
        <P>You may stop using the Services at any time, delete your videos, and ask us to delete your other information (see the <A href="/legal/privacy">Privacy Policy</A>). We may suspend or end your access if you break these Terms, if the law requires it, or if we stop offering the Services. Sections 4 (the promises you make), 9, and 13 to 16 continue after your use ends.</P>
      </Section>

      <Section id="warranty" n={13} title="No warranties">
        <P>THE SERVICES ARE PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;. TO THE EXTENT THE LAW ALLOWS, WE MAKE NO WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY AND NON INFRINGEMENT, AND WE DO NOT PROMISE THAT THE SERVICES WILL BE UNINTERRUPTED, SECURE OR FREE OF ERRORS, OR THAT ANY CONTENT WILL BE KEPT.</P>
      </Section>

      <Section id="liability" n={14} title="Limits on liability">
        <P>TO THE EXTENT THE LAW ALLOWS, VIDEOMIND WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF DATA, CONTENT, PROFITS OR DIGITAL ASSETS, ARISING FROM THE SERVICES. OUR TOTAL LIABILITY FOR ANY CLAIM ABOUT THE SERVICES IS LIMITED TO THE GREATER OF THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM AND 100 US DOLLARS. Some places do not allow these limits, so they may not apply to you.</P>
        <P>You agree to defend and hold VideoMind harmless from claims by others arising from your content or your breach of these Terms.</P>
      </Section>

      <Section id="law" n={15} title="Governing law">
        <P>These Terms are governed by the laws of the State of Delaware, United States, and applicable United States federal law, without regard to conflict of law rules. Any dispute will be decided by the state or federal courts located in Delaware, and you and VideoMind agree to their jurisdiction. Before going to court, please write to us so we can try to solve the problem.</P>
      </Section>

      <Section id="general" n={16} title="General terms">
        <UL>
          <li>We may update these Terms. We will change the date at the top and give notice on the site before important changes take effect. Using the Services after that means you accept the new Terms.</li>
          <li>If part of these Terms cannot be enforced, the rest still applies. Not enforcing a part is not a waiver of it.</li>
          <li>You may not transfer these Terms. We may transfer them to a new operator of the Services.</li>
          <li>These Terms and the Privacy Policy are the whole agreement between you and VideoMind about the Services.</li>
        </UL>
      </Section>

      <Section id="contact" n={17} title="How to contact us">
        <P>Write to <A href={mail}>{LEGAL.contact}</A>.</P>
      </Section>
    </LegalPage>
  );
}
