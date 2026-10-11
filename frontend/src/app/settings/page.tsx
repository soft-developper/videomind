"use client";
// vm_settings: the signed in wallet's settings. Sign in and sessions,
// defaults for new uploads, the YouTube connection, and Delete my data.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Copy, Check } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { useAuth, useSessionWallet } from "@/components/layout/AuthProvider";
import { CATEGORIES } from "@/lib/categories";
import {
  getMySettings, saveMySettings, logoutEverywhere, deleteMyData,
  getYouTubeStatus, connectYouTube, disconnectYouTube, ApiError,
} from "@/lib/api";

const fail = (x: unknown) => (x instanceof ApiError ? x.message : "That did not work. Try again.");
const day = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function Section({ title, hint, children, danger }: { title: string; hint?: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`panel p-5 sm:p-6 space-y-4 ${danger ? "border-error/40" : ""}`} aria-label={title}>
      <div>
        <h2 className={`font-display text-[17px] ${danger ? "text-error" : "text-paper"}`}>{title}</h2>
        {hint && <p className="text-[13.5px] text-dim mt-1 leading-relaxed max-w-[68ch]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const YT_NOTE: Record<string, [boolean, string]> = {
  connected: [true, "Your YouTube channel is connected."],
  denied: [false, "YouTube was not connected because access was not allowed."],
  scope: [false, "YouTube was not connected because uploading was not allowed."],
  expired: [false, "The connection took too long. Try again."],
  error: [false, "YouTube could not be connected. While VideoMind's Google app is in testing, only accounts added as test users can connect."],
};

export default function SettingsPage() {
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["my-settings", wallet ?? null], queryFn: getMySettings, enabled: !!wallet });
  const yt = useQuery({ queryKey: ["youtube-status"], queryFn: getYouTubeStatus, enabled: !!wallet });

  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [ytNote, setYtNote] = useState<[boolean, string] | null>(null);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const r = url.searchParams.get("youtube");
    if (!r) return;
    setYtNote(YT_NOTE[r] ?? YT_NOTE.error);
    url.searchParams.delete("youtube");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  const setDefault = async (field: "uploadVisibility" | "uploadCategory", value: string) => {
    setErr((e) => ({ ...e, defaults: "" })); setSaved(null);
    try {
      const r = await saveMySettings({ [field]: value || null });
      qc.setQueryData(["my-settings", wallet ?? null], (cur: any) => (cur ? { ...cur, settings: r.settings } : cur));
      qc.invalidateQueries({ queryKey: ["my-settings"] });
      setSaved("Saved. New uploads start with these.");
    } catch (x) { setErr((e) => ({ ...e, defaults: fail(x) })); }
  };

  const everywhere = async () => {
    if (!window.confirm("Sign out on every device and browser, this one included?")) return;
    try { await logoutEverywhere(); await signOut(); }
    catch (x) { setErr((e) => ({ ...e, account: fail(x) })); }
  };

  const ytConnect = async () => {
    try { const { url } = await connectYouTube("/settings"); window.location.assign(url); }
    catch (x) { setErr((e) => ({ ...e, youtube: fail(x) })); }
  };
  const ytDisconnect = async () => {
    if (!window.confirm("Disconnect YouTube? Videos already on your channel stay there.")) return;
    try { await disconnectYouTube(); setYtNote(null); await qc.invalidateQueries({ queryKey: ["youtube-status"] }); }
    catch (x) { setErr((e) => ({ ...e, youtube: fail(x) })); }
  };

  const removeAll = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (typed !== "DELETE") return;
    setDeleting(true); setErr((e) => ({ ...e, delete: "" }));
    try {
      await deleteMyData();
      qc.clear();
      await signOut().catch(() => {});
      setGone(true);
    } catch (x) { setErr((e) => ({ ...e, delete: fail(x) })); }
    finally { setDeleting(false); }
  };

  if (gone) {
    return (
      <AppShell>
        <PageHeader title="Settings" />
        <div className="section pb-16">
          <EmptyState title="Your data has been deleted" action={<Link href="/" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Go to the home page</Link>}>
            Your videos, notes, profile, live events and connections are gone from VideoMind, and you are signed out. You can sign in again at any time and start empty.
          </EmptyState>
        </div>
      </AppShell>
    );
  }

  const s = me.data?.settings;
  const field = "h-9 px-2.5 text-[13.5px] w-full max-w-[320px]";
  return (
    <AppShell>
      <PageHeader title="Settings" description="Your sign in, the defaults for new uploads, your YouTube connection, and your data." />
      <div className="section pb-16">
        {!connected && (
          <EmptyState title="Connect a wallet to see your settings" action={<WalletButton />}>Your settings belong to your wallet.</EmptyState>
        )}
        {connected && !wallet && (
          <EmptyState title="Sign in to see your settings">Your wallet is connected. One signature proves it is yours. The prompt is at the bottom of the page.</EmptyState>
        )}
        {wallet && !me.data && <p className="text-[14px] text-dim">Loading</p>}

        {wallet && me.data && (
          <div className="space-y-5 max-w-[860px]">
            <Section title="Wallet and sign in">
              <div className="space-y-1">
                <p className="text-[12.5px] text-dim">Signed in as</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="tc text-paper-2 break-all" data-settings-wallet>{me.data.wallet}</span>
                  <button onClick={() => { navigator.clipboard.writeText(me.data!.wallet).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }} aria-label="Copy the wallet address" className="w-8 h-8 inline-flex items-center justify-center rounded text-dim hover:text-paper hover:bg-slate-2 no-min">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <p className="text-[13px] text-dim" data-settings-sessions>
                  Signed in on {me.data.activeSessions} {me.data.activeSessions === 1 ? "device or browser" : "devices or browsers"}. This sign in lasts until {day(me.data.sessionExpiresAt)}.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void signOut()} className="btn btn-ghost h-9 px-3.5">Sign out here</button>
                <button onClick={() => void everywhere()} className="btn btn-ghost h-9 px-3.5">Sign out everywhere</button>
                <Link href="/profile" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Edit your public profile</Link>
              </div>
              {err.account && <p className="text-[13px] text-error" role="alert">{err.account}</p>}
            </Section>

            <Section title="New uploads" hint="What a new upload starts with. You can still change it for each video. Remember my last choice uses what you picked on your last upload in this browser.">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="set-visibility" className="block text-[12.5px] text-dim mb-1">Who can see it</label>
                  <select id="set-visibility" value={s?.uploadVisibility ?? ""} onChange={(e) => void setDefault("uploadVisibility", e.target.value)} className={field}>
                    <option value="">Remember my last choice</option>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="set-category" className="block text-[12.5px] text-dim mb-1">Category</label>
                  <select id="set-category" value={s?.uploadCategory ?? ""} onChange={(e) => void setDefault("uploadCategory", e.target.value)} className={field}>
                    <option value="">Remember my last choice</option>
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              {saved && <p className="text-[13px] text-paper-2" role="status">{saved}</p>}
              {err.defaults && <p className="text-[13px] text-error" role="alert">{err.defaults}</p>}
            </Section>

            {yt.data?.enabled && (
              <Section title="YouTube" hint="VideoMind only asks for permission to upload to your channel. Publishing happens from each video's page.">
                {ytNote && <p className={`text-[13.5px] ${ytNote[0] ? "text-paper-2" : "text-error"}`} role="status">{ytNote[1]}</p>}
                {yt.data.connected ? (
                  <div className="flex items-center gap-3 flex-wrap text-[13.5px]">
                    <span className="text-paper-2" data-settings-youtube>Connected{yt.data.email ? ` as ${yt.data.email}` : ""}</span>
                    <button onClick={() => void ytDisconnect()} className="btn btn-ghost h-9 px-3.5">Disconnect</button>
                    <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer" className="text-dim hover:text-paper underline underline-offset-2">Google account access</a>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button onClick={() => void ytConnect()} className="btn btn-signal h-9 px-4">Connect YouTube</button>
                    <p className="text-[12.5px] text-dim">
                      By connecting, you agree to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-paper-2">YouTube Terms of Service</a> and VideoMind&rsquo;s <a href="/legal/privacy#google" className="underline underline-offset-2 text-paper-2">Privacy Policy</a>.
                    </p>
                  </div>
                )}
                {err.youtube && <p className="text-[13px] text-error" role="alert">{err.youtube}</p>}
              </Section>
            )}

            <Section title="Your data" hint="How VideoMind handles your information is in the Privacy Policy.">
              <div className="flex gap-4 flex-wrap text-[13.5px]">
                <Link href="/legal/privacy" className="text-paper-2 hover:text-paper underline underline-offset-2">Privacy Policy</Link>
                <Link href="/legal/terms" className="text-paper-2 hover:text-paper underline underline-offset-2">Terms of Service</Link>
              </div>
            </Section>

            <Section title="Delete my data" danger hint="This deletes, at once and for good, everything VideoMind holds about this wallet.">
              <ul className="list-disc pl-5 space-y-1 text-[13.5px] text-paper-2 marker:text-dim">
                <li>Deleted: your videos and their files, transcripts, chapters and clips; your collections; your notes and watch places; your profile and settings; your live events with their captions and chat, and your messages in other chats; your YouTube connection (revoked at Google); your sign in.</li>
                <li>Not deleted: copies you stored on Shelby (public on a network VideoMind cannot change) and videos you published to YouTube (remove them in YouTube Studio). Usage amounts, without any content, are kept as business records.</li>
              </ul>
              <form onSubmit={removeAll} className="space-y-2" aria-label="Delete my data">
                <label htmlFor="del-confirm" className="block text-[13px] text-paper">Type DELETE to confirm</label>
                <div className="flex gap-2 flex-wrap">
                  <input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="h-9 px-2.5 text-[13.5px] w-[180px] tc" />
                  <button type="submit" disabled={typed !== "DELETE" || deleting} className="btn h-9 px-4 bg-error text-white disabled:opacity-50">{deleting ? "Deleting" : "Delete my data"}</button>
                </div>
              </form>
              {err.delete && <p className="text-[13px] text-error" role="alert">{err.delete}</p>}
            </Section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
