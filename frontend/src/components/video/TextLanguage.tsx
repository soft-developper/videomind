"use client";
// vm_translate: choosing the language of a video's words, and the owner's
// translations (Part 18b). See lib/useVideoText.ts.
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Languages } from "lucide-react";
import { clsx } from "clsx";
import { LOCALE_NAMES, intlLocale, type Locale } from "@/i18n/config";
import { startTranslation, removeTranslation, ApiError, type TextLang, type TranslationItem } from "@/lib/api";
import { localize } from "@/lib/errorText";
import type { VideoText } from "@/lib/useVideoText";
import { useCredits, AddCreditsLink, isNoCredits } from "@/components/credits/Credits";
import { useMoney, inline, useFormat } from "@/lib/format";

/** A language named in the reader's language ("anglais" on the French site), or null. */
export function useLanguageName() {
  const locale = useLocale() as Locale;
  return (code: string | null | undefined): string | null => {
    if (!code) return null;
    try { return new Intl.DisplayNames([intlLocale(locale)], { type: "language" }).of(code) ?? null; } catch { return null; }
  };
}

/**
 * The viewer's choice: as spoken, or one of the finished translations.
 * Shows only when there is at least one. A native select, like the
 * interface language picker.
 */
export function TextLanguagePicker({ text, className }: { text: VideoText; className?: string }) {
  const t = useTranslations("textLang");
  const nameOf = useLanguageName();
  if (!text.available.length) return null;
  const spoken = nameOf(text.spoken);
  return (
    <label className={clsx("relative flex items-center gap-1.5 h-8 ps-3 pe-2 btn-ghost text-[12px] no-min", className)} data-text-lang>
      <Languages size={11} aria-hidden />
      <span className="sr-only">{t("label")}</span>
      <select
        value={text.lang ?? ""}
        onChange={(e) => text.choose((e.target.value || null) as TextLang | null)}
        className="bg-transparent border-0 p-0 pe-1 h-7 text-[12px] text-paper-2 hover:text-paper cursor-pointer focus:outline-none"
        title={t("label")}
      >
        <option value="">{spoken ? t("asSpoken", { name: spoken }) : t("asSpokenUnknown")}</option>
        {text.available.map((l) => <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>)}
      </select>
    </label>
  );
}

