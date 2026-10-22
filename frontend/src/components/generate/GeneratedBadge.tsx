"use client";
// vm_generate: a video made from a description says so, with the model.
// Its owner can also read the description it was made from.
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import type { Generated } from "@/lib/api";

export function GeneratedBadge({ g }: { g: Generated | null | undefined }) {
  const t = useTranslations("videoPage.generated");
  if (!g) return null;
  return (
    <div className="mt-2 text-[13px]" data-generated>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-0.5 text-paper-2">
        <Sparkles size={12} aria-hidden /> {t("label", { model: g.model })}
      </span>
      {g.prompt && (
        <details className="mt-2 max-w-2xl">
          <summary className="cursor-pointer text-dim hover:text-paper">{t("prompt")}</summary>
          <p className="text-paper-2 mt-1.5 leading-relaxed whitespace-pre-line" dir="auto">{g.prompt}</p>
        </details>
      )}
    </div>
  );
}
