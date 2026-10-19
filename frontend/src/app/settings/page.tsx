"use client";
// vm_settings: the signed in wallet's settings. Sign in and sessions,
// defaults for new uploads, the YouTube connection, and Delete my data.
// vm_lang: the interface language (while languages are on), and every
// line in the reader's language.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useLocale, useTranslations, type Messages } from "next-intl";
import { Copy, Check } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { LanguagePicker } from "@/components/layout/LanguagePicker";
import { useAuth, useSessionWallet } from "@/components/layout/AuthProvider";
import { CATEGORIES } from "@/lib/categories";
import { LANGUAGES_ON, intlLocale, type Locale } from "@/i18n/config";
import {
  getMySettings, saveMySettings, logoutEverywhere, deleteMyData,
  getYouTubeStatus, connectYouTube, disconnectYouTube, ApiError,
} from "@/lib/api";

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

type CategoryId = keyof Messages["common"]["category"];
const YT_NOTES = ["connected", "denied", "scope", "expired", "error"] as const;
type YtNote = (typeof YT_NOTES)[number];

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const { connected } = useWallet();
  const wallet = useSessionWallet();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["my-settings", wallet ?? null], queryFn: getMySettings, enabled: !!wallet });
  const yt = useQuery({ queryKey: ["youtube-status"], queryFn: getYouTubeStatus, enabled: !!wallet });

  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [ytNote, setYtNote] = useState<YtNote | null>(null);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [gone, setGone] = useState(false);

  // The server's own messages are English for now; translated with the rest of the workspace (15b).
  const fail = (x: unknown) => (x instanceof ApiError ? x.message : tc("didNotWork"));
  const day = (ms: number) => new Date(ms).toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });

  useEffect(() => {
    const url = new URL(window.location.href);
    const r = url.searchParams.get("youtube");
    if (!r) return;
    setYtNote((YT_NOTES as readonly string[]).includes(r) ? (r as YtNote) : "error");
    url.searchParams.delete("youtube");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  const setDefault = async (field: "uploadVisibility" | "uploadCategory", value: string) => {
    setErr((e) => ({ ...e, defaults: "" })); setSaved(false);
    try {
      const r = await saveMySettings({ [field]: value || null });
      qc.setQueryData(["my-settings", wallet ?? null], (cur: any) => (cur ? { ...cur, settings: r.settings } : cur));
      qc.invalidateQueries({ queryKey: ["my-settings"] });
      setSaved(true);
    } catch (x) { setErr((e) => ({ ...e, defaults: fail(x) })); }
  };

  const everywhere = async () => {
    if (!window.confirm(t("everywhereConfirm"))) return;
    try { await logoutEverywhere(); await signOut(); }
    catch (x) { setErr((e) => ({ ...e, account: fail(x) })); }
  };

  const ytConnect = async () => {
    try { const { url } = await connectYouTube("/settings"); window.location.assign(url); }
    catch (x) { setErr((e) => ({ ...e, youtube: fail(x) })); }
  };
  const ytDisconnect = async () => {
    if (!window.confirm(t("youtubeDisconnectConfirm"))) return;
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
        <PageHeader title={t("title")} />
        <div className="section pb-16">
          <EmptyState title={t("deletedTitle")} action={<Link href="/" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("goHome")}</Link>}>
            {t("deletedBody")}
          </EmptyState>
        </div>
      </AppShell>
    );
  }

  const s = me.data?.settings;
  const field = "h-9 px-2.5 text-[13.5px] w-full max-w-[320px]";
  const link = (href: string, external = false) => (chunks: React.ReactNode) =>
    external
      ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-paper-2">{chunks}</a>
      : <a href={href} className="underline underline-offset-2 text-paper-2">{chunks}</a>;

  return (
    <AppShell>
      <PageHeader title={t("title")} description={t(LANGUAGES_ON ? "descriptionLanguages" : "description")} />
      <div className="section pb-16">
        {/* vm_lang: the language can be picked before connecting a wallet */}
        {LANGUAGES_ON && !wallet && (
          <div className="max-w-[860px] mb-5">
            <Section title={t("languageTitle")} hint={t("languageHintSignedOut")}>
              <div>
                <label htmlFor="set-language" className="block text-[12.5px] text-dim mb-1">{t("languageLabel")}</label>
                <LanguagePicker id="set-language" />
              </div>
            </Section>
          </div>
        )}
        {!connected && (
          <EmptyState title={t("connectTitle")} action={<WalletButton />}>{t("connectBody")}</EmptyState>
        )}
        {connected && !wallet && (
          <EmptyState title={t("signInTitle")}>{t("signInBody")}</EmptyState>
        )}
        {wallet && !me.data && <p className="text-[14px] text-dim">{tc("loading")}</p>}

        {wallet && me.data && (
          <div className="space-y-5 max-w-[860px]">
            {LANGUAGES_ON && (
              <Section title={t("languageTitle")} hint={t("languageHint")}>
                <div>
                  <label htmlFor="set-language" className="block text-[12.5px] text-dim mb-1">{t("languageLabel")}</label>
                  <LanguagePicker id="set-language" />
                </div>
              </Section>
            )}

            <Section title={t("walletTitle")}>
              <div className="space-y-1">
                <p className="text-[12.5px] text-dim">{t("signedInAs")}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="tc text-paper-2 break-all" data-settings-wallet>{me.data.wallet}</span>
                  <button onClick={() => { navigator.clipboard.writeText(me.data!.wallet).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }} aria-label={t("copyWallet")} className="w-8 h-8 inline-flex items-center justify-center rounded text-dim hover:text-paper hover:bg-slate-2 no-min">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <p className="text-[13px] text-dim" data-settings-sessions>
                  {t("sessions", { count: me.data.activeSessions, until: day(me.data.sessionExpiresAt) })}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => void signOut()} className="btn btn-ghost h-9 px-3.5">{t("signOutHere")}</button>
                <button onClick={() => void everywhere()} className="btn btn-ghost h-9 px-3.5">{t("signOutEverywhere")}</button>
                <Link href="/profile" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">{t("editProfile")}</Link>
              </div>
              {err.account && <p className="text-[13px] text-error" role="alert">{err.account}</p>}
            </Section>

            <Section title={t("uploadsTitle")} hint={t("uploadsHint")}>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="set-visibility" className="block text-[12.5px] text-dim mb-1">{t("visibilityLabel")}</label>
                  <select id="set-visibility" value={s?.uploadVisibility ?? ""} onChange={(e) => void setDefault("uploadVisibility", e.target.value)} className={field}>
                    <option value="">{t("rememberLast")}</option>
                    <option value="private">{t("private")}</option>
                    <option value="unlisted">{t("unlisted")}</option>
                    <option value="public">{t("public")}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="set-category" className="block text-[12.5px] text-dim mb-1">{t("categoryLabel")}</label>
                  <select id="set-category" value={s?.uploadCategory ?? ""} onChange={(e) => void setDefault("uploadCategory", e.target.value)} className={field}>
                    <option value="">{t("rememberLast")}</option>
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{tc(`category.${c.id as CategoryId}`)}</option>)}
                  </select>
                </div>
              </div>
              {saved && <p className="text-[13px] text-paper-2" role="status">{t("uploadsSaved")}</p>}
              {err.defaults && <p className="text-[13px] text-error" role="alert">{err.defaults}</p>}
            </Section>

            {yt.data?.enabled && (
              <Section title={t("youtubeTitle")} hint={t("youtubeHint")}>
                {ytNote && <p className={`text-[13.5px] ${ytNote === "connected" ? "text-paper-2" : "text-error"}`} role="status">{t(`youtubeNote.${ytNote}`)}</p>}
                {yt.data.connected ? (
                  <div className="flex items-center gap-3 flex-wrap text-[13.5px]">
                    <span className="text-paper-2" data-settings-youtube>
                      {yt.data.email ? t("youtubeConnectedAs", { email: yt.data.email }) : t("youtubeConnected")}
                    </span>
                    <button onClick={() => void ytDisconnect()} className="btn btn-ghost h-9 px-3.5">{t("youtubeDisconnect")}</button>
                    <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer" className="text-dim hover:text-paper underline underline-offset-2">{t("googleAccess")}</a>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button onClick={() => void ytConnect()} className="btn btn-signal h-9 px-4">{t("youtubeConnect")}</button>
                    <p className="text-[12.5px] text-dim">
                      {t.rich("youtubeConsent", {
                        yt: link("https://www.youtube.com/t/terms", true),
                        privacy: link("/legal/privacy#google"),
                      })}
                    </p>
                  </div>
                )}
                {err.youtube && <p className="text-[13px] text-error" role="alert">{err.youtube}</p>}
              </Section>
            )}

            <Section title={t("dataTitle")} hint={t("dataHint")}>
              <div className="flex gap-4 flex-wrap text-[13.5px]">
                <Link href="/legal/privacy" className="text-paper-2 hover:text-paper underline underline-offset-2">{t("privacyPolicy")}</Link>
                <Link href="/legal/terms" className="text-paper-2 hover:text-paper underline underline-offset-2">{t("termsOfService")}</Link>
              </div>
            </Section>

            <Section title={t("deleteTitle")} danger hint={t("deleteHint")}>
              <ul className="list-disc ps-5 space-y-1 text-[13.5px] text-paper-2 marker:text-dim">
                <li>{t("deleteWhat")}</li>
                <li>{t("deleteKept")}</li>
              </ul>
              <form onSubmit={removeAll} className="space-y-2" aria-label={t("deleteTitle")}>
                {/* DELETE stays in English in every language: it is what the server checks. */}
                <label htmlFor="del-confirm" className="block text-[13px] text-paper">{t("deleteTypeLabel")}</label>
                <div className="flex gap-2 flex-wrap">
                  <input id="del-confirm" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="h-9 px-2.5 text-[13.5px] w-[180px] tc" />
                  <button type="submit" disabled={typed !== "DELETE" || deleting} className="btn h-9 px-4 bg-error text-white disabled:opacity-50">{deleting ? t("deleting") : t("deleteButton")}</button>
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
