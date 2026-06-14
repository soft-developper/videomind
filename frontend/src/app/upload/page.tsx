import { Navbar } from "@/components/layout/Navbar";
import { UploadZone } from "@/components/upload/UploadZone";
import { Brain, Zap, FileText, Sparkles } from "lucide-react";

const PIPELINE = [
  { icon: Zap,      label: "Shelby Storage",  desc: "Raw video stored on decentralised Shelby Protocol" },
  { icon: FileText, label: "Whisper AI",       desc: "Full transcript with timestamps extracted" },
  { icon: Brain,    label: "Claude Analysis",  desc: "Chapters, highlights, summary, blog post & X thread" },
  { icon: Sparkles, label: "AI Chat Ready",    desc: "Ask any question about your video instantly" },
];

export default function UploadPage() {
  return (
    <div className="min-h-screen gradient-mesh">
      <Navbar />
      <main className="pt-20 sm:pt-24 pb-16 px-4 sm:px-6 max-w-6xl mx-auto">

        {/* Page header */}
        <div className="mb-8 pt-4">
          <span className="px-3 py-1 rounded-full border border-volt/20 bg-volt/5 text-xs font-mono text-volt">
            Upload & Analyze
          </span>
          <h1 className="font-syne text-2xl sm:text-3xl font-800 text-white mt-3 leading-tight">
            Transform your video into{" "}
            <span className="text-volt">AI intelligence</span>
          </h1>
          <p className="text-white/40 font-dm text-sm mt-3 max-w-lg leading-relaxed">
            Upload once. VideoMind handles everything — transcription, analysis,
            and decentralised storage on Shelby Protocol.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-8 lg:gap-10 items-start">

          {/* Upload zone */}
          <UploadZone />

          {/* Pipeline sidebar */}
          <div className="space-y-3">
            <p className="text-xs font-mono text-white/25 uppercase tracking-widest">
              What happens after upload
            </p>

            {PIPELINE.map(({ icon: Icon, label, desc }, i) => (
              <div key={label} className="flex items-start gap-4 glass-card rounded-xl p-4">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-volt/10 border border-volt/20 flex items-center justify-center">
                    <Icon size={15} className="text-volt" />
                  </div>
                  {i < PIPELINE.length - 1 && (
                    <div className="absolute left-1/2 top-full w-px h-3 bg-gradient-to-b from-volt/20 to-transparent -translate-x-1/2" />
                  )}
                </div>
                <div className="pt-1 min-w-0">
                  <p className="text-sm font-syne font-semibold text-white">{label}</p>
                  <p className="text-xs text-white/35 font-dm mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}

            {/* 48hr renewal note */}
            <div className="p-4 rounded-xl bg-volt/[0.04] border border-volt/15">
              <p className="text-xs font-mono text-volt/70 leading-relaxed">
                ⚡ Shelby Testnet: Blobs expire after 48hrs.
                VideoMind auto-renews all your videos every 6 hours.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
