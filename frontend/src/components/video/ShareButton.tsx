"use client";
import { useState } from "react";
import { Share2, Check } from "lucide-react";

export function ShareButton({ videoId }: { videoId: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}/v/${videoId}`;
    if (navigator.share) {
      try { await navigator.share({ title: "VideoMind", url }); return; } catch {}
    }
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <button
      onClick={share}
      className="flex items-center gap-1.5 h-8 px-3 btn-ghost text-[12px] no-min"
    >
      {copied ? <Check size={11} className="text-marker" /> : <Share2 size={11} />}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
