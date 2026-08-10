import { Navbar } from "@/components/layout/Navbar";
import { ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";

const SHELBY = [
  {
    t: "Your wallet signs the blob",
    d: "The video goes to Shelby from the browser, signed by Petra. The backend never touches the bytes and holds no key that could delete your content.",
  },
  {
    t: "Blobs are namespaced to you",
    d: "Every video lives at videomind/videos/{id}/raw.mp4 under your own account address, retrievable straight from the Shelby gateway.",
  },
  {
    t: "48-hour expiry, handled",
    d: "Shelby testnet expires blobs after 48 hours. VideoMind checks on connect and renews everything that's close to lapsing — one signature covers the whole library.",
  },
  {
    t: "Built on the React SDK",
    d: "ShelbyClientProvider, useUploadBlobs and useAccountBlobs. Chunked upload and transaction submission run through the wallet adapter, not a server.",
  },
];

const STACK = [
  ["@shelby-protocol/react",   "useUploadBlobs, useAccountBlobs"],
  ["@shelby-protocol/sdk",     "server-side Shelby operations"],
  ["@aptos-labs/wallet-adapter-react", "wallet connect and signing"],
  ["Anthropic Claude",         "cuts, highlights, chat, search, curriculum"],
  ["OpenAI Whisper",           "transcription with timecodes"],
  ["Turso / libSQL",           "every AI output, persisted"],
  ["Next.js 14",               "frontend"],
  ["Express",                  "API"],
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-void">
      <Navbar />
      <main className="pt-14">

        {/* Hero */}
        <section className="border-b border-rule">
          <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-16 sm:py-20">
            <p className="eyebrow mb-6">Built on Shelby Protocol</p>
            <h1 className="font-display text-[38px] sm:text-[50px] leading-[1.02] text-paper">
              A video is a timeline.
              <br />
              <span className="italic text-signal">We give it a map.</span>
            </h1>
            <p className="text-[15px] font-sans text-paper-2/80 mt-6 max-w-xl leading-[1.65]">
              VideoMind reads a recording end to end, marks where the topic turns,
              flags what's worth knowing, and answers questions with the timecode
              attached. The video itself is stored on Shelby Protocol and signed by
              your wallet — nobody else can take it down.
            </p>
            <div className="flex gap-3 mt-8 flex-wrap">
              <Link href="/upload" className="btn btn-signal h-10 px-5 flex items-center gap-2">
                Upload a video <ArrowRight size={13} />
              </Link>
              <Link href="/" className="btn btn-ghost h-10 px-5 flex items-center">
                See the library
              </Link>
            </div>
          </div>
        </section>

        {/* Shelby integration — not numbered. this isn't a sequence. */}
        <section className="border-b border-rule">
          <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-12">
            <p className="eyebrow mb-8">Shelby integration</p>
            <div className="space-y-0">
              {SHELBY.map((s) => (
                <div key={s.t} className="py-5 border-t border-rule last:border-b">
                  <h2 className="font-display text-[20px] text-paper leading-tight">
                    {s.t}
                  </h2>
                  <p className="text-[13px] font-sans text-dim mt-2 leading-relaxed max-w-xl">
                    {s.d}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pipeline — THIS is a sequence, so it's numbered. */}
        <section className="border-b border-rule">
          <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-12">
            <p className="eyebrow mb-8">What happens to a video</p>
            <div className="space-y-0">
              {[
                ["Store",  "Your wallet signs. The blob lands on Shelby."],
                ["Read",   "Whisper transcribes every word, with a timecode."],
                ["Map",    "Claude finds the cuts, flags the moments, writes the summary."],
                ["Ask",    "Question it in plain language. Answers cite the timecode."],
              ].map(([n, d], i) => (
                <div key={n} className="flex gap-5 py-4 border-t border-rule last:border-b">
                  <span className="tc tabular-nums shrink-0 pt-1">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p className="font-display text-[18px] text-paper leading-none">{n}</p>
                    <p className="text-[13px] font-sans text-dim mt-1.5">{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stack */}
        <section className="border-b border-rule">
          <div className="max-w-[820px] mx-auto px-4 sm:px-6 py-12">
            <p className="eyebrow mb-8">Stack</p>
            <div>
              {STACK.map(([lib, note]) => (
                <div
                  key={lib}
                  className="flex items-baseline justify-between gap-6 py-2.5 border-t border-rule last:border-b"
                >
                  <span className="tc text-paper-2">{lib}</span>
                  <span className="text-[12px] font-sans text-dim text-right">{note}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <section className="max-w-[820px] mx-auto px-4 sm:px-6 py-16 text-center">
          <p className="font-display text-[26px] text-paper mb-6">
            Open source. Testnet. Yours.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <a
              href="https://github.com"
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
      </main>
    </div>
  );
}
