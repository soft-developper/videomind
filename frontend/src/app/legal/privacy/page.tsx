// vm_legal: the Privacy Policy. It describes what the code actually does;
// change it whenever what VideoMind collects or who processes it changes.
import type { Metadata } from "next";
import { LegalPage, Section, P, H3, UL, A, B, LEGAL } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | VideoMind",
  description: "What VideoMind collects, why, who helps us run it, and the choices you have.",
};

const SECTIONS = [
  { id: "overview", title: "Privacy policy overview" },
  { id: "collect", title: "Information we collect" },
  { id: "use", title: "How we use information" },
  { id: "share", title: "How we share information" },
  { id: "google", title: "Google and YouTube data" },
  { id: "shelby", title: "Storing on Shelby" },
  { id: "device", title: "Information on your device" },
  { id: "store", title: "How we store and secure information" },
  { id: "keep", title: "How long we keep information" },
  { id: "choices", title: "Your choices and rights" },
  { id: "children", title: "Children" },
  { id: "us", title: "United States privacy disclosures" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "How to contact us" },
];

export default function PrivacyPage() {
  const mail = `mailto:${LEGAL.contact}`;
  return (
    <LegalPage
      title="Privacy Policy"
      crumb="Privacy Policy"
      sections={SECTIONS}
      intro={<>
        <P>
          This Privacy Policy explains how VideoMind (&ldquo;VideoMind&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) handles information when you use the
          website at <A href={LEGAL.site}>vidzmind.xyz</A> and the services on it (the &ldquo;Services&rdquo;): uploading and recording videos,
          transcripts, chapters and questions, sharing, clips, live events, and publishing to YouTube. VideoMind is operated by its founder,
          an individual, who is responsible for your information as described here.
        </P>
        <P>
          <B>By using the Services, you agree to this Privacy Policy and to our <A href="/legal/terms">Terms of Service</A>. If you do not agree, do not use the Services.</B>
        </P>
      </>}
    >
      <Section id="overview" n={1} title="Privacy policy overview">
        <UL>
          <li>You sign in with an Aptos wallet. We do not ask for your name, email address or password.</li>
          <li>We keep the videos you upload or record, and what VideoMind makes from them, so the Services can work. You can delete them at any time.</li>
          <li>We send your videos&rsquo; sound and text to AI providers to transcribe and understand them. We do not sell your information or use it for advertising.</li>
          <li>If you connect YouTube, we use that permission only to upload what you ask us to upload, and you can remove it at any time.</li>
          <li>Anything you choose to store on Shelby is public on a decentralized network and cannot be deleted by us.</li>
          <li>You can ask us to delete your information by writing to <A href={mail}>{LEGAL.contact}</A>. We do it within 7 days.</li>
        </UL>
      </Section>

      <Section id="collect" n={2} title="Information we collect">
        <H3>Information you give us</H3>
        <UL>
          <li><B>Your wallet address.</B> Signing in proves you control an Aptos wallet. We keep its public address and a record of your sessions. We never see or store your private keys.</li>
          <li><B>Profile.</B> The display name and short bio you choose to add, shown on your public profile.</li>
          <li><B>Videos and recordings.</B> The files you upload, or record in your browser and upload, with the title, description, category, tags, collections and visibility you set.</li>
          <li><B>What you write.</B> Bookmarks and notes, edited chapters, questions you ask about a video, and messages you write in a live event&rsquo;s chat with the name you give there.</li>
          <li><B>Live events.</B> When you go live, your camera or screen and your sound are sent to viewers. If live captions are on, what you say is written down and kept with the event.</li>
          <li><B>Messages to us.</B> Whatever you include when you write to us.</li>
        </UL>
        <H3>Information made by the Services</H3>
        <UL>
          <li>For each video: a transcript with times, chapters, a summary, highlights, suggested tags, captions, search passages, thumbnails, an audio copy, and any clips you make.</li>
          <li>Where you stopped watching a video, so you can continue.</li>
          <li>A record of usage quantities, such as minutes transcribed, AI tokens and bytes stored, tied to your wallet and video. It holds amounts, not content.</li>
          <li>For videos stored on Shelby, the public record of that storage (blob name, size, payment period).</li>
        </UL>
        <H3>Information collected automatically</H3>
        <UL>
          <li>Your IP address is used for a short time, in memory only, to limit how often requests can be made. We do not store it in our database.</li>
          <li>Our hosting providers keep standard server logs (such as IP address, time, page requested and browser type) for security and operations, under their own policies.</li>
          <li>We do not use analytics, advertising or tracking tools.</li>
        </UL>
        <H3>Information from other sources</H3>
        <UL>
          <li>From Google, if you connect YouTube: see <A href="#google">Google and YouTube data</A>.</li>
          <li>From the Aptos and Shelby networks: public records about storage tied to your wallet address.</li>
        </UL>
      </Section>

      <Section id="use" n={3} title="How we use information">
        <UL>
          <li>To provide the Services: store and play your videos, make transcripts, chapters, captions, search and answers, run live events, make clips, and publish to YouTube when you ask.</li>
          <li>To show what you choose to share: public and unlisted videos, your public profile, and live event pages.</li>
          <li>To keep the Services safe and fair: sign in, prevent abuse, apply daily limits, and investigate problems.</li>
          <li>To understand cost and usage, and to bill for the Services in the future if we introduce paid plans (we will tell you first).</li>
          <li>To answer you when you contact us, and to tell you about important changes.</li>
        </UL>
        <P>We do not sell your information, use it for advertising, or use your content to train AI models.</P>
      </Section>

      <Section id="share" n={4} title="How we share information">
        <P>We share information only as needed to run the Services, with these providers, who process it for us:</P>
        <UL>
          <li><B>Vercel</B> hosts the website. <B>Render</B> runs our servers. <B>Turso</B> holds our database. <B>Cloudflare R2</B> stores video files.</li>
          <li><B>OpenAI</B> receives your videos&rsquo; sound to transcribe it, transcript text to make search passages, and live event sound for live captions.</li>
          <li><B>Anthropic</B> receives transcripts, and the questions you ask, to make chapters, summaries and answers.</li>
          <li><B>LiveKit</B> carries live video, sound, captions and chat between the host and viewers.</li>
          <li><B>Google</B> receives the videos you choose to publish to YouTube, with the details you set.</li>
        </UL>
        <P>Other people see what you make public or share: videos you set as public or unlisted (and their transcripts and answers to questions about them), your public profile, live events, and your chat messages in them. A private video is shown only to you.</P>
        <P>We may also disclose information if the law requires it, to protect people&rsquo;s safety or our rights, or as part of a transfer of the Services to a new operator, who would be bound by this policy.</P>
      </Section>

      <Section id="google" n={5} title="Google and YouTube data">
        <P>If you choose to connect YouTube, VideoMind asks Google for permission to upload videos to your channel (the <code className="tc">youtube.upload</code> scope) and for your Google account&rsquo;s email address, which we show so you know which account is connected. We do not ask for permission to read your channel, your videos or anything else in your Google account.</P>
        <UL>
          <li><B>What we store:</B> your Google account email, the permission Google gives us (encrypted), and a record of each upload you start (its title, privacy setting, status and YouTube video ID).</li>
          <li><B>How we use it:</B> only to upload the videos and clips you choose, with the details you set, and to show you their status. We do not use it for anything else, share it, or sell it.</li>
          <li>VideoMind&rsquo;s use of information received from Google APIs follows the <A href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</A>, including its Limited Use requirements.</li>
          <li>By using the YouTube features you also agree to the <A href="https://www.youtube.com/t/terms">YouTube Terms of Service</A>. Google&rsquo;s handling of your data is described in the <A href="http://www.google.com/policies/privacy">Google Privacy Policy</A>.</li>
          <li><B>Removing access:</B> use Disconnect on any of your video pages, which deletes the stored permission and asks Google to revoke it. You can also remove VideoMind at any time from your Google account&rsquo;s security settings at <A href="https://security.google.com/settings/security/permissions">security.google.com/settings/security/permissions</A>.</li>
          <li><B>Deleting stored data:</B> our normal procedure for deleting stored data is: disconnecting deletes the stored permission and email at once; deleting a video deletes its upload records; and you can ask us to delete everything at <A href={mail}>{LEGAL.contact}</A>, which we do within 7 days. Videos already on YouTube stay on your channel; remove them in YouTube Studio.</li>
        </UL>
      </Section>

      <Section id="shelby" n={6} title="Storing on Shelby">
        <P>You can choose to store a video&rsquo;s original file on Shelby, a decentralized storage network on Aptos, signed by your own wallet. Anything stored there, and the record of it, is public: anyone with its address can read it. We cannot delete it, and making a video private in VideoMind does not remove a copy already on Shelby. Shelby&rsquo;s current networks are early and may lose data. A private video is never sent to Shelby unless you choose to.</P>
      </Section>

      <Section id="device" n={7} title="Information on your device">
        <P>We do not use cookies for tracking or advertising. The site keeps a few things in your browser&rsquo;s storage so it works:</P>
        <UL>
          <li>Your sign in session, so you stay signed in (for up to 7 days).</li>
          <li>Your preferences, such as whether captions are on and the defaults for new uploads.</li>
          <li>For a live event&rsquo;s chat, your chat pass and name, until you close the tab.</li>
          <li>Your wallet extension may keep which wallet you last used.</li>
        </UL>
        <P>You can clear these at any time in your browser.</P>
      </Section>

      <Section id="store" n={8} title="How we store and secure information">
        <P>Information is stored by the providers above, who may process it in the United States and other countries. We protect it with encrypted connections, short lived signed addresses for video files, sessions that expire, permission checks on every request, and encryption of stored YouTube permissions. No system is perfectly secure, and we cannot promise that information will never be accessed without permission.</P>
      </Section>

      <Section id="keep" n={9} title="How long we keep information">
        <UL>
          <li>Videos and everything made from them: until you delete the video. Deleting a video deletes its files, transcript, chapters, clips, search passages, notes and watch places, and its YouTube upload records.</li>
          <li>Unfinished uploads: deleted after 7 days.</li>
          <li>Sessions: they expire after 7 days.</li>
          <li>Profile, live events with their captions and chat, and your wallet record: until you ask us to delete them.</li>
          <li>Usage quantities: kept as business records, without content.</li>
          <li>Copies made by providers for backups or logs are removed on their own schedules.</li>
        </UL>
      </Section>

      <Section id="choices" n={10} title="Your choices and rights">
        <UL>
          <li><B>Access and change:</B> your library, profile and settings are in the app. You can edit your details at any time.</li>
          <li><B>Delete:</B> delete any video, or all your videos, from the library. To delete everything else (profile, live events, chat, wallet record), write to <A href={mail}>{LEGAL.contact}</A> from a message that names your wallet address. We complete deletions within 7 days, and we may ask you to prove you control the wallet.</li>
          <li><B>Disconnect YouTube</B> as described in <A href="#google">Google and YouTube data</A>.</li>
          <li><B>Visibility:</B> set any video to private, unlisted or public.</li>
          <li>Depending on where you live, you may have more rights, such as to receive a copy of your information, to object to or restrict some processing, or to complain to a data protection authority. Write to us and we will help.</li>
        </UL>
      </Section>

      <Section id="children" n={11} title="Children">
        <P>The Services are not meant for children under 13, and we do not knowingly collect information from them. If you believe a child under 13 has given us information, write to <A href={mail}>{LEGAL.contact}</A> and we will delete it.</P>
      </Section>

      <Section id="us" n={12} title="United States privacy disclosures">
        <P>In the last 12 months we have collected these categories of personal information, for the purposes in <A href="#use">How we use information</A>: identifiers (wallet address, Google account email if you connect YouTube), content you provide (videos, sound, text), internet activity needed to run the Services (sessions, watch places, usage quantities), and inferences only in the form of the summaries and chapters made from your own videos.</P>
        <P>We do not sell personal information, and we do not share it for cross context behavioral advertising. We do not use sensitive personal information to infer characteristics about you. You may ask to know, correct or delete your information as described above, and we will not treat you differently for doing so.</P>
      </Section>

      <Section id="changes" n={13} title="Changes to this policy">
        <P>We may update this policy as the Services change. We will change the date at the top, and for important changes we will give notice on the site before they take effect.</P>
      </Section>

      <Section id="contact" n={14} title="How to contact us">
        <P>For privacy questions, complaints or deletion requests, write to <A href={mail}>{LEGAL.contact}</A>. VideoMind is operated by its founder, an individual.</P>
      </Section>
    </LegalPage>
  );
}
