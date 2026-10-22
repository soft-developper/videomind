"use client";
// vm_share (Part 21a): share a link to other apps, with the links each
// platform documents (checked 22 Oct 2026):
//   X         https://x.com/intent/tweet?text=&url=         (X web intent)
//   WhatsApp  https://wa.me/?text=                           (WhatsApp click to chat)
//   Telegram  https://t.me/share/url?url=&text=              (Telegram sharing button)
//   Email     mailto:?subject=&body=
// Every other app (Instagram, Facebook, Messenger, Signal, SMS) through the
// system share sheet, where the browser has one. Facebook's own share link
// needs a registered Facebook app and LinkedIn documents no plain share link,
// so both are reached through the share sheet.
import { useEffect, useState } from "react";
import { Mail, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";

export function shareLinks(url: string, text: string, subject: string) {
  const u = encodeURIComponent(url), t = encodeURIComponent(text);
  return {
    x: `https://x.com/intent/tweet?text=${t}&url=${u}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
    email: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`,
  };
}

/** A row of buttons that open each app's own share screen in a new tab. */
export function SocialShare({ url, text, subject }: { url: string; text: string; subject: string }) {
  const t = useTranslations("share");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => { setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"); }, []);
  const l = shareLinks(url, text, subject);
  const btn = "btn btn-ghost h-8 px-2.5 text-[12.5px] inline-flex items-center gap-1.5 no-min";
  const sheet = async () => { try { await navigator.share({ title: subject, text, url }); } catch { /* closed by the person */ } };
  return (
    <div className="flex flex-wrap gap-1.5" data-social-share>
      <a href={l.x} target="_blank" rel="noopener noreferrer" className={btn} data-share="x">{t("onX")}</a>
      <a href={l.whatsapp} target="_blank" rel="noopener noreferrer" className={btn} data-share="whatsapp">WhatsApp</a>
      <a href={l.telegram} target="_blank" rel="noopener noreferrer" className={btn} data-share="telegram">Telegram</a>
      <a href={l.email} className={btn} data-share="email"><Mail size={12} aria-hidden /> {t("email")}</a>
      {canShare && <button type="button" onClick={() => void sheet()} className={btn} data-share="more"><Share2 size={12} aria-hidden /> {t("more")}</button>}
    </div>
  );
}
