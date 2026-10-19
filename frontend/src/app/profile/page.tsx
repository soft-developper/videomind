"use client";
// vm_profile: the signed in wallet's name and bio, shown on its public page.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { getMyProfile, saveMyProfile, ApiError } from "@/lib/api";
// vm_lang
import { useTranslations } from "next-intl";

const NAME_MAX = 60;
const BIO_MAX = 500;

export default function ProfilePage() {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["my-profile", wallet ?? null], queryFn: getMyProfile, enabled: !!wallet });
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data) { setName(data.name ?? ""); setBio(data.bio ?? ""); } }, [data]);

  const changed = !!data && (name.trim() !== (data.name ?? "") || bio.trim() !== (data.bio ?? ""));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const p = await saveMyProfile({ name: name.trim() || null, bio: bio.trim() || null });
      qc.setQueryData(["my-profile", wallet ?? null], p);
      qc.invalidateQueries({ queryKey: ["public-profile"] });
      setMsg({ ok: true, text: t("saved") });
    } catch (err: any) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : t("notSaved") });
    } finally { setBusy(false); }
  };

  return (
    <AppShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={wallet ? <Link href={`/u/${wallet}`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("viewPublic")}</Link> : undefined}
      />
      <div className="section pb-16">
        {!connected && (
          <EmptyState title={t("connect")} action={<WalletButton />}>
            {t("connectBody")}
          </EmptyState>
        )}
        {connected && !wallet && (
          <EmptyState title={t("signIn")}>
            {t("signInBody")}
          </EmptyState>
        )}
        {wallet && isLoading && <p className="text-[14px] text-dim">{tc("loading")}</p>}
        {wallet && data && (
          <form onSubmit={save} className="max-w-[560px] space-y-5">
            <div>
              <label htmlFor="profile-name" className="block text-[13px] font-medium text-paper mb-1.5">{t("name")}</label>
              <input
                id="profile-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                autoComplete="name"
                dir="auto"
                className="w-full h-10 px-3 text-[14px]"
              />
              <p className="text-[12.5px] text-dim mt-1.5">{t("nameHint")}</p>
            </div>
            <div>
              <label htmlFor="profile-bio" className="block text-[13px] font-medium text-paper mb-1.5">{t("bio")}</label>
              <textarea
                id="profile-bio"
                value={bio}
                rows={4}
                maxLength={BIO_MAX}
                onChange={(e) => setBio(e.target.value)}
                placeholder={t("bioPlaceholder")}
                dir="auto"
                className="w-full px-3 py-2 text-[14px] leading-relaxed resize-y"
              />
              <p className="tc mt-1 text-end">{bio.length} / {BIO_MAX}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="submit" disabled={busy || !changed} className="btn btn-signal h-9 px-4">{busy ? tc("saving") : tc("save")}</button>
              {msg && <p role="status" className={msg.ok ? "text-[13px] text-paper-2" : "text-[13px] text-error"}>{msg.text}</p>}
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}
