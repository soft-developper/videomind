"use client";
// vm_admin: sign in. Step one is the email and password, step two the code
// from the authenticator app (or a recovery code). While no admin exists,
// this page offers to email the setup link to the server's ADMIN_EMAIL.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard, Field, Note, inputCls } from "@/components/AuthCard";
import { ApiError, getMe, getStatus, login, loginCode, sendSetupLink, type Status } from "@/lib/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");

export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    getMe().then(() => router.replace("/"), () => {});
    getStatus().then(setStatus, (e) => setErr(msg(e)));
  }, [router]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setInfo(null);
    try { await login(email, password); setPassword(""); setStep("code"); }
    catch (x) { setErr(msg(x)); }
    finally { setBusy(false); }
  };
  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await loginCode(code);
      router.replace(r.usedRecoveryCode ? "/?recovery=1" : "/");
    } catch (x) {
      if (x instanceof ApiError && x.code === "mfa_expired") { setStep("password"); setCode(""); }
      setErr(msg(x));
    } finally { setBusy(false); }
  };
  const askSetup = async () => {
    setBusy(true); setErr(null);
    try { await sendSetupLink(); setInfo("The setup link is on its way to the administrator email set on the server. It works once and expires in 1 hour."); }
    catch (x) { setErr(msg(x)); }
    finally { setBusy(false); }
  };

  if (status && !status.setUp) {
    return (
      <AuthCard title="Set up the dashboard" intro="No administrator account exists yet. The setup link is emailed to the address set as ADMIN_EMAIL on the server, and only to it.">
        <div className="space-y-4">
          {!status.ready && status.missing && (
            <Note kind="error">The server is missing these settings: {status.missing.join(", ")}. Add them on Render, then reload this page.</Note>
          )}
          {info && <Note kind="ok">{info}</Note>}
          {err && <Note kind="error">{err}</Note>}
          <button onClick={askSetup} disabled={busy || !status.ready || !!info} className="btn btn-signal h-10 px-4 w-full">Email me the setup link</button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={step === "password" ? "Sign in" : "Two step verification"}
      intro={step === "password" ? "The VideoMind admin dashboard." : recovery ? "Enter one of your recovery codes. Each one works once." : "Enter the 6 digit code from your authenticator app."}
    >
      {step === "password" ? (
        <form onSubmit={submitPassword} className="space-y-4">
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} required autoFocus /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} maxLength={256} required /></Field>
          {err && <Note kind="error">{err}</Note>}
          <button type="submit" disabled={busy || !status} className="btn btn-signal h-10 px-4 w-full">{busy ? "Checking" : "Continue"}</button>
          <p className="text-[13px] text-dim"><Link href="/forgot" className="underline hover:text-paper">Forgot password?</Link></p>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-4">
          {recovery ? (
            <Field label="Recovery code"><input autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} placeholder="abcde fghij" required autoFocus /></Field>
          ) : (
            <Field label="Code"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} tracking-[0.3em] tabular-nums`} required autoFocus /></Field>
          )}
          {err && <Note kind="error">{err}</Note>}
          <button type="submit" disabled={busy} className="btn btn-signal h-10 px-4 w-full">{busy ? "Checking" : "Sign in"}</button>
          <div className="flex justify-between gap-3 text-[13px] text-dim">
            <button type="button" onClick={() => { setRecovery(!recovery); setCode(""); setErr(null); }} className="underline hover:text-paper no-min">{recovery ? "Use the app code instead" : "Use a recovery code"}</button>
            <button type="button" onClick={() => { setStep("password"); setCode(""); setErr(null); }} className="underline hover:text-paper no-min">Start again</button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
