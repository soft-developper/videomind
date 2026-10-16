"use client";
// vm_admin_settings: Settings, like Atlassian Administration's organization
// settings. Admins and invitations; your own password, authenticator and
// recovery codes; and the limits the server runs with (read only).
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { useAdmin } from "@/components/Shell";
import { Field, Note, inputCls } from "@/components/AuthCard";
import { PasswordFields, passwordIssue } from "@/components/PasswordFields";
import { AuthenticatorKey, RecoveryCodes } from "@/components/AccountParts";
import {
  ApiError, getAdmins, inviteAdmin, cancelInvite, removeAdmin, changePassword, startAuthenticator, finishAuthenticator,
  renewRecoveryCodes, getLimits, type AdminRow, type InviteRow, type Limits,
} from "@/lib/api";
import { num, when, day } from "@/lib/format";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");
const codeInput = (value: string, set: (s: string) => void, label: string) => (
  <input inputMode="text" autoComplete="one-time-code" maxLength={12} value={value} onChange={(e) => set(e.target.value)} aria-label={label}
    placeholder="123456" className="h-9 px-3 text-[13.5px] w-36 tracking-[0.2em] tabular-nums" required />
);

function Panel({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel panel-pad min-w-0" aria-label={title}>
      <div className="panel-head"><h2 className="panel-head-title">{title}</h2></div>
      {hint && <p className="text-[13px] text-dim -mt-1 mb-4 max-w-[80ch] leading-relaxed">{hint}</p>}
      {children}
    </section>
  );
}
function useNotes() {
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const notes = <>{done && <div className="mb-4"><Note kind="ok">{done}</Note></div>}{err && <div className="mb-4"><Note kind="error">{err}</Note></div>}</>;
  return { done, setDone, setErr, notes };
}

