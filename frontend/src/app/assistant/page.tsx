"use client";
import { useState, useRef, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { askLibrary, type LibraryAnswer } from "@/lib/api";
// vm_charge
import { PriceTag, AddCreditsLink, isNoCredits } from "@/components/credits/Credits";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { Send, RefreshCw } from "lucide-react";
import { readableTime } from "@/lib/exports";
import Link from "next/link";
import { clsx } from "clsx";
// vm_lang
import { useTranslations } from "next-intl";

interface Msg {
  role: "you" | "ai";
  text: string;
  cites?: LibraryAnswer["citations"];
  failed?: boolean;
  code?: string;
}

// Asked in the reader's language, so the answer comes back in it.
const PROMPTS = ["themes", "learned", "disagree", "often"] as const;

export default function AssistantPage() {
  const t = useTranslations("assistant");
  const qc = useQueryClient();
  const { connected } = useWallet();
  // vm_signin: questions are sent only once the wallet has signed in
  const wallet = useSessionWallet();

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // vm_shell: keep the newest message in view by scrolling this list only,
  // never the page, and only once there is a message.
  useEffect(() => {
    const box = end.current?.parentElement;
    if (box && msgs.length) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    if (!wallet) {
      // vm_signin: say why nothing was sent, instead of ignoring the question
      setMsgs((m) => [...m, { role: "ai", text: t("signInFirst"), failed: true }]);
      return;
    }
    setQ(""); setLast(question);
    setMsgs((m) => [...m, { role: "you", text: question }]);
    setBusy(true);
    try {
      const r = await askLibrary(question, wallet);
      setMsgs((m) => [...m, { role: "ai", text: r.answer, cites: r.citations }]);
      qc.invalidateQueries({ queryKey: ["my-credits"] });
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "ai", text: e?.message || t("failed"), failed: true, code: e?.code }]);
    } finally { setBusy(false); }
  };

  return (
    <AppShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <div className="section pb-16">
        <div className="max-w-[820px]">
          {!connected ? (
            <EmptyState title={t("connect")} action={<WalletButton />}>
              {t("connectBody")}
            </EmptyState>
          ) : (
            <div className="panel flex flex-col h-[62vh] min-h-[440px]">
              <div className="flex-1 overflow-y-auto p-4 space-y-5 min-h-0">
                {msgs.length === 0 && (
                  <div className="space-y-3 pt-6">
                    <p className="text-[13px] text-dim">{t("try")}</p>
                    <div className="space-y-2">
                      {PROMPTS.map((p) => (
                        <button
                          key={p}
                          onClick={() => ask(t(`prompts.${p}`))}
                          className="w-full text-start px-3.5 py-2.5 rounded-md border border-rule text-[13.5px] font-sans text-paper-2 hover:text-paper hover:border-rule-lit hover:bg-slate-2 transition-colors no-min"
                        >
                          {t(`prompts.${p}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {msgs.map((m, i) => (
                  <div key={i} className="space-y-2.5">
                    <div className={clsx(
                      "px-3.5 py-3",
                      m.failed  ? "border-s-2 border-error bg-error/5"
                      : m.role === "you" ? "bubble-you"
                      : "bubble-ai"
                    )}>
                      <p dir="auto" className={clsx(
                        "text-[14px] font-sans leading-[1.65]",
                        m.failed ? "text-error" : m.role === "you" ? "text-paper" : "text-paper-2"
                      )}>
                        {m.text}
                        {m.failed && isNoCredits(m.code) && <> <AddCreditsLink code={m.code} /></>}
                      </p>
                    </div>

                    {m.failed && i === msgs.length - 1 && (
                      <button
                        onClick={() => { setMsgs((x) => x.slice(0, -1)); ask(last); }}
                        className="flex items-center gap-1.5 tc hover:text-paper transition-colors no-min"
                      >
                        <RefreshCw size={9} /> {t("retry")}
                      </button>
                    )}

                    {m.cites && m.cites.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[13px] text-dim">
                          {t("sources", { count: m.cites.length })}
                        </p>
                        {m.cites.map((c, j) => (
                          <Link
                            key={j}
                            href={`/video/${c.videoId}`}
                            className="block px-3.5 py-2.5 rounded-md border border-rule hover:border-rule-lit hover:bg-slate-2 transition-colors group"
                          >
                            <div className="flex items-baseline justify-between gap-3 mb-1">
                              <span className="text-[13px] font-sans font-medium text-paper truncate" dir="auto">
                                {c.videoTitle}
                              </span>
                              <span className="tc tc-signal tabular-nums shrink-0">
                                {readableTime(c.time)}
                              </span>
                            </div>
                            <p className="text-[12px] font-sans text-dim leading-relaxed line-clamp-2" dir="auto">
                              “{c.quote}”
                            </p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {busy && (
                  <div className="flex items-center gap-2.5 px-3.5 py-3 bubble-ai">
                    <span className="dot dot-work" />
                    <span className="tc">{t("reading")}</span>
                  </div>
                )}

                <div ref={end} />
              </div>

              <div className="p-3 border-t border-rule shrink-0">
                <div className="flex gap-2">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && ask(q)}
                    placeholder={t("placeholder")}
                    dir="auto"
                    disabled={busy}
                    className="flex-1 h-10 px-3 text-[14px] font-sans disabled:opacity-50"
                  />
                  <button
                    onClick={() => ask(q)}
                    disabled={!q.trim() || busy}
                    aria-label={t("send")}
                    className={clsx(
                      "w-10 h-10 rounded flex items-center justify-center transition-colors shrink-0 no-min",
                      q.trim() && !busy
                        ? "bg-paper text-void hover:bg-white"
                        : "border border-rule text-dim-2 cursor-not-allowed"
                    )}
                  >
                    <Send size={14} className="rtl:-scale-x-100" />
                  </button>
                </div>
                <PriceTag what="libraryAnswer" className="mt-2" />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
