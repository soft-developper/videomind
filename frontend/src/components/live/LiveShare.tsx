"use client";
// vm_share (Part 21a): Share for a live event: the watch link, X, WhatsApp,
// Telegram, Email, the system share sheet, Copy link and a QR code. On the
// watch page for viewers, and in the studio for the host.
import { useEffect, useRef, useState } from "react";
import { Share2, Check, Copy, Download } from "lucide-react";
import { clsx } from "clsx";
import { useTranslations } from "next-intl";
import { QrCode } from "@/components/share/QrCode";
import { SocialShare } from "@/components/share/SocialShare";
import { downloadQrPng } from "@/lib/qr";
import { slugify } from "@/lib/exports";

export const liveLink = (id: string) => (typeof window === "undefined" ? `/live/${id}` : `${window.location.origin}/live/${id}`);

/** The share links and copy box, without the button (the studio shows them in its own box). */
export function LiveShareLinks({ id, title, host }: { id: string; title: string; host: string }) {
  const t = useTranslations("share");
  const [copied, setCopied] = useState(false);
  const url = liveLink(id);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch { /* the link stays selectable */ }
  };
  return (
    <div className="space-y-3" data-live-share>
      <div className="flex gap-2">
        <label htmlFor={`live-link-${id}`} className="sr-only">{t("link")}</label>
        <input id={`live-link-${id}`} readOnly value={url} onFocus={(e) => e.currentTarget.select()} dir="ltr" className="flex-1 min-w-0 h-9 px-2.5 text-[12.5px] text-paper-2" />
        <button onClick={() => void copy()} className="btn btn-ghost h-9 px-3 text-[12.5px] shrink-0 inline-flex items-center gap-1.5">
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <SocialShare url={url} text={t("liveText", { title, host })} subject={title} />
    </div>
  );
}

export function LiveShareButton({ id, title, host, align = "right" }: { id: string; title: string; host: string; align?: "left" | "right" }) {
  const t = useTranslations("share");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const url = liveLink(id);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="relative shrink-0" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn btn-ghost h-9 px-3.5 inline-flex items-center gap-1.5 text-[13px]" data-live-share-button>
        <Share2 size={13} /> {t("button")}
      </button>
      {open && (
        <div role="dialog" aria-label={t("liveTitle")}
          className={clsx("popover z-40 p-4 space-y-3", "max-sm:fixed max-sm:inset-x-4 max-sm:top-[72px] sm:absolute sm:top-full sm:mt-1 sm:w-[340px]", align === "right" ? "sm:end-0" : "sm:start-0")}>
          <p className="text-[14px] font-semibold text-paper">{t("liveTitle")}</p>
          <LiveShareLinks id={id} title={title} host={host} />
          <div className="flex items-start gap-3">
            <QrCode text={url} label={t("qr")} className="w-[120px] h-[120px] rounded-sm shrink-0" />
            <div className="space-y-2 min-w-0">
              <p className="text-[12.5px] text-dim leading-snug">{t("liveQrHint")}</p>
              <button onClick={() => downloadQrPng(url, `${slugify(title) || "live"}-qr.png`)} className="text-[12.5px] text-paper-2 hover:text-paper underline underline-offset-2 inline-flex items-center gap-1 no-min">
                <Download size={11} /> {t("download")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
