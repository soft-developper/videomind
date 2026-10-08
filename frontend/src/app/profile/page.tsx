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

const NAME_MAX = 60;
const BIO_MAX = 500;

export default function ProfilePage() {
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
      setMsg({ ok: true, text: "Saved. Your public page shows it now." });
    } catch (err: any) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Your profile could not be saved. Try again." });
    } finally { setBusy(false); }
  };

  return (
    <AppShell>
      <PageHeader
        title="Profile"
        description="Your name and a short bio, shown on your public page next to your public videos and courses."
        actions={wallet ? <Link href={`/u/${wallet}`} className="btn btn-ghost h-9 px-3.5 inline-flex items-center">View your public page</Link> : undefined}
      />
      <div className="section pb-16">
        {!connected && (
          <EmptyState title="Connect a wallet to edit your profile" action={<WalletButton />}>
            Your profile belongs to your wallet.
          </EmptyState>
        )}
        {connected && !wallet && (
          <EmptyState title="Sign in to edit your profile">
            Your wallet is connected. One signature proves it is yours. The prompt is at the bottom of the page.
          </EmptyState>
        )}
        {wallet && isLoading && <p className="text-[14px] text-dim">Loading</p>}
        {wallet && data && (
          <form onSubmit={save} className="max-w-[560px] space-y-5">
            <div>
              <label htmlFor="profile-name" className="block text-[13px] font-medium text-paper mb-1.5">Name</label>
              <input
                id="profile-name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="How you want to be shown"
                autoComplete="name"
                className="w-full h-10 px-3 text-[14px]"
              />
              <p className="text-[12.5px] text-dim mt-1.5">Leave it empty to show your wallet address instead. Your address is always shown too.</p>
            </div>
            <div>
              <label htmlFor="profile-bio" className="block text-[13px] font-medium text-paper mb-1.5">Bio</label>
              <textarea
                id="profile-bio"
                value={bio}
                rows={4}
                maxLength={BIO_MAX}
                onChange={(e) => setBio(e.target.value)}
                placeholder="What you teach or talk about"
                className="w-full px-3 py-2 text-[14px] leading-relaxed resize-y"
              />
              <p className="tc mt-1 text-right">{bio.length} / {BIO_MAX}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="submit" disabled={busy || !changed} className="btn btn-signal h-9 px-4">{busy ? "Saving" : "Save"}</button>
              {msg && <p role="status" className={msg.ok ? "text-[13px] text-paper-2" : "text-[13px] text-error"}>{msg.text}</p>}
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}
