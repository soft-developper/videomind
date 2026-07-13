"use client";
import { useEffect, useState } from "react";
import { getVideoStatus } from "@/lib/api";
import { clsx } from "clsx";
import Link from "next/link";

const STEPS = [
  { k: "uploading",    n: "Store", d: "Blob landing on Shelby" },
  { k: "transcribing", n: "Read",  d: "Whisper transcribing audio" },
  { k: "analyzing",    n: "Map",   d: "Claude finding cuts and highlights" },
  { k: "ready",        n: "Ask",   d: "Intelligence ready" },
];

const ORDER = ["uploading", "processing", "transcribing", "analyzing", "ready"];

export function ProcessingStatus({
  videoId, onReady,
}: { videoId: string; onReady: () => void }) {
  const [status, setStatus] = useState("uploading");

  useEffect(() => {
    if (status === "ready" || status === "error") return;
    const t = setInterval(async () => {
      try {
        const d = await getVideoStatus(videoId);
        setStatus(d.status);
        if (d.status === "ready") { clearInterval(t); onReady(); }
        if (d.status === "error") clearInterval(t);
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [videoId, status, onReady]);

  const idx = ORDER.indexOf(status);

  if (status === "error") {
    return (
      <div className="panel p-6 text-center space-y-4">
        <p className="font-display text-[22px] text-paper">Processing failed</p>
        <p className="text-[13px] font-sans text-dim leading-relaxed">
          The pipeline couldn't read this file. Usually an unsupported audio track.
        </p>
        <div className="flex gap-2 justify-center pt-1">
          <Link href="/upload" className="btn btn-signal h-9 px-4 flex items-center">
            Upload again
          </Link>
          <Link href="/" className="btn btn-ghost h-9 px-4 flex items-center">
            Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <header className="flex items-center gap-2.5 px-4 h-10 border-b border-rule">
        <span className="dot dot-work" />
        <span className="eyebrow">Processing</span>
      </header>

      <div>
        {STEPS.map((s, i) => {
          const si = ORDER.indexOf(s.k);
          const done = idx > si;
          const on = status === s.k || (s.k === "uploading" && status === "processing");
          return (
            <div
              key={s.k}
              className={clsx(
                "flex items-start gap-4 px-4 py-3.5 border-b border-rule last:border-0 transition-colors",
                on && "bg-signal-wash",
                !on && !done && "opacity-35"
              )}
            >
              <span className={clsx(
                "tc tabular-nums shrink-0 pt-0.5",
                on ? "tc-signal" : done ? "tc-marker" : ""
              )}>
                {done ? "done" : String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <p className={clsx(
                  "font-display text-[17px] leading-none",
                  on ? "text-paper" : done ? "text-dim" : "text-dim-2"
                )}>
                  {s.n}
                </p>
                <p className="text-[12px] font-sans text-dim mt-1.5">{s.d}</p>
              </div>
              {on && <span className="dot dot-work ml-auto mt-1.5" />}
            </div>
          );
        })}
      </div>

      <footer className="px-4 py-2.5 border-t border-rule">
        <p className="tc">Updates automatically · long videos take a few minutes</p>
      </footer>
    </div>
  );
}
