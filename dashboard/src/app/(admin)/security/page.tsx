"use client";
// vm_ops: Security, like Atlassian Administration's Security. Suspended
// wallets, sessions, admin sign ins, and recent events kept in memory.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { RefreshCw } from "lucide-react";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import { ApiError, getSecurity, endOtherSessions, type SecurityInfo } from "@/lib/api";
import { num, when, short } from "@/lib/format";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");
const ACT: Record<string, string> = {
  sign_in: "Signed in", sign_out: "Signed out", sign_in_failed: "Failed sign in", sign_in_while_locked: "Sign in while locked", locked: "Account locked",
  password_reset: "Password changed", reset_link_sent: "Reset link sent", reset_link_unknown_email: "Reset asked for an unknown email", set_up: "Dashboard set up",
  admin_sessions_ended: "Signed other sessions out",
};
const LIMITS: Record<string, string> = {
  ai: "AI requests", pipeline: "Processing starts", upload: "Uploads", upload_parts: "Upload parts", delete: "Deletions", auth: "Wallet sign in",
  views: "Play reports", progress: "Progress saves", search: "Searches", notes: "Notes", clips: "Clips", collection_write: "Collection changes",
  video_edit: "Video edits", profile: "Profile changes", profile_read: "Public profiles", settings: "Settings changes", youtube: "YouTube publishing",
  live: "Live events", live_chat: "Live chat", live_watch: "Live viewers", admin_auth: "Dashboard sign in", admin_mail: "Dashboard emails",
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="panel p-4 min-w-0"><p className="stat-label !mt-0">{label}</p><p className="stat-value mt-1.5">{value}</p>{sub && <p className="text-[12.5px] text-dim mt-1">{sub}</p>}</div>;
}
function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel panel-pad min-w-0" aria-label={title}>
      <div className="panel-head"><h2 className="panel-head-title">{title}</h2></div>
      {hint && <p className="text-[12.5px] text-dim -mt-2 mb-3">{hint}</p>}
      {children}
    </section>
  );
}

