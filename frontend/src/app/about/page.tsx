// src/app/about/page.tsx
// Submission page — showcases the full Shelby Protocol integration
// for the Shelby team evaluating VideoMind.
import { Navbar } from "@/components/layout/Navbar";
import {
  Zap, Brain, FileText, Search, MessageSquare,
  GitBranch, Database, Shield, Clock, ArrowRight,
  Upload, Layers, RefreshCw,
} from "lucide-react";
import Link from "next/link";

const SHELBY_FEATURES = [
  {
    icon: Upload,
    title: "Wallet-signed uploads",
    desc: "Every video is uploaded to Shelby Testnet directly from the user's connected Aptos wallet (Petra). The wallet signs the blob registration transaction — no backend private key involved in video storage.",
    tag: "Core integration",
  },
  {
    icon: Database,
    title: "Decentralised blob storage",
    desc: "Raw video files are stored as Shelby blobs under the path videomind/videos/{id}/raw.{ext}. Each blob is namespaced under the uploader's wallet address and retrievable via the Shelby HTTP gateway.",
    tag: "Storage layer",
  },
  {
    icon: Clock,
    title: "48-hour expiry + auto-renewal",
    desc: "Shelby Testnet enforces a 48-hour max blob expiration. VideoMind runs a cron daemon every 6 hours that checks for blobs expiring within 12 hours and automatically re-uploads them — keeping your library alive.",
    tag: "Renewal daemon",
  },
  {
    icon: RefreshCw,
    title: "ShelbyClientProvider + useUploadBlobs",
    desc: "The frontend wraps the app in ShelbyClientProvider from @shelby-protocol/react. The useUploadBlobs hook handles chunked multipart upload and transaction submission through the wallet adapter.",
    tag: "@shelby-protocol/react",
  },
  {
    icon: Shield,
    title: "Shelby Explorer integration",
    desc: "Every uploaded video links directly to the Shelby Explorer for the uploader's account address, giving full on-chain transparency of stored blobs.",
    tag: "Explorer links",
  },
];

const AI_PIPELINE = [
  { step: "01", label: "Upload",      desc: "Wallet signs blob → Shelby Testnet",        icon: Upload },
  { step: "02", label: "Transcribe",  desc: "OpenAI Whisper — full timestamped transcript", icon: FileText },
  { step: "03", label: "Analyze",     desc: "Claude AI — chapters, highlights, summary",    icon: Brain },
  { step: "04", label: "Store",       desc: "All outputs persisted in Turso (libSQL)",      icon: Database },
  { step: "05", label: "Chat",        desc: "Claude answers questions about the video",      icon: MessageSquare },
  { step: "06", label: "Search",      desc: "Semantic search across all videos",             icon: Search },
];

