import { Navbar } from "@/components/layout/Navbar";
import { UploadZone } from "@/components/upload/UploadZone";

const STEPS = [
  { n: "Store",      d: "Your wallet signs the blob. It lands on Shelby Protocol, owned by you." },
  { n: "Read",       d: "Whisper transcribes every word with a timecode attached." },
  { n: "Map",        d: "Claude finds the cuts, flags what matters, and writes the summary." },
  { n: "Ask",        d: "Question the video in plain language. Every answer cites a timecode." },
];

export default function UploadPage() {
  return (
    <div className="min-h-screen bg-void">
      <Navbar />
      <main className="pt-14">
        <div className="border-b border-rule">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-10">
            <p className="eyebrow mb-4">Upload</p>
            <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.05] text-paper max-w-xl">
              Hand it a recording.
              <br />
              <span className="italic text-signal">Get back a map.</span>
            </h1>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
          <div className="grid lg:grid-cols-[1fr_320px] gap-10 items-start">
            <UploadZone />

            <aside className="space-y-0">
              <p className="eyebrow mb-4">What happens next</p>

              {/* This IS a sequence — order carries real information here. */}
              {STEPS.map((s, i) => (
                <div key={s.n} className="flex gap-4 py-4 border-t border-rule last:border-b">
                  <span className="tc tabular-nums shrink-0 pt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-[17px] text-paper leading-none">
                      {s.n}
                    </p>
                    <p className="text-[12px] font-sans text-dim mt-1.5 leading-relaxed">
                      {s.d}
                    </p>
                  </div>
                </div>
              ))}

              <div className="mt-6 pt-4 border-t border-rule">
                <p className="tc leading-relaxed">
                  Shelby testnet expires blobs after 48 hours. VideoMind flags
                  expiring videos when you connect — one signature renews them all.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