// ── admins ──────────────────────────────────────────────────────────────────
function Admins() {
  const { signedOut } = useAdmin();
  const [d, setD] = useState<{ admins: AdminRow[]; invites: InviteRow[] } | null>(null);
  const { setDone, setErr, notes } = useNotes();
  const [removing, setRemoving] = useState<AdminRow | null>(null);
  const [rmCode, setRmCode] = useState("");
  const [email, setEmail] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setD(await getAdmins()); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
  }, [signedOut, setErr]);
  useEffect(() => { void load(); }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setDone(null);
    try { const r = await inviteAdmin(email.trim(), code.trim()); setEmail(""); setCode(""); await load(); setDone(`An invitation was emailed to ${r.email}. The link works for 48 hours.`); }
    catch (x) { if (x instanceof ApiError && x.status === 401) return signedOut(); setErr(msg(x)); }
    finally { setBusy(false); }
  };
  const cancel = async (i: InviteRow) => {
    setErr(null); setDone(null);
    try { await cancelInvite(i.email); await load(); setDone(`The invitation to ${i.email} was cancelled.`); }
    catch (x) { setErr(msg(x)); }
  };
  const remove = async (e: React.FormEvent) => {
    e.preventDefault(); if (!removing) return;
    setBusy(true); setErr(null); setDone(null);
    try { await removeAdmin(removing.id, rmCode.trim()); const who = removing.email; setRemoving(null); setRmCode(""); await load(); setDone(`${who} was removed and signed out everywhere.`); }
    catch (x) { if (x instanceof ApiError && x.status === 401) return signedOut(); setErr(msg(x)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5 max-w-[960px]">
      {notes}
      <Panel title="Admins" hint="Everyone here can do everything in the dashboard. Removing someone signs them out at once and emails them. The founder's account (ADMIN_EMAIL on the server) cannot be removed here.">
        {!d && <p className="text-[14px] text-dim">Loading</p>}
        {d && (
          <ul className="divide-y divide-rule" data-admins>
            {d.admins.map((a) => (
              <li key={a.id} className="py-3" data-admin-row={a.email}>
                <div className="flex items-center gap-3 flex-wrap text-[13.5px]">
                  <span className="text-paper">{a.email}</span>
                  {a.you && <span className="badge">You</span>}
                  {a.founder && <span className="badge">Founder</span>}
                  {a.lockedUntil && <span className="badge text-error">Locked until {when(a.lockedUntil)}</span>}
                  <span className="text-dim text-[12.5px]">Added {day(a.createdAt)} · {a.lastSignInAt ? `last sign in ${when(a.lastSignInAt)}` : "never signed in"} · {a.recoveryCodesLeft} recovery {a.recoveryCodesLeft === 1 ? "code" : "codes"} left</span>
                  {!a.you && !a.founder && removing?.id !== a.id && (
                    <button onClick={() => { setRemoving(a); setRmCode(""); setErr(null); setDone(null); }} className="btn btn-ghost h-8 px-3 text-[13px] no-min ml-auto">Remove</button>
                  )}
                </div>
                {removing?.id === a.id && (
                  <form onSubmit={remove} className="mt-3 flex items-center gap-3 flex-wrap panel-raised p-3">
                    <span className="text-[13px] text-paper-2">To remove {a.email}, enter a code from your authenticator app or a recovery code.</span>
                    {codeInput(rmCode, setRmCode, "Your code")}
                    <button type="submit" disabled={busy} className="btn btn-marker h-9 px-3.5">Remove {a.email}</button>
                    <button type="button" onClick={() => setRemoving(null)} className="btn btn-ghost h-9 px-3.5">Keep</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Invite an admin" hint="The person gets an email with a link that works once, for 48 hours. They choose their own password and add VideoMind to their own authenticator app. To send it, enter a code from your authenticator app or a recovery code.">
        <form onSubmit={invite} className="flex items-end gap-3 flex-wrap">
          <label className="text-[13px] text-dim flex flex-col gap-1">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="h-9 px-3 text-[13.5px] w-64" required /></label>
          <label className="text-[13px] text-dim flex flex-col gap-1">Your code{codeInput(code, setCode, "Your code for the invitation")}</label>
          <button type="submit" disabled={busy} className="btn btn-ghost h-9 px-3.5">{busy ? "Sending" : "Send invitation"}</button>
        </form>
        {d && d.invites.length > 0 && (
          <div className="mt-5">
            <p className="stat-label !mt-0 mb-2">Waiting to be accepted</p>
            <ul className="divide-y divide-rule" data-invites>
              {d.invites.map((i) => (
                <li key={i.email} className="flex items-center gap-3 py-2 text-[13.5px] flex-wrap" data-invite-row={i.email}>
                  <span className="text-paper">{i.email}</span>
                  <span className="text-dim text-[12.5px]">sent {when(i.sentAt)}{i.by ? ` by ${i.by}` : ""}, until {when(i.expiresAt)}</span>
                  <button onClick={() => void cancel(i)} className="btn btn-ghost h-8 px-3 text-[13px] no-min ml-auto">Cancel</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── your account ────────────────────────────────────────────────────────────
function Account() {
  const { admin, signedOut } = useAdmin();
  const pwN = useNotes(), authN = useNotes(), rcN = useNotes();
  const [cur, setCur] = useState(""); const [pw, setPw] = useState(""); const [again, setAgain] = useState("");
  const [newKey, setNewKey] = useState<{ secret: string; uri: string; expiresAt: number } | null>(null);
  const [authPw, setAuthPw] = useState(""); const [authCode, setAuthCode] = useState("");
  const [rcPw, setRcPw] = useState(""); const [codes, setCodes] = useState<string[] | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loadLeft = useCallback(() => getAdmins().then((r) => setLeft(r.admins.find((a) => a.you)?.recoveryCodesLeft ?? null), () => {}), []);
  useEffect(() => { void loadLeft(); }, [loadLeft]);
  const handle = (n: ReturnType<typeof useNotes>) => (x: unknown) => { if (x instanceof ApiError && x.status === 401) return signedOut(); n.setErr(msg(x)); };

  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault(); pwN.setErr(null); pwN.setDone(null);
    const issue = passwordIssue(pw, again); if (issue) return pwN.setErr(issue);
    setBusy("pw");
    try { await changePassword(cur, pw); setCur(""); setPw(""); setAgain(""); pwN.setDone("Your password was changed. Your other sessions were signed out, and you will get an email about it."); }
    catch (x) { handle(pwN)(x); }
    finally { setBusy(null); }
  };
  const begin = async () => {
    authN.setErr(null); authN.setDone(null); setBusy("auth");
    try { setNewKey(await startAuthenticator()); setAuthPw(""); setAuthCode(""); }
    catch (x) { handle(authN)(x); }
    finally { setBusy(null); }
  };
  const finish = async (e: React.FormEvent) => {
    e.preventDefault(); authN.setErr(null); setBusy("auth");
    try { await finishAuthenticator(authPw, authCode.trim()); setNewKey(null); setAuthPw(""); setAuthCode(""); authN.setDone("Two step verification now uses the new app. Codes from the old one no longer work, and your other sessions were signed out."); }
    catch (x) { handle(authN)(x); }
    finally { setBusy(null); }
  };
  const renew = async (e: React.FormEvent) => {
    e.preventDefault(); rcN.setErr(null); rcN.setDone(null); setBusy("rc");
    try { const r = await renewRecoveryCodes(rcPw); setRcPw(""); setCodes(r.recoveryCodes); }
    catch (x) { handle(rcN)(x); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-5 max-w-[760px]">
      <p className="text-[13.5px] text-paper-2">Signed in as <span className="text-paper">{admin.email}</span>.</p>
      <Panel title="Password" hint="You need your current password. Your other sessions are signed out; this one stays.">
        {pwN.notes}
        <form onSubmit={submitPw} className="space-y-4 max-w-[440px]">
          <Field label="Current password"><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} className={inputCls} maxLength={256} required /></Field>
          <PasswordFields pw={pw} again={again} setPw={setPw} setAgain={setAgain} />
          <button type="submit" disabled={busy === "pw"} className="btn btn-ghost h-10 px-4">{busy === "pw" ? "Changing" : "Change password"}</button>
        </form>
      </Panel>

      <Panel title="Authenticator app" hint="Moving to a new phone or app? Add VideoMind to the new app first; the old one keeps working until you confirm with a code from the new one.">
        {authN.notes}
        {!newKey ? (
          <button onClick={() => void begin()} disabled={busy === "auth"} className="btn btn-ghost h-10 px-4">Use a new authenticator app</button>
        ) : (
          <form onSubmit={finish} className="space-y-5" aria-label="New authenticator">
            <p className="text-[13px] text-dim">1. Scan this code with the new app, or copy the key. This key works until {when(newKey.expiresAt)}.</p>
            <AuthenticatorKey secret={newKey.secret} uri={newKey.uri} />
            <p className="text-[13px] text-dim">2. Confirm with your password and the code the new app shows.</p>
            <div className="space-y-4 max-w-[440px]">
              <Field label="Current password"><input type="password" autoComplete="current-password" value={authPw} onChange={(e) => setAuthPw(e.target.value)} className={inputCls} maxLength={256} required /></Field>
              <Field label="Code from the new app"><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={authCode} onChange={(e) => setAuthCode(e.target.value)} className={`${inputCls} tracking-[0.3em] tabular-nums max-w-[200px]`} required /></Field>
            </div>
            <div className="flex gap-3 flex-wrap">
              <button type="submit" disabled={busy === "auth"} className="btn btn-signal h-10 px-4">{busy === "auth" ? "Switching" : "Switch to the new app"}</button>
              <button type="button" onClick={() => { setNewKey(null); authN.setErr(null); }} className="btn btn-ghost h-10 px-4">Keep the current app</button>
            </div>
          </form>
        )}
      </Panel>

      <Panel title="Recovery codes" hint={<>Each code signs you in once if you lose your phone. {left !== null && <span data-rc-left>You have {num(left)} left.</span>} New codes replace all the old ones.</>}>
        {rcN.notes}
        {codes ? (
          <RecoveryCodes codes={codes} email={admin.email} onDone={() => { setCodes(null); rcN.setDone("Your new recovery codes are saved. The old ones no longer work."); void loadLeft(); }} doneLabel="Done" />
        ) : (
          <form onSubmit={renew} className="flex items-end gap-3 flex-wrap">
            <label className="text-[13px] text-dim flex flex-col gap-1">Current password<input type="password" autoComplete="current-password" value={rcPw} onChange={(e) => setRcPw(e.target.value)} className="h-9 px-3 text-[13.5px] w-64" maxLength={256} required aria-label="Current password for new recovery codes" /></label>
            <button type="submit" disabled={busy === "rc"} className="btn btn-ghost h-9 px-3.5">Make new recovery codes</button>
          </form>
        )}
      </Panel>
    </div>
  );
}

// ── limits ──────────────────────────────────────────────────────────────────
function LimitsTab() {
  const { signedOut } = useAdmin();
  const [l, setL] = useState<Limits | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getLimits().then(setL, (e) => { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }); }, [signedOut]);
  if (err) return <Note kind="error">{err}</Note>;
  if (!l) return <p className="text-[14px] text-dim">Loading</p>;
  return (
    <div className="space-y-5 max-w-[960px]">
      <p className="text-[13px] text-dim max-w-[80ch]">What the server is running with now, read only. Each value is changed by the setting named here on Render, which restarts the server.</p>
      <Panel title="Request limits" hint="How many requests one caller, and everyone together, may make in a time. Over the limit, the site asks to try again later.">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[560px]" data-limits>
            <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">For</th><th className="font-normal py-1.5 pr-4">Name</th><th className="font-normal py-1.5 pr-4 text-right">One caller</th><th className="font-normal py-1.5 text-right">Everyone</th></tr></thead>
            <tbody>{l.rates.map((r) => (
              <tr key={r.name} className="border-t border-rule" data-limit-row={r.name}>
                <td className="py-1.5 pr-4 text-paper-2 first-letter:uppercase">{r.label}</td>
                <td className="py-1.5 pr-4 text-dim tc text-[12.5px]">{r.name}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-paper">{num(r.perCaller.max)} per {r.perCaller.per}</td>
                <td className="py-1.5 text-right tabular-nums text-paper-2">{num(r.everyone.max)} per {r.everyone.per}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Usage caps">
          <table className="w-full text-[13.5px]" data-caps>
            <tbody>{l.caps.map((c) => (
              <tr key={c.setting} className="border-t border-rule first:border-0 align-top">
                <td className="py-1.5 pr-4 text-paper-2">{c.label}<p className="tc text-[11.5px] text-dim mt-0.5">{c.setting}</p></td>
                <td className="py-1.5 text-right tabular-nums text-paper whitespace-nowrap">{c.value}</td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
        <Panel title="Dashboard sign in">
          <table className="w-full text-[13.5px]" data-dashboard-rules>
            <tbody>{l.dashboard.map((c) => (
              <tr key={c.label} className="border-t border-rule first:border-0"><td className="py-1.5 pr-4 text-paper-2">{c.label}</td><td className="py-1.5 text-right text-paper">{c.value}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

type Tab = "admins" | "account" | "limits";
const TABS: Array<[Tab, string]> = [["admins", "Admins"], ["account", "Your account"], ["limits", "Limits"]];
export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("admins");
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t === "account" || t === "limits") setTab(t); }, []);
  const pick = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "admins") url.searchParams.delete("tab"); else url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  return (
    <div className="section py-6 lg:py-8">
      <h1 className="font-display text-[22px] text-paper">Settings</h1>
      <p className="text-[14px] text-dim mt-1 mb-5">Admins, your own account, and the limits in force.</p>
      <div role="tablist" aria-label="Settings" className="flex gap-1 border-b border-rule mb-5 overflow-x-auto">
        {TABS.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => pick(t)} className={clsx("h-10 px-3 text-[13.5px] border-b-2 -mb-px whitespace-nowrap no-min", tab === t ? "border-signal text-paper" : "border-transparent text-dim hover:text-paper")}>{l}</button>)}
      </div>
      {tab === "admins" ? <Admins /> : tab === "account" ? <Account /> : <LimitsTab />}
    </div>
  );
}
