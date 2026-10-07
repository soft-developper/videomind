import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Suspense } from "react";
import { UploadZone } from "@/components/upload/UploadZone";

const STEPS = [
  { n: "Uploaded",    d: "The file goes to your library in parts. A dropped connection continues where it stopped." },
  { n: "Transcribed", d: "Every sentence is written down with the time it was said." },
  { n: "Chaptered",   d: "The recording is split where the topic changes, with a summary and key moments." },
  { n: "Stored on Shelby", d: "Your wallet signs the file and it is written to Shelby. This can also be done later." },
];

export default function UploadPage() {
  return (
    <AppShell>
      <PageHeader
        title="Upload a video"
        description="The file goes to your library, is transcribed and split into chapters, and can be stored on Shelby with your wallet."
      />
      <div className="section pb-16">
        <div className="grid lg:grid-cols-[minmax(0,640px)_300px] gap-x-14 gap-y-10 items-start">
            {/* vm_upload: the component reads the page address, which needs a Suspense boundary */}
            <Suspense fallback={<div className="h-48 scan rounded-lg" />}>
              <UploadZone />
            </Suspense>

            <aside>
              <h2 className="font-display text-[14px] text-paper mb-1">What happens next</h2>
              {/* This is a sequence, so it is numbered. */}
              <ol>
                {STEPS.map((s, i) => (
                  <li key={s.n} className="flex gap-3.5 py-3.5 border-b border-rule">
                    <span className="tc w-4 shrink-0 pt-px">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-paper leading-snug">{s.n}</p>
                      <p className="text-[13px] text-dim mt-0.5 leading-relaxed">{s.d}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-[13px] text-dim mt-4 leading-relaxed">
                Storage on Shelby is prepaid when you upload, for a fixed number of 24 hour
                payment periods. Each video's ownership proof shows the date it is paid until.
              </p>
            </aside>
        </div>
      </div>
    </AppShell>
  );
}
