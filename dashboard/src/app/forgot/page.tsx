"use client";
// vm_admin: ask for a password reset link. The answer is the same whether
// or not the email has an account.
import Link from "next/link";
import { useState } from "react";
import { AuthCard, Field, Note, inputCls } from "@/components/AuthCard";
import { ApiError, forgot } from "@/lib/api";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setDone((await forgot(email)).message); }
    catch (x) { setErr(x instanceof ApiError ? x.message : "That did not work. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <AuthCard title="Reset your password" intro="We will email a link to choose a new password. You will also need your authenticator app or a recovery code.">
      {done ? (
        <div className="space-y-4">
          <Note kind="ok">{done}</Note>
          <p className="text-[13px] text-dim"><Link href="/login" className="underline hover:text-paper">Back to sign in</Link></p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} required autoFocus /></Field>
          {err && <Note kind="error">{err}</Note>}
          <button type="submit" disabled={busy} className="btn btn-signal h-10 px-4 w-full">Email me a link</button>
          <p className="text-[13px] text-dim"><Link href="/login" className="underline hover:text-paper">Back to sign in</Link></p>
        </form>
      )}
    </AuthCard>
  );
}
