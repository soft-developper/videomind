"use client";
// vm_admin: choose a new password from an emailed link. Needs a code from
// the authenticator app or a recovery code too, so the email alone is not enough.
import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthCard, Field, Note, inputCls } from "@/components/AuthCard";
import { PasswordFields, passwordIssue } from "@/components/PasswordFields";
import { ApiError, resetCheck, resetPassword, takeToken } from "@/lib/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");

export default function ResetPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [pw, setPw] = useState(""); const [again, setAgain] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = takeToken();
    if (!t) { setGone("This page needs the link from the email."); return; }
    setToken(t);
    resetCheck(t).then((r) => setEmail(r.email), (e) => setGone(msg(e)));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const issue = passwordIssue(pw, again); if (issue) { setErr(issue); return; }
    setBusy(true); setErr(null);
    try { await resetPassword(token!, pw, code); setDone(true); }
    catch (x) { if (x instanceof ApiError && x.code === "link_expired") setGone(x.message); else setErr(msg(x)); }
    finally { setBusy(false); }
  };

  if (done) return (
    <AuthCard title="Password changed">
      <div className="space-y-4">
        <Note kind="ok">Your password was changed and every session was signed out. An email confirms it.</Note>
        <Link href="/login" className="btn btn-signal h-10 px-4 w-full inline-flex items-center justify-center">Sign in</Link>
      </div>
    </AuthCard>
  );
  if (gone) return (
    <AuthCard title="Reset your password">
      <div className="space-y-4">
        <Note kind="error">{gone}</Note>
        <Link href="/forgot" className="btn btn-ghost h-10 px-4 w-full inline-flex items-center justify-center">Ask for a new link</Link>
      </div>
    </AuthCard>
  );
  return (
    <AuthCard title="Choose a new password" intro={email ? <>For <span className="text-paper-2">{email}</span>.</> : "Checking the link."}>
      {email && (
        <form onSubmit={submit} className="space-y-4">
          <PasswordFields pw={pw} again={again} setPw={setPw} setAgain={setAgain} />
          <Field label="Code from your authenticator app, or a recovery code">
            <input autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} required />
          </Field>
          {err && <Note kind="error">{err}</Note>}
          <button type="submit" disabled={busy} className="btn btn-signal h-10 px-4 w-full">{busy ? "Saving" : "Change password"}</button>
        </form>
      )}
    </AuthCard>
  );
}
