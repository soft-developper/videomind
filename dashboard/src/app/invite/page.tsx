"use client";
// vm_admin_settings: accepting an invitation, opened from the emailed link.
// Like the first setup: add VideoMind to an authenticator app, choose a
// password, check a code, then save the recovery codes shown once.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard, Field, Note, inputCls } from "@/components/AuthCard";
import { PasswordFields, passwordIssue } from "@/components/PasswordFields";
import { AuthenticatorKey, RecoveryCodes } from "@/components/AccountParts";
import { ApiError, inviteComplete, inviteStart, takeToken } from "@/lib/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");

export default function InvitePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ email: string; secret: string; uri: string; by: string | null } | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [pw, setPw] = useState(""); const [again, setAgain] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    const t = takeToken();
    if (!t) { setGone("This page needs the link from the invitation email."); return; }
    setToken(t);
    inviteStart(t).then(setInfo, (e) => setGone(msg(e)));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const issue = passwordIssue(pw, again); if (issue) { setErr(issue); return; }
    setBusy(true); setErr(null);
    try { const r = await inviteComplete(token!, pw, code); setCodes(r.recoveryCodes); setPw(""); setAgain(""); }
    catch (x) { if (x instanceof ApiError && (x.code === "link_expired" || x.code === "already_admin")) setGone(x.message); else setErr(msg(x)); }
    finally { setBusy(false); }
  };

  if (codes) {
    return (
      <AuthCard wide title="Save your recovery codes" intro="If you lose your phone, each of these codes signs you in once instead of the authenticator code. They are shown only now. Keep them in a password manager or print them.">
        <RecoveryCodes codes={codes} email={info?.email ?? ""} onDone={() => router.replace("/")} doneLabel="Go to the dashboard" />
      </AuthCard>
    );
  }
  if (gone) {
    return (
      <AuthCard title="Join the dashboard">
        <div className="space-y-4">
          <Note kind="error">{gone}</Note>
          <Link href="/login" className="btn btn-ghost h-10 px-4 w-full inline-flex items-center justify-center">Go to sign in</Link>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard wide title="Join the dashboard" intro={info ? <>{info.by ? <>{info.by} invited you. </> : null}Your administrator account will be <span className="text-paper-2">{info.email}</span>.</> : "Checking the link."}>
      {info && (
        <form onSubmit={submit} className="space-y-7">
          <section className="space-y-3" aria-label="Authenticator app">
            <h2 className="text-[14px] font-semibold text-paper">1. Add VideoMind to your authenticator app</h2>
            <p className="text-[13px] text-dim leading-relaxed">Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar), add an account and scan this code. On this phone already? Copy the key instead.</p>
            <AuthenticatorKey secret={info.secret} uri={info.uri} />
          </section>
          <section className="space-y-4" aria-label="Password">
            <h2 className="text-[14px] font-semibold text-paper">2. Choose a password</h2>
            <PasswordFields pw={pw} again={again} setPw={setPw} setAgain={setAgain} />
          </section>
          <section className="space-y-3" aria-label="Check the code">
            <h2 className="text-[14px] font-semibold text-paper">3. Enter the code the app shows</h2>
            <Field label="6 digit code"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} tracking-[0.3em] tabular-nums max-w-[200px]`} required /></Field>
          </section>
          {err && <Note kind="error">{err}</Note>}
          <button type="submit" disabled={busy} className="btn btn-signal h-10 px-4 w-full">{busy ? "Setting up" : "Join the dashboard"}</button>
        </form>
      )}
    </AuthCard>
  );
}
