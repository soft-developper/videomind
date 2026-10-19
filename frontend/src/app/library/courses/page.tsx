"use client";
// vm_info: Courses. A course is a collection of videos, such as the
// lectures of one class. Collections are made here or while uploading.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { WalletButton } from "@/components/layout/WalletButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { getCollections, createCollection, renameCollection, deleteCollection, type Collection } from "@/lib/api";
// vm_lang
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

function Row({ c, onChanged }: { c: Collection; onChanged: () => void }) {
  const t = useTranslations("courses");
  const tc = useTranslations("common");
  const tl = useTranslations("library");
  const fmt = useFormat();
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(c.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); setMode("view"); onChanged(); }
    catch (e: any) { setErr(e?.message ?? tc("didNotWork")); }
    finally { setBusy(false); }
  };
  const facts = [tl("videoCount", { count: c.videoCount }), c.totalSeconds >= 60 ? fmt.length(c.totalSeconds) : null].filter(Boolean).join(", ");

  return (
    <li className="border-b border-rule">
      {mode === "view" && (
        <div className="flex items-center gap-2">
          <Link href={`/library/courses/${c.id}`} className="group flex-1 min-w-0 flex items-center gap-3 py-3.5 pr-2">
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block text-[14.5px] font-medium text-paper truncate">{c.name}</span>
              <span className="tc block mt-0.5">{facts}</span>
            </span>
            <ChevronRight size={15} className="rtl:rotate-180 text-dim-2 group-hover:text-paper-2 transition-colors shrink-0" />
          </Link>
          <button onClick={() => { setName(c.name); setErr(null); setMode("rename"); }} aria-label={t("renameNamed", { name: c.name })}
            className="w-8 h-8 flex items-center justify-center rounded text-dim hover:text-paper hover:bg-slate transition-colors">
            <Pencil size={13} />
          </button>
          <button onClick={() => { setErr(null); setMode("delete"); }} aria-label={t("deleteNamed", { name: c.name })}
            className="w-8 h-8 flex items-center justify-center rounded text-dim hover:text-error hover:bg-slate transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {mode === "rename" && (
        <form
          className="py-3 flex items-center gap-2 flex-wrap"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) void act(() => renameCollection(c.id, name.trim())); }}
        >
          <label htmlFor={`rename-${c.id}`} className="sr-only">{t("newNameFor", { name: c.name })}</label>
          <input id={`rename-${c.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus
            className="h-9 flex-1 min-w-[200px] px-3 text-[14px]" />
          <button type="submit" disabled={busy || !name.trim()} className="btn btn-signal h-9 px-3.5">{busy ? tc("saving") : tc("save")}</button>
          <button type="button" onClick={() => setMode("view")} className="btn btn-ghost h-9 px-3.5">{tc("cancel")}</button>
          {err && <p role="alert" className="w-full text-[13px] text-error">{err}</p>}
        </form>
      )}

      {mode === "delete" && (
        <div role="alertdialog" aria-label={t("deleteNamed", { name: c.name })} className="py-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <p className="text-[14px] font-medium text-paper">{t("deleteTitle", { name: c.name })}</p>
            <p className="text-[13px] text-dim mt-0.5">
              {c.videoCount === 0 ? t("deleteEmpty") : t("deleteKeeps", { count: c.videoCount })}
            </p>
            {err && <p role="alert" className="text-[13px] text-error mt-1">{err}</p>}
          </div>
          <button onClick={() => void act(() => deleteCollection(c.id))} disabled={busy}
            className="h-9 px-3.5 rounded text-[13.5px] font-medium bg-error/15 border border-error/50 text-error hover:bg-error/25 transition-colors disabled:opacity-50">
            {busy ? tc("deleting") : tc("delete")}
          </button>
          <button onClick={() => setMode("view")} className="btn btn-ghost h-9 px-3.5">{tc("cancel")}</button>
        </div>
      )}
    </li>
  );
}

export default function Courses() {
  const t = useTranslations("courses");
  const tc = useTranslations("common");
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["collections", wallet],
    queryFn: getCollections,
    enabled: !!wallet,
  });
  const list = data ?? [];
  const changed = () => { qc.invalidateQueries({ queryKey: ["collections"] }); qc.invalidateQueries({ queryKey: ["videos"] }); };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    try { await createCollection(name.trim()); setName(""); changed(); }
    catch (e: any) { setErr(e?.message ?? t("createFailed")); }
    finally { setBusy(false); }
  };

  const loaded = connected && !!wallet && !isLoading && !isError;

  return (
    <AppShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <section className="section pb-16">
        {!connected && (
          <EmptyState title={t("connectTitle")} action={<WalletButton />}>
            {t("connectBody")}
          </EmptyState>
        )}
        {connected && !wallet && (
          <EmptyState title={t("signInTitle")}>
            {t("signInBody")}
          </EmptyState>
        )}
        {connected && wallet && isLoading && <div className="h-24 max-w-[680px] scan rounded-lg" />}
        {connected && wallet && isError && (
          <EmptyState title={t("loadFailed")} action={<button onClick={() => refetch()} className="btn btn-ghost h-9 px-3.5">{tc("tryAgain")}</button>}>
            {(error as Error)?.message}
          </EmptyState>
        )}

        {loaded && (
          <div className="max-w-[680px]">
            <form onSubmit={create} className="flex items-center gap-2 flex-wrap">
              <label htmlFor="new-course" className="sr-only">{t("newLabel")}</label>
              <input
                id="new-course"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder={t("newPlaceholder")}
                className="h-9 flex-1 min-w-[220px] px-3 text-[14px]"
              />
              <button type="submit" disabled={!name.trim() || busy} className="btn btn-signal h-9 px-3.5">{busy ? t("creating") : t("create")}</button>
            </form>
            {err && <p role="alert" className="text-[13px] text-error mt-2">{err}</p>}

            {list.length === 0 ? (
              <EmptyState title={t("emptyTitle")}>
                {t("emptyBody")}
              </EmptyState>
            ) : (
              <ul className="mt-6 border-t border-rule">
                {list.map((c) => <Row key={c.id} c={c} onChanged={changed} />)}
              </ul>
            )}
          </div>
        )}
      </section>
    </AppShell>
  );
}
