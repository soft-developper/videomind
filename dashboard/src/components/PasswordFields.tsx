"use client";
// vm_admin: a new password and its confirmation. Length is the only rule
// (OWASP): at least 15 characters, any characters, spaces welcome.
import { Field, inputCls } from "./AuthCard";

export const MIN = 15;
export function passwordIssue(pw: string, again: string): string | null {
  if (Array.from(pw).length < MIN) return `Use at least ${MIN} characters.`;
  if (pw !== again) return "The two passwords are not the same.";
  return null;
}
export function PasswordFields({ pw, again, setPw, setAgain }: { pw: string; again: string; setPw: (s: string) => void; setAgain: (s: string) => void }) {
  const n = Array.from(pw).length;
  return (
    <>
      <Field label="New password" hint={<>At least {MIN} characters. A few unrelated words with spaces is strong and easy to remember. <span className="tabular-nums">{n > 0 ? `${n} so far.` : ""}</span></>}>
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} maxLength={256} required />
      </Field>
      <Field label="New password again">
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputCls} maxLength={256} required />
      </Field>
    </>
  );
}
