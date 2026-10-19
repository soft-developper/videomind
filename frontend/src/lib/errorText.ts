"use client";
// vm_lang: messages that come from outside the page, in the reader's language.
//
// The API answers in English, and some errors are made in plain modules
// (the uploader, sign in, live captions) where no translator is at hand.
// Each such message has an English template in the "errors" namespace of
// src/messages/en.json, written exactly as the server or the module says
// it, with {name} where a value goes. localize() finds the template a
// message matches and gives the same message in the reader's language,
// with the values carried over. A message with no template stays as it
// came, in English, so nothing is ever lost.
import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import en from "@/messages/en.json";

type Key = keyof typeof en.errors;
type Translate = (key: Key, values: Record<string, string | number>) => string;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Template { key: Key; re: RegExp; names: string[]; fixed: number }

/** "Keep it under {max} characters." -> /^Keep it under (.*?) characters\.$/ */
export const TEMPLATES: Template[] = (Object.entries(en.errors) as Array<[Key, string]>)
  .map(([key, text]) => {
    const names: string[] = [];
    const parts = text.split(/\{(\w+)\}/);
    let src = "";
    parts.forEach((p, i) => {
      if (i % 2) { names.push(p); src += "([\\s\\S]*?)"; } else src += escape(p);
    });
    return { key, re: new RegExp(`^${src}$`), names, fixed: parts.filter((_, i) => i % 2 === 0).join("").length };
  })
  // The most specific template first, so a general one never wins by accident.
  .sort((a, b) => b.fixed - a.fixed);

let translate: Translate | null = null;

/** The template a message matches, and its values. */
export function matchError(text: string): { key: Key; values: Record<string, string | number> } | null {
  const flat = text.trim();
  for (const t of TEMPLATES) {
    const m = t.re.exec(flat);
    if (!m) continue;
    const values: Record<string, string | number> = {};
    t.names.forEach((n, i) => { values[n] = /^\d+$/.test(m[i + 1]) ? Number(m[i + 1]) : m[i + 1]; });
    return { key: t.key, values };
  }
  return null;
}

/** The message in the reader's language, or as it came when it is English or unknown. */
export function localize(text: string): string;
export function localize(text: string | null | undefined): string | null | undefined;
export function localize(text: string | null | undefined) {
  if (!text || !translate) return text;
  const hit = matchError(text);
  if (!hit) return text;
  try { return translate(hit.key, hit.values); } catch { return text; }
}

/** Gives localize() the reader's language. Rendered once, inside the language provider. */
export function ErrorTextBridge() {
  const locale = useLocale();
  const t = useTranslations("errors");
  useEffect(() => {
    translate = locale === "en" ? null : (key, values) => t(key, values as never);
    return () => { translate = null; };
  }, [locale, t]);
  return null;
}
