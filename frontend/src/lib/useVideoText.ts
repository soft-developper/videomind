"use client";
// vm_translate: which language a video's words are shown in (Part 18b).
//
// The transcript, the captions, the summary, the chapters and the key
// moments are shown as spoken, or in a language the owner had them
// translated into. The choice is the viewer's and is kept in this browser
// only ("vm.textLang"). Until a viewer chooses, a finished translation in
// the interface language is shown, so a reader of the French site sees
// French captions on an English video.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import {
  getTranslations, getTranslatedText, getCaptions, type TextLang, type TranslationList, type VideoRecord,
} from "./api";

const KEY = "vm.textLang";
/** What the viewer chose last time: "spoken", a language, or null for never. */
function readChoice(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
function writeChoice(v: string) { try { localStorage.setItem(KEY, v); } catch { /* storage blocked: kept for this page only */ } }

type Line = { start: number; end: number; text: string; words?: Array<{ text: string; start: number; end: number }> };

export interface VideoText {
  /** null: as spoken */
  lang: TextLang | null;
  spoken: string | null;
  /** the finished languages a viewer can choose */
  available: TextLang[];
  choose: (l: TextLang | null) => void;
  /** the summary, chapters, key moments and transcript in the chosen language (as spoken where none) */
  ai: NonNullable<VideoRecord["ai"]> | undefined;
  /** the lines for the transcript panel: with word times as spoken, translated lines otherwise */
  lines: Line[] | undefined;
  /** WebVTT in the chosen language, for the player */
  captions: string | null;
  /** the whole list, for the owner's panel */
  list: TranslationList | undefined;
  refetchList: () => void;
}

export function useVideoText(video: VideoRecord | undefined, opts: { words?: Line[]; me?: string | null; prefer?: string | null } = {}): VideoText {
  const locale = useLocale();
  const id = video?.id ?? "";
  const hasSpeech = video?.status === "ready" && (video.ai?.transcript?.length ?? 0) > 0;
  const [choice, setChoice] = useState<string | null>(null);
  useEffect(() => { setChoice(readChoice()); }, []);

  const listQ = useQuery({
    queryKey: ["translations", id, opts.me ?? null],
    queryFn: () => getTranslations(id),
    enabled: hasSpeech, retry: false, staleTime: 30_000,
    // While the owner waits for a language, how far it has come.
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "queued" || i.status === "translating") ? 4000 : false),
  });
  const list = listQ.data;
  const available = useMemo(() => (list?.items ?? []).filter((i) => i.status === "done").map((i) => i.lang), [list]);

  const lang: TextLang | null = useMemo(() => {
    // A link that names a language (Presentation Mode's ?lang=) wins while that language exists.
    if (opts.prefer && (available as string[]).includes(opts.prefer)) return opts.prefer as TextLang;
    if (choice === "spoken") return null;
    if (choice && (available as string[]).includes(choice)) return choice as TextLang;
    if (!choice && locale !== list?.spoken && (available as string[]).includes(locale)) return locale as TextLang;
    return null;
  }, [choice, available, locale, list?.spoken, opts.prefer]);

  const textQ = useQuery({
    queryKey: ["translated-text", id, lang, opts.me ?? null],
    queryFn: () => getTranslatedText(id, lang!),
    enabled: hasSpeech && !!lang, retry: false, staleTime: 60_000,
  });
  const capQ = useQuery({
    queryKey: ["captions", id, lang ?? "spoken", opts.me ?? null],
    queryFn: () => getCaptions(id, "vtt", lang),
    enabled: hasSpeech, staleTime: Infinity, retry: false,
    // The captions on screen stay until the chosen language's have arrived.
    placeholderData: (prev) => prev,
  });

  const content = lang ? textQ.data : undefined;
  const ai = useMemo(() => {
    const a = video?.ai;
    if (!a || !content) return a;
    return {
      ...a, transcript: content.transcript,
      summary: content.summary ?? a.summary,
      chapters: content.chapters ?? a.chapters,
      highlights: content.highlights ?? a.highlights,
    };
  }, [video?.ai, content]);
  const lines = content ? content.transcript : (opts.words?.length ? opts.words : video?.ai?.transcript);

  return {
    lang: content ? lang : null, spoken: list?.spoken ?? null, available,
    choose: (l) => { const v = l ?? "spoken"; writeChoice(v); setChoice(v); },
    ai, lines,
    captions: capQ.data ?? null,
    list, refetchList: () => { void listQ.refetch(); },
  };
}

/** vm_present: the moment, and the chosen language of the captions, for the Presentation Mode link. */
export function presentQuery(t: number, lang: string | null): string {
  const q = new URLSearchParams();
  if (t >= 1) q.set("t", String(Math.floor(t)));
  if (lang) q.set("lang", lang);
  const s = q.toString();
  return s ? `?${s}` : "";
}
