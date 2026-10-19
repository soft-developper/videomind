"use client";
// vm_live: the signed in wallet's live events, and a new one.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { getMyLiveEvents, createLiveEvent, ApiError } from "@/lib/api";
// vm_lang
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

export function LiveList() {
  const t = useTranslations("live");
  const tc = useTranslations("common");
  const f = useFormat();
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["my-live", wallet ?? null], queryFn: getMyLiveEvents, enabled: !!wallet });
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!connected) return <EmptyState title={t("connect")} action={<WalletButton />}>{t("connectBody")}</EmptyState>;
  if (!wallet) return <EmptyState title={t("signIn")}>{t("signInBody")}</EmptyState>;
  if (isLoading || !data) return <p className="text-[14px] text-dim">{tc("loading")}</p>;
  if (!data.enabled) {
    return (
      <EmptyState title={t("off")}>
        {t("offBody")}
      </EmptyState>
    );
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await createLiveEvent(title); router.push(`/live/${r.event.id}/studio`); }
    catch (x: any) { setErr(x instanceof ApiError ? x.message : t("createFailed")); setBusy(false); }
  };

  return (
    <div className="max-w-[860px] space-y-8">
      <form onSubmit={create} className="flex items-end gap-2 flex-wrap" aria-label={t("createLabel")}>
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="live-title" className="block text-[13px] font-medium text-paper mb-1.5">{t("new")}</label>
          <input id="live-title" dir="auto" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t("newPlaceholder")} className="w-full h-10 px-3 text-[14px]" />
        </div>
        <button type="submit" disabled={busy || !title.trim()} className="btn btn-signal h-10 px-4">{busy ? t("creating") : t("create")}</button>
        {err && <p className="w-full text-[13px] text-error" role="alert">{err}</p>}
      </form>

      {data.events.length > 0 && (
        <ul className="border-t border-rule" aria-label={t("yours")}>
          {data.events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-3 border-b border-rule">
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] text-paper truncate" dir="auto">{e.title}</span>
                <span className="tc block mt-0.5">
                  {t("rowLine", { status: t(`status.${e.status}`), when: f.date(e.startedAt ?? e.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
                  {e.peakViewers ? t("upTo", { count: e.peakViewers }) : ""}
                </span>
              </span>
              {e.status !== "ended"
                ? <Link href={`/live/${e.id}/studio`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("openStudio")}</Link>
                : e.videoId
                  ? <Link href={`/video/${e.videoId}`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("recording")}</Link>
                  : <Link href={`/live/${e.id}/studio`} className="text-[13px] text-paper-2 underline underline-offset-2 no-min">{t("details")}</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
