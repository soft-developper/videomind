"use client";
// vm_lang: shows the English text of a legal page. It switches this
// browser to English (the language cookie), which the picker in the top
// bar switches back.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeLocaleCookie } from "@/i18n/config";

export function EnglishVersion({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => { writeLocaleCookie("en"); start(() => router.refresh()); }}
      className="text-[14px] text-paper underline underline-offset-2 hover:text-signal no-min"
      data-english-version
    >
      {label}
    </button>
  );
}
