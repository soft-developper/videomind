"use client";
// vm_admin: the first setup, opened from the emailed link. Adds VideoMind
// to an authenticator app, sets the password, checks a code, then shows the
// recovery codes once.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Copy, Check, Download } from "lucide-react";
import { AuthCard, Field, Note, inputCls } from "@/components/AuthCard";
import { PasswordFields, passwordIssue } from "@/components/PasswordFields";
import { QrCode } from "@/components/QrCode";
import { ApiError, setupComplete, setupStart, takeToken } from "@/lib/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");
const groups = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }} className="btn btn-ghost h-8 px-2.5 inline-flex items-center gap-1.5 text-[12.5px] no-min" aria-label={label}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : "Copy"}
    </button>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ email: string; secret: string; uri: string } | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [pw, setPw] = useState(""); const [again, setAgain] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const t = takeToken();
    if (!t) { setGone("This page needs the link from the setup email."); return; }
    setToken(t);
    setupStart(t).then(setInfo, (e) => setGone(msg(e)));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const issue = passwordIssue(pw, again); if (issue) { setErr(issue); return; }
    setBusy(true); setErr(null);
    try { const r = await setupComplete(token!, pw, code); setCodes(r.recoveryCodes); setPw(""); setAgain(""); }
    catch (x) { if (x instanceof ApiError && (x.code === "link_expired" || x.code === "already_set_up")) setGone(x.message); else setErr(msg(x)); }
    finally { setBusy(false); }
  };

  if (codes) {
    const text = ["VideoMind dashboard recovery codes", info?.email ?? "", "Each code works once, in place of the authenticator code.", "", ...codes].join("\n");
    const download = () => {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const a = document.createElement("a"); a.href = url; a.download = "videomind-recovery-codes.txt"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
      <AuthCard wide title="Save your recovery codes" intro="If you lose your phone, each of these codes signs you in once instead of the authenticator code. They are shown only now. Keep them in a password manager or print them.">
        <div className="space-y-5">
          <ol className="grid grid-cols-2 gap-x-6 gap-y-2 panel-raised p-4" data-recovery-codes>
            {codes.map((c) => <li key={c} className="tc text-[15px] text-paper tracking-wide">{c}</li>)}
          </ol>
          <div className="flex gap-2 flex-wrap">
            <CopyButton text={text} label="Copy the recovery codes" />
            <button type="button" onClick={download} className="btn btn-ghost h-8 px-2.5 inline-flex items-center gap-1.5 text-[12.5px] no-min"><Download size={13} /> Download</button>
          </div>
          <label className="flex items-center gap-2.5 text-[13.5px] text-paper-2">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="w-4 h-4" />
            I have saved my recovery codes
          </label>
          <button onClick={() => router.replace("/")} disabled={!saved} className="btn btn-signal h-10 px-4 w-full">Go to the dashboard</button>
        </div>
      </AuthCard>
    );
  }
  if (gone) {
    return (
      <AuthCard title="Set up the dashboard">
        <div className="space-y-4">
          <Note kind="error">{gone}</Note>
          <Link href="/login" className="btn btn-ghost h-10 px-4 w-full inline-flex items-center justify-center">Go to sign in</Link>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard wide title="Set up the dashboard" intro={info ? <>Your administrator account is <span className="text-paper-2">{info.email}</span>.</> : "Checking the link."}>
      {info && (
        <form onSubmit={submit} className="space-y-7">
          <section className="space-y-3" aria-label="Authenticator app">
            <h2 className="text-[14px] font-semibold text-paper">1. Add VideoMind to your authenticator app</h2>
            <p className="text-[13px] text-dim leading-relaxed">Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar), add an account and scan this code. On this phone already? Copy the key instead.</p>
            <div className="flex gap-5 items-start flex-wrap">
              <QrCode text={info.uri} label="QR code for your authenticator app" className="w-[168px] h-[168px] rounded" />
              <div className="space-y-2 min-w-0">
                <p className="text-[12.5px] text-dim">Key</p>
                <p className="tc text-[14px] text-paper break-all" data-setup-secret={info.secret}>{groups(info.secret)}</p>
                <CopyButton text={info.secret} label="Copy the key" />
              </div>
            </div>
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
          <button type="submit" disabled={busy} className="btn btn-signal h-10 px-4 w-full">{busy ? "Setting up" : "Finish setup"}</button>
        </form>
      )}
    </AuthCard>
  );
}
