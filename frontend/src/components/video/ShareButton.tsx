"use client";
import { useState } from "react";
import { Share2, CheckCircle, Link2 } from "lucide-react";

export function ShareButton({ videoId }: { videoId: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}/v/${videoId}`;

    // Use native share sheet on mobile if available
    if (navigator.share) {
      try {
        await navigator.share({ title: "VideoMind", url });
        return;
      } catch { /* user cancelled — fall through to copy */ }
    }

    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <button
      onClick={share}
      className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-dark-700 border border-white/10 text-xs font-syne font-semibold text-white/60 hover:text-white hover:border-white/20 transition-all"
    >
      {copied
        ? <><CheckCircle size={12} className="text-volt" /> Link copied</>
        : <><Share2 size={12} /> Share</>}
    </button>
  );
}