/** The owner's panel: which languages exist, how far one has come, and asking for another. */
export function TranslationsPanel({ videoId, text }: { videoId: string; text: VideoText }) {
  const t = useTranslations("textLang");
  const money = useMoney();
  const f = useFormat();
  const nameOf = useLanguageName();
  const qc = useQueryClient();
  const credits = useCredits();
  const [busy, setBusy] = useState<TextLang | null>(null);
  const [err, setErr] = useState<{ lang: TextLang; text: string; noCredits: boolean } | null>(null);
  const [confirm, setConfirm] = useState<TextLang | null>(null);
  const list = text.list;
  if (!list || list.canTranslate === undefined) return null;

  const perMinute = credits.costOf("translate");
  const price = perMinute != null && list.minutes != null ? Math.ceil(perMinute * list.minutes) : null;
  const short = price != null && credits.available != null && credits.available < price;
  const byLang = new Map<TextLang, TranslationItem>(list.items.map((i) => [i.lang, i]));
  const langs = list.offered.filter((l) => list.canTranslate || byLang.has(l));
  const after = () => { text.refetchList(); void qc.invalidateQueries({ queryKey: ["my-credits"] }); };

  const ask = async (l: TextLang) => {
    if (busy) return;
    setBusy(l); setErr(null);
    try { await startTranslation(videoId, l); after(); }
    catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setErr({ lang: l, noCredits: isNoCredits(code), text: code === "same_language" ? t("same", { name: nameOf(l) ?? LOCALE_NAMES[l] }) : e instanceof Error ? e.message : t("failed") });
    } finally { setBusy(null); }
  };
  const remove = async (l: TextLang) => {
    if (busy) return;
    setBusy(l); setErr(null); setConfirm(null);
    try {
      await removeTranslation(videoId, l);
      if (text.lang === l) text.choose(null);
      after();
    } catch (e) { setErr({ lang: l, noCredits: false, text: e instanceof Error ? e.message : t("failed") }); }
    finally { setBusy(null); }
  };

  const spoken = nameOf(list.spoken);
  return (
    <section className="panel" aria-labelledby="translations-title" data-translations>
      <header className="px-4 sm:px-5 pt-4 pb-3 border-b border-rule">
        <h2 id="translations-title" className="text-[14px] font-semibold text-paper">{t("title")}</h2>
        <p className="text-[13px] text-dim mt-1 leading-relaxed max-w-[68ch]">
          {spoken ? t("introSpoken", { name: spoken }) : t("intro")}
        </p>
        {price != null && (
          <p className={clsx("text-[12px] mt-1.5", short ? "text-warn" : "text-dim")} data-translate-price>
            {t("price", { price: inline(money(price)), minutes: Math.max(1, Math.round(list.minutes ?? 0)) })}
            {credits.available != null && <> {t("have", { amount: inline(money(credits.available)) })}</>}
            {short && <> <AddCreditsLink /></>}
          </p>
        )}
        {!list.canTranslate && <p className="text-[12.5px] text-dim mt-1.5">{t("cannot")}</p>}
      </header>
      <ul>
        {langs.map((l) => {
          const it = byLang.get(l);
          const name = LOCALE_NAMES[l];
          const working = it?.status === "queued" || it?.status === "translating";
          const pct = it && it.total > 0 ? Math.round((it.done / it.total) * 100) : 0;
          return (
            <li key={l} className="px-4 sm:px-5 py-3 border-b border-rule last:border-0" data-translation={l} data-status={it?.status ?? "none"}>
              <div className="flex items-center gap-3 flex-wrap">
                <span lang={l} className="text-[14px] text-paper min-w-[7.5rem]">{name}</span>
                <span className="text-[12.5px] text-dim flex-1 min-w-[10rem]" role={working ? "status" : undefined}>
                  {!it && t("notMade")}
                  {it?.status === "queued" && t("queued")}
                  {it?.status === "translating" && t("translating", { done: it.done, total: it.total })}
                  {it?.status === "done" && (it.updatedAt ? t("doneOn", { date: f.date(it.updatedAt) }) : t("done"))}
                  {it?.status === "failed" && <span className="text-error">{it.errorCode === "same_language" ? t("same", { name: nameOf(l) ?? name }) : `${t("notFinished")} ${localize(it.error) ?? ""}`}</span>}
                </span>
                <span className="flex items-center gap-2 ms-auto">
                  {!it && list.canTranslate && (
                    <button type="button" onClick={() => ask(l)} disabled={!!busy || short} className="btn btn-ghost h-8 px-3 text-[12.5px] no-min" data-translate-start={l}>
                      {busy === l ? t("asking") : t("translate")}
                    </button>
                  )}
                  {it?.status === "failed" && it.errorCode !== "same_language" && list.canTranslate && (
                    <button type="button" onClick={() => ask(l)} disabled={!!busy || short} className="btn btn-ghost h-8 px-3 text-[12.5px] no-min" data-translate-retry={l}>
                      {busy === l ? t("asking") : t("again")}
                    </button>
                  )}
                  {it?.status === "done" && text.lang !== l && (
                    <button type="button" onClick={() => text.choose(l)} className="btn btn-ghost h-8 px-3 text-[12.5px] no-min" data-translate-show={l}>{t("show")}</button>
                  )}
                  {it?.status === "done" && text.lang === l && <span className="text-[12.5px] text-marker">{t("showing")}</span>}
                  {it && confirm !== l && (
                    <button type="button" onClick={() => setConfirm(l)} disabled={!!busy} className="text-[12.5px] text-dim hover:text-paper underline-offset-2 hover:underline no-min" data-translate-remove={l}>
                      {working ? t("stop") : t("remove")}
                    </button>
                  )}
                  {it && confirm === l && (
                    <span className="flex items-center gap-2 text-[12.5px]" data-translate-confirm={l}>
                      <span className="text-paper-2">{it.status === "done" ? t("removeSure") : t("stopSure")}</span>
                      <button type="button" onClick={() => remove(l)} className="text-error hover:underline no-min">{t("yes")}</button>
                      <button type="button" onClick={() => setConfirm(null)} className="text-dim hover:text-paper no-min">{t("no")}</button>
                    </span>
                  )}
                </span>
              </div>
              {working && (
                <div className="mt-2 h-1 bg-rule rounded-full overflow-hidden" aria-hidden>
                  <div className="h-full bg-signal transition-[width] duration-500" style={{ width: `${Math.max(3, pct)}%` }} />
                </div>
              )}
              {err?.lang === l && (
                <p role="alert" className="text-[12.5px] text-error mt-1.5">
                  {err.text}{err.noCredits && <> <AddCreditsLink /></>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