const TECH_STACK = [
  { label: "@shelby-protocol/sdk",    note: "Node.js client — blob renewal cron" },
  { label: "@shelby-protocol/react",  note: "useUploadBlobs, ShelbyClientProvider" },
  { label: "@aptos-labs/wallet-adapter-react v7", note: "Wallet connect, signing" },
  { label: "@aptos-labs/ts-sdk v6",   note: "Transaction submission, account" },
  { label: "Anthropic Claude API",    note: "Analysis, chat Q&A, semantic search" },
  { label: "OpenAI Whisper",          note: "Audio transcription with timestamps" },
  { label: "Next.js 14 App Router",   note: "Frontend framework" },
  { label: "Express.js + TypeScript", note: "Backend API server" },
  { label: "Turso / libSQL",          note: "Persistent database — all AI outputs" },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen gradient-mesh">
      <Navbar />
      <main className="pt-20 sm:pt-24 pb-20 px-4 sm:px-6 max-w-5xl mx-auto">

        {/* Hero */}
        <div className="pt-6 mb-16 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-volt/20 bg-volt/5 mb-6">
            <Zap size={12} className="text-volt" />
            <span className="text-xs font-mono text-volt">Built for Shelby Protocol</span>
          </div>
          <h1 className="font-syne text-3xl sm:text-4xl lg:text-5xl font-800 text-white leading-tight mb-5">
            Video<span className="text-volt">Mind</span>
            <br />
            <span className="text-white/50 text-2xl sm:text-3xl font-600">
              AI-First Video Intelligence
            </span>
          </h1>
          <p className="text-white/50 font-dm text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            VideoMind turns any video into a fully searchable AI knowledge base.
            Every video is stored on Shelby Protocol — the decentralised content
            layer that makes the whole platform possible.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <Link
              href="/"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-volt text-black font-syne font-semibold text-sm hover:bg-volt-dim volt-glow transition-all"
            >
              Open Library <ArrowRight size={14} />
            </Link>
            <Link
              href="/upload"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-dark-700 border border-white/10 text-white font-syne font-semibold text-sm hover:border-volt/20 transition-all"
            >
              <Upload size={14} /> Upload a Video
            </Link>
          </div>
        </div>

        {/* Shelby integration highlights */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-volt/20" />
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-volt/20 bg-volt/5">
              <Zap size={12} className="text-volt" />
              <span className="text-xs font-mono text-volt">Shelby Protocol Integration</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-volt/20" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {SHELBY_FEATURES.map(({ icon: Icon, title, desc, tag }) => (
              <div key={title} className="glass-card rounded-2xl p-5 space-y-3 hover:border-volt/20 transition-all group">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-10 h-10 rounded-xl bg-volt/10 border border-volt/20 flex items-center justify-center shrink-0 group-hover:bg-volt/15 transition-colors">
                    <Icon size={16} className="text-volt" />
                  </div>
                  <span className="text-[10px] font-mono text-volt/50 border border-volt/15 px-2 py-0.5 rounded-full shrink-0">
                    {tag}
                  </span>
                </div>
                <div>
                  <p className="font-syne font-semibold text-white text-sm">{title}</p>
                  <p className="text-xs text-white/40 font-dm mt-1.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}

            {/* Full-width architecture note */}
            <div className="sm:col-span-2 glass-card rounded-2xl p-5 border border-volt/10 bg-volt/[0.02]">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-volt/10 border border-volt/20 flex items-center justify-center shrink-0">
                  <Layers size={16} className="text-volt" />
                </div>
                <div>
                  <p className="font-syne font-semibold text-white text-sm">
                    Architecture: Shelby as the content layer
                  </p>
                  <p className="text-xs text-white/40 font-dm mt-1.5 leading-relaxed max-w-2xl">
                    VideoMind is designed so Shelby Protocol is the source of truth for all video content.
                    The frontend wallet uploads blobs directly — the backend never proxies video bytes.
                    AI-generated metadata (transcripts, chapters, summaries) lives in Turso and is
                    cross-referenced with Shelby blob addresses, so the full intelligence layer is
                    anchored to on-chain storage.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI pipeline */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-xs font-mono text-white/25 uppercase tracking-widest px-3">
              AI Pipeline
            </span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {AI_PIPELINE.map(({ step, label, desc, icon: Icon }) => (
              <div key={step} className="glass-card rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-volt/40 tracking-widest">{step}</span>
                  <div className="w-8 h-8 rounded-lg bg-dark-700 border border-white/10 flex items-center justify-center">
                    <Icon size={13} className="text-white/40" />
                  </div>
                </div>
                <div>
                  <p className="font-syne font-semibold text-white text-sm">{label}</p>
                  <p className="text-xs text-white/35 font-dm mt-1 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tech stack */}
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-xs font-mono text-white/25 uppercase tracking-widest px-3">
              Tech Stack
            </span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          <div className="glass-card rounded-2xl overflow-hidden">
            {TECH_STACK.map(({ label, note }, i) => (
              <div
                key={label}
                className={`flex items-center justify-between px-5 py-3.5 ${
                  i < TECH_STACK.length - 1 ? "border-b border-white/[0.06]" : ""
                } hover:bg-white/[0.02] transition-colors`}
              >
                <span className="font-mono text-xs text-white/70">{label}</span>
                <span className="text-[11px] font-dm text-white/30 text-right ml-4">{note}</span>
              </div>
            ))}
          </div>
        </section>

        {/* GitHub link placeholder + CTA */}
        <section className="text-center space-y-6">
          <div className="glass-card rounded-2xl p-8 border border-volt/10 bg-volt/[0.02] space-y-4">
            <div className="flex items-center justify-center gap-2 mb-2">
              <GitBranch size={16} className="text-volt" />
              <span className="font-syne font-semibold text-white">Open Source</span>
            </div>
            <p className="text-sm text-white/40 font-dm max-w-md mx-auto leading-relaxed">
              VideoMind is built on Shelby Protocol as an advanced integration contribution
              for the Shelby ecosystem. The full source code is available on GitHub.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Link
                href="http://github.com/soft-developper/videomind"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-dark-700 border border-white/10 text-white/70 font-syne font-semibold text-sm hover:border-white/20 transition-all"
              >
                <GitBranch size={13} /> View on GitHub
              </Link>
              <Link
                href="https://explorer.shelby.xyz/testnet"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-volt/20 bg-volt/5 text-volt font-syne font-semibold text-sm hover:bg-volt/10 transition-all"
              >
                <Zap size={13} /> Shelby Explorer
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
