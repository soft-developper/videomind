"use client";
// vm_present: Share opens a small panel: the link (from the start or from
// the moment playing), a copy button, a QR code to scan or download, and
// the phone's own share sheet where there is one.
import { useState, useRef, useEffect } from "react";
import { Share2, Check, Copy, Download } from "lucide-react";
import { clsx } from "clsx";
import { QrCode } from "@/components/share/QrCode";
import { sharedLink, downloadQrPng } from "@/lib/qr";
import { slugify } from "@/lib/exports";
// vm_lang
import { useTranslations } from "next-intl";

const clock = (sec: number) => {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

export function ShareButton({
  videoId, title = "VideoMind", currentTime, align = "left",
}: {
  videoId: string;
  title?: string;
  /** where the player is; offered as "Start at" */
  currentTime?: number;
  align?: "left" | "right";
}) {
  const ts = useTranslations("share");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  // The moment is taken when the panel opens, so the code does not change while it is read.
  const [at, setAt] = useState(0);
  const [fromMoment, setFromMoment] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const toggle = () => {
    if (!open) { setAt(Math.floor(currentTime ?? 0)); setFromMoment(false); setCopied(false); }
    setOpen((o) => !o);
  };

  const link = sharedLink(videoId, fromMoment ? at : null);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2200); }
    catch { /* the link stays selectable in the box */ }
  };
  const shareSheet = async () => {
    try { await navigator.share({ title, url: link }); } catch { /* closed by the person */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 h-8 px-3 btn-ghost text-[12px] no-min"
      >
        <Share2 size={11} /> {ts("button")}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={ts("title")}
          className={clsx(
            "popover z-40 p-4 space-y-3",
            // On a phone the panel spans the screen under the bar; wider screens anchor it to the button.
            "max-sm:fixed max-sm:inset-x-4 max-sm:top-[72px] sm:absolute sm:top-full sm:mt-1 sm:w-[300px]",
            align === "right" ? "sm:end-0" : "sm:start-0",
          )}
        >
          <p className="text-[14px] font-semibold text-paper">{ts("title")}</p>

          <div className="flex gap-2">
            <label htmlFor={`share-link-${videoId}`} className="sr-only">{ts("link")}</label>
            <input
              id={`share-link-${videoId}`}
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              dir="ltr"
              className="flex-1 min-w-0 h-9 px-2.5 text-[12.5px] text-paper-2"
            />
            <button onClick={copy} className="btn btn-ghost h-9 px-3 text-[12.5px] shrink-0 inline-flex items-center gap-1.5">
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? ts("copied") : ts("copy")}
            </button>
          </div>

          {at >= 1 && (
            <label className="flex items-center gap-2 text-[13px] text-paper-2 cursor-pointer">
              <input type="checkbox" checked={fromMoment} onChange={(e) => setFromMoment(e.target.checked)} />
              {ts.rich("startAt", { time: clock(at), t: (c) => <span className="tc">{c}</span> })}
            </label>
          )}

          <div className="flex items-start gap-3">
            <QrCode text={link} label={ts("qr")} className="w-[132px] h-[132px] rounded-sm shrink-0" />
            <div className="space-y-2 min-w-0">
              <p className="text-[12.5px] text-dim leading-snug">{ts("qrHint")}</p>
              <button
                onClick={() => downloadQrPng(link, `${slugify(title) || "video"}-qr.png`)}
                className="text-[12.5px] text-paper-2 hover:text-paper underline underline-offset-2 inline-flex items-center gap-1 no-min"
              >
                <Download size={11} /> {ts("download")}
              </button>
              {canShare && (
                <button onClick={shareSheet} className="block text-[12.5px] text-paper-2 hover:text-paper underline underline-offset-2 no-min">
                  {ts("app")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
