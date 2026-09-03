"use client";
import { Navbar } from "@/components/layout/Navbar";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

const STEPS = [
  { n: "1", title: "Watch",  body: "Reads the entire recording end to end, every word." },
  { n: "2", title: "Find",   body: "Marks where the topic turns and flags what matters." },
  { n: "3", title: "Ask",    body: "Answers your questions with the timecode attached." },
  { n: "4", title: "Own",    body: "Stored on Shelby and signed by your wallet." },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-void">
      <Navbar />

      <main className="pt-14">

        {/* ═══ HERO ═══════════════════════════════════════════════════════ */}
        <section className="border-b border-rule">
          <div className="section py-20 sm:py-28">
            <div className="max-w-3xl">
              <p className="eyebrow mb-6">Video intelligence · Shelby Protocol</p>

              <h1 className="font-display text-[38px] sm:text-[54px] lg:text-[62px] leading-[1.02] text-paper tracking-tightest">
                Turn long videos into
                <br />
                clear, <span className="italic text-signal">actionable</span> knowledge.
              </h1>

              <p className="text-[15px] sm:text-[17px] font-sans text-paper-2/80 mt-6 max-w-xl leading-[1.6]">
                VideoMind reads a recording end to end, marks where the topic
                turns, flags what's worth knowing, and answers questions with
                the timecode attached.
              </p>

              <div className="flex items-center gap-3 mt-9 flex-wrap">
                <Link href="/upload" className="btn btn-signal h-11 px-6 flex items-center gap-2">
                  Upload a video <ArrowRight size={14} />
                </Link>
                <Link href="/about" className="btn btn-ghost h-11 px-6 flex items-center">
                  How it works
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ FOUR STEPS ═════════════════════════════════════════════════ */}
        <section className="border-b border-rule">
          <div className="section py-16">
            <p className="eyebrow mb-10">Watch · Find · Ask · Own</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-rule border border-rule">
              {STEPS.map((s) => (
                <div key={s.n} className="bg-void panel-pad">
                  <span className="tc tc-marker">{s.n}</span>
                  <h3 className="font-display text-[22px] text-paper mt-3 leading-none">{s.title}</h3>
                  <p className="text-[13px] font-sans text-dim mt-3 leading-relaxed">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ SHELBY PROOF ═══════════════════════════════════════════════ */}
        <section>
          <div className="section py-16">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-10 items-center">
              <div>
                <span className="badge badge-marker mb-6"><ShieldCheck size={11} /> Decentralized · Immutable · Yours</span>
                <h2 className="font-display text-[30px] sm:text-[38px] text-paper leading-[1.05] tracking-tightest mt-4">
                  Your video, owned by
                  <br />
                  your <span className="italic text-marker">wallet</span>.
                </h2>
                <p className="text-[14px] font-sans text-paper-2/80 mt-5 max-w-md leading-[1.6]">
                  Every upload is stored on Shelby Protocol and signed by your
                  wallet. Nobody else can read it or take it down. The AI reads
                  the video; the chain proves it's yours.
                </p>
                <div className="flex items-center gap-3 mt-8 flex-wrap">
                  <Link href="/upload" className="btn btn-marker h-10 px-5 flex items-center gap-2">
                    Store your first video <ArrowRight size={13} />
                  </Link>
                </div>
              </div>

              <div className="panel panel-pad">
                <div className="panel-head">
                  <span className="panel-head-title">On-chain proof</span>
                  <span className="dot dot-live" />
                </div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="eyebrow">Stored on Shelby</span>
                    <ShieldCheck size={14} className="text-marker" />
                  </div>
                  <div className="rule-x pt-4 flex items-center justify-between">
                    <span className="eyebrow">Signed by wallet</span>
                    <span className="tc tc-marker">verified</span>
                  </div>
                  <div className="rule-x pt-4">
                    <p className="eyebrow mb-1.5">Wallet signature</p>
                    <p className="tc text-paper-2">0x7a3f…9c4e</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
