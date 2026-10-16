"use client";
// vm_admin_settings: pieces shared by the invitation page and Settings: the
// authenticator key with its QR code, and recovery codes shown once.
import { useState } from "react";
import { Copy, Check, Download } from "lucide-react";
import { QrCode } from "./QrCode";

const groups = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }} className="btn btn-ghost h-8 px-2.5 inline-flex items-center gap-1.5 text-[12.5px] no-min" aria-label={label}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : "Copy"}
    </button>
  );
}

export function AuthenticatorKey({ secret, uri }: { secret: string; uri: string }) {
  return (
    <div className="flex gap-5 items-start flex-wrap">
      <QrCode text={uri} label="QR code for your authenticator app" className="w-[168px] h-[168px] rounded" />
      <div className="space-y-2 min-w-0">
        <p className="text-[12.5px] text-dim">Key</p>
        <p className="tc text-[14px] text-paper break-all" data-auth-secret={secret}>{groups(secret)}</p>
        <CopyButton text={secret} label="Copy the key" />
      </div>
    </div>
  );
}

/** Recovery codes, shown once, with copy and download; `onDone` after the admin confirms saving them. */
export function RecoveryCodes({ codes, email, onDone, doneLabel }: { codes: string[]; email: string; onDone: () => void; doneLabel: string }) {
  const [saved, setSaved] = useState(false);
  const text = ["VideoMind dashboard recovery codes", email, "Each code works once, in place of the authenticator code.", "", ...codes].join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = "videomind-recovery-codes.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
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
      <button onClick={onDone} disabled={!saved} className="btn btn-signal h-10 px-4 w-full">{doneLabel}</button>
    </div>
  );
}