export default function SecurityPage() {
  const { signedOut } = useAdmin();
  const [d, setD] = useState<SecurityInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setD(await getSecurity()); setErr(null); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setErr(msg(e)); }
    finally { setBusy(false); }
  }, [signedOut]);
  useEffect(() => { void load(); }, [load]);
  const endOthers = async () => {
    if (!window.confirm("Sign every other dashboard session out? This one stays signed in.")) return;
    try { const r = await endOtherSessions(); setDone(`Signed ${num(r.ended)} other ${r.ended === 1 ? "session" : "sessions"} out.`); await load(); }
    catch (e) { setErr(msg(e)); }
  };

  return (
    <div className="section py-6 lg:py-8">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-[22px] text-paper">Security</h1>
          <p className="text-[14px] text-dim mt-1">Suspended wallets, sessions, dashboard sign ins and recent refusals.</p>
        </div>
        <button onClick={() => void load()} disabled={busy} className="btn btn-ghost h-9 px-3 inline-flex items-center gap-2"><RefreshCw size={14} className={clsx(busy && "animate-spin")} /> Refresh</button>
      </div>
      {err && <div className="mb-4"><Note kind="error">{err}</Note></div>}
      {done && <div className="mb-4"><Note kind="ok">{done}</Note></div>}
      {!d && !err && <p className="text-[14px] text-dim">Loading</p>}
      {d && (
        <div className="space-y-5 max-w-[1200px]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Suspended wallets" value={num(d.suspended.length)} />
            <Tile label="Wallets signed in" value={num(d.walletSessions.wallets)} sub={`${num(d.walletSessions.open)} sessions`} />
            <Tile label="Refused wallet sign ins" value={num(d.memory.refusedCount)} sub={`Since ${when(d.memory.since)}`} />
            <Tile label="Rate limits reached" value={num(d.memory.limitHits)} sub={`Since ${when(d.memory.since)}`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Dashboard sessions">
              <ul className="divide-y divide-rule" data-admin-sessions>
                {d.adminSessions.map((s) => (
                  <li key={s.id} className="py-2 flex items-center gap-3 flex-wrap text-[13.5px]">
                    <span className="text-paper-2">{s.email}</span>
                    {s.current && <span className="badge badge-marker">This browser</span>}
                    <span className="ml-auto text-dim text-[12.5px]">Signed in {when(s.createdAt)}, last used {when(s.lastSeenAt)}</span>
                  </li>
                ))}
              </ul>
              <button onClick={() => void endOthers()} disabled={d.adminSessions.length < 2} className="btn btn-ghost h-9 px-3.5 mt-4">Sign out every other session</button>
            </Panel>
            <Panel title="Suspended wallets">
              {d.suspended.length === 0 ? <p className="text-[13.5px] text-dim">No wallet is suspended.</p> : (
                <ul className="divide-y divide-rule">
                  {d.suspended.map((s) => (
                    <li key={s.wallet} className="py-2 text-[13.5px]">
                      <Link href={`/users/${s.wallet}`} className="tc text-paper hover:text-signal">{short(s.wallet)}</Link>
                      <span className="text-dim ml-2">{when(s.at)}{s.by ? `, by ${s.by}` : ""}</span>
                      <p className="text-paper-2 mt-0.5">{s.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="Dashboard sign in activity">
            {d.adminSignIns.length === 0 ? <p className="text-[13.5px] text-dim">Nothing yet.</p> : (
              <ul className="divide-y divide-rule" data-admin-signins>
                {d.adminSignIns.map((a, i) => (
                  <li key={i} className="py-2 text-[13.5px] flex flex-col sm:flex-row sm:items-baseline gap-x-3 gap-y-0.5">
                    <span className={clsx("shrink-0", /fail|lock|unknown/.test(a.action) ? "text-error" : "text-paper-2")}>{ACT[a.action] ?? a.action}</span>
                    {a.email && <span className="text-dim truncate">{a.email}</span>}
                    {a.detail && typeof a.detail.with === "string" && <span className="text-dim">with {a.detail.with === "app" ? "the authenticator" : a.detail.with === "recovery" ? "a recovery code" : String(a.detail.with)}</span>}
                    <span className="sm:ml-auto text-dim tabular-nums text-[12.5px] sm:text-[13.5px] shrink-0">{when(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Refused wallet sign ins" hint="Kept in the server's memory only, and cleared when it restarts.">
              {d.memory.refusedSignIns.length === 0 ? <p className="text-[13.5px] text-dim">None since the server started.</p> : (
                <ul className="divide-y divide-rule" data-refused>
                  {d.memory.refusedSignIns.map((r, i) => (
                    <li key={i} className="py-2 text-[13.5px]">
                      <span className="tc text-paper-2">{r.wallet ? short(r.wallet) : "No address"}</span>
                      <span className="text-dim ml-2">{when(r.at)}</span>
                      <p className="text-paper-2 mt-0.5">{r.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Rate limits reached" hint="Callers are shown as codes that change when the server restarts, never as IP addresses. Memory only.">
              {d.memory.limits.length === 0 ? <p className="text-[13.5px] text-dim">None since the server started.</p> : (
                <table className="w-full text-[13.5px]" data-limits>
                  <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-3">Limit</th><th className="font-normal py-1.5 pr-3">Caller</th><th className="font-normal py-1.5 pr-3 text-right">Times</th><th className="font-normal py-1.5">Last</th></tr></thead>
                  <tbody>
                    {d.memory.limits.map((l) => (
                      <tr key={`${l.family}${l.caller}`} className="border-t border-rule">
                        <td className="py-1.5 pr-3 text-paper-2">{LIMITS[l.family] ?? l.family}</td>
                        <td className="py-1.5 pr-3 tc text-dim">{l.caller}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-paper">{num(l.count)}</td>
                        <td className="py-1.5 text-dim whitespace-nowrap">{when(l.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
