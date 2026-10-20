"use client";
// vm_admin_users: one wallet. What it has, what it used, and the actions
// an admin can take: sign out everywhere, suspend, delete its data.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Copy, Check } from "lucide-react";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import { ApiError, getUser, signOutUser, suspendUser, unsuspendUser, deleteUserData, getWalletCredits, type UserDetail, type UsageNumbers, type WalletCredits } from "@/lib/api";
import { dollars, CREDIT_KINDS } from "@/lib/actions";
import { num, bytes, duration, tokens, when, day } from "@/lib/format";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "That did not work. Try again.");

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="panel p-4 min-w-0"><p className="stat-label !mt-0">{label}</p><p className="stat-value mt-1.5 text-[19px]">{value}</p></div>;
}
function Panel({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`panel panel-pad min-w-0 ${danger ? "border-error/40" : ""}`} aria-label={title}>
      <div className="panel-head"><h2 className={`panel-head-title ${danger ? "!text-error" : ""}`}>{title}</h2></div>
      {children}
    </section>
  );
}
function UsageRows({ u }: { u: UsageNumbers }) {
  return (
    <>
      <td className="py-1.5 text-right tabular-nums">{duration(u.transcribedSeconds)}</td>
      <td className="py-1.5 text-right tabular-nums">{tokens(u.inputTokens)}</td>
      <td className="py-1.5 text-right tabular-nums">{tokens(u.outputTokens)}</td>
      <td className="py-1.5 text-right tabular-nums">{bytes(u.bytesUploaded)}</td>
    </>
  );
}

export default function UserPage({ params }: { params: { wallet: string } }) {
  const wallet = decodeURIComponent(params.wallet);
  const { signedOut } = useAdmin();
  const [d, setD] = useState<UserDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [copied, setCopied] = useState(false);
  const [gone, setGone] = useState<string | null>(null);
  // vm_credits
  const [credits, setCredits] = useState<WalletCredits | null>(null);
  useEffect(() => { getWalletCredits(wallet).then(setCredits, () => setCredits(null)); }, [wallet, done]);

  const load = useCallback(async () => {
    try { setD(await getUser(wallet)); setErr(null); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) return signedOut();
      // Deleted and not suspended: nothing about the wallet is left.
      if (e instanceof ApiError && e.status === 404 && gone) { setD(null); return; }
      setErr(msg(e));
    }
  }, [wallet, signedOut, gone]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setDone(null); setFailed(null);
    try { setDone(await fn()); }
    catch (e) { if (e instanceof ApiError && e.status === 401) return signedOut(); setFailed(msg(e)); }
    finally { setBusy(false); }
  };
  // After any action, read the wallet again.
  useEffect(() => { if (done) void load(); }, [done, load]);

  const u = d?.user;
  return (
    <div className="section py-6 lg:py-8">
      <Link href="/users" className="inline-flex items-center gap-1 -ml-1 mb-3 text-[13px] text-dim hover:text-paper"><ChevronLeft size={14} /> Users</Link>
      {gone && !d && (
        <div className="space-y-4 max-w-[640px]">
          <Note kind="ok">{gone}</Note>
          <Link href="/users" className="btn btn-ghost h-9 px-3.5 inline-flex items-center">Back to Users</Link>
        </div>
      )}
      {err && !gone && <Note kind="error">{err}</Note>}
      {!d && !err && !gone && <p className="text-[14px] text-dim">Loading</p>}
      {d && u && (
        <div className="space-y-5 max-w-[1100px]">
          <div>
            <h1 className="font-display text-[22px] text-paper">{u.name ?? "No name"}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="tc text-[13px] text-paper-2 break-all" data-user-wallet>{u.wallet}</span>
              <button onClick={() => { navigator.clipboard.writeText(u.wallet).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }} aria-label="Copy the wallet address" className="w-8 h-8 inline-flex items-center justify-center rounded text-dim hover:text-paper hover:bg-slate-2 no-min">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              {u.suspended && <span className="badge border-error/50 text-error">Suspended</span>}
              {u.dataDeleted && <span className="badge">Data deleted</span>}
            </div>
          </div>

          {u.suspended && <Note kind="error">Suspended {u.suspendedAt ? `on ${when(u.suspendedAt)}` : ""}: {u.suspendedReason}. This wallet cannot sign in.</Note>}
          {u.dataDeleted && <Note kind="info">This wallet&rsquo;s data was deleted. Only the suspension record is kept.</Note>}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Tile label="Videos" value={num(u.videos)} />
            <Tile label="Storage" value={bytes(u.storageBytes)} />
            <Tile label="Views, 30 days" value={num(d.counts.views30)} />
            <Tile label="Joined" value={u.joinedAt ? day(u.joinedAt) : "-"} />
            <Tile label="Last sign in" value={u.lastSignInAt ? day(u.lastSignInAt) : "-"} />
            <Tile label="Signed in on" value={`${num(u.openSessions)} ${u.openSessions === 1 ? "device" : "devices"}`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel title="Usage">
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px] text-paper-2 min-w-[420px]">
                  <thead><tr className="text-dim"><th className="font-normal text-left py-1.5" /><th className="font-normal text-right py-1.5">Transcribed</th><th className="font-normal text-right py-1.5">AI tokens read</th><th className="font-normal text-right py-1.5">Written</th><th className="font-normal text-right py-1.5">Uploaded</th></tr></thead>
                  <tbody>
                    <tr className="border-t border-rule"><td className="py-1.5 text-dim">This month</td><UsageRows u={d.usage.thisMonth} /></tr>
                    <tr className="border-t border-rule"><td className="py-1.5 text-dim">All time</td><UsageRows u={d.usage.allTime} /></tr>
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Activity">
              <dl className="grid grid-cols-2 gap-y-2.5 gap-x-6 text-[13.5px]">
                <dt className="text-dim">Collections</dt><dd className="text-right tabular-nums text-paper">{num(d.counts.collections)}</dd>
                <dt className="text-dim">Notes and bookmarks</dt><dd className="text-right tabular-nums text-paper">{num(d.counts.notes)}</dd>
                <dt className="text-dim">Live events</dt><dd className="text-right tabular-nums text-paper">{num(d.counts.liveEvents)}</dd>
                <dt className="text-dim">Clips</dt><dd className="text-right tabular-nums text-paper">{num(d.counts.clips)}</dd>
                <dt className="text-dim">YouTube</dt><dd className="text-right text-paper">{d.youtubeConnected ? "Connected" : "Not connected"}</dd>
              </dl>
            </Panel>
          </div>

          {credits && (
            <Panel title="Credits">
              <div className="flex items-baseline gap-6 flex-wrap" data-user-credits>
                <p className="text-[13.5px] text-dim">Balance <span className="text-[17px] text-paper tabular-nums ml-1">{dollars(credits.balanceMicros, true)}</span></p>
                {credits.heldMicros > 0 && <p className="text-[13.5px] text-dim">On hold <span className="text-paper tabular-nums ml-1">{dollars(credits.heldMicros, true)}</span></p>}
                <Link href={`/credits?wallet=${encodeURIComponent(credits.wallet)}`} className="text-[13.5px] text-paper-2 underline hover:text-paper ml-auto">Give credits, refunds and the full ledger</Link>
              </div>
              {credits.entries.length > 0 && (
                <ul className="mt-3 divide-y divide-rule text-[13.5px]">
                  {credits.entries.slice(0, 5).map((e) => (
                    <li key={e.id} className="flex items-center gap-3 py-1.5">
                      <span className="text-dim whitespace-nowrap">{day(e.at)}</span>
                      <span className="text-paper-2 truncate min-w-0">{CREDIT_KINDS[e.kind] ?? e.kind}{e.note ? `: ${e.note}` : ""}</span>
                      <span className="ml-auto tabular-nums text-paper whitespace-nowrap">{e.amountMicros > 0 ? "+" : ""}{dollars(e.amountMicros, true)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel title={`Videos (${num(d.videos.length)})`}>
            {d.videos.length === 0 ? <p className="text-[13.5px] text-dim">No videos.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px] min-w-[620px]" data-user-videos>
                  <thead><tr className="text-left text-dim"><th className="font-normal py-1.5 pr-4">Title</th><th className="font-normal py-1.5 pr-4">Status</th><th className="font-normal py-1.5 pr-4">Who can see it</th><th className="font-normal py-1.5 pr-4 text-right">Length</th><th className="font-normal py-1.5 pr-4 text-right">Size</th><th className="font-normal py-1.5">Uploaded</th></tr></thead>
                  <tbody>
                    {d.videos.map((v) => (
                      <tr key={v.id} className="border-t border-rule">
                        <td className="py-1.5 pr-4 text-paper max-w-[280px] truncate">{v.title}{v.onShelby && <span className="text-dim text-[12px] ml-2">On Shelby</span>}</td>
                        <td className="py-1.5 pr-4 text-paper-2">{v.status === "ready" ? "Ready" : v.status === "error" ? "Failed" : "Processing"}</td>
                        <td className="py-1.5 pr-4 text-paper-2 capitalize">{v.visibility}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-paper-2">{v.durationSeconds ? duration(v.durationSeconds) : "-"}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-paper-2">{v.sizeBytes ? bytes(v.sizeBytes) : "-"}</td>
                        <td className="py-1.5 text-paper-2 whitespace-nowrap">{day(v.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Actions" danger>
            <div className="space-y-6">
              {done && <Note kind="ok">{done}</Note>}
              {failed && <Note kind="error">{failed}</Note>}
              <div className="space-y-2">
                <h3 className="text-[14px] font-semibold text-paper">Sign out everywhere</h3>
                <p className="text-[13px] text-dim">Ends every session of this wallet. It can sign in again.</p>
                <button disabled={busy || u.openSessions === 0} onClick={() => { if (window.confirm("Sign this wallet out on every device?")) void act(async () => { const r = await signOutUser(u.wallet); return `Signed out of ${r.ended} ${r.ended === 1 ? "session" : "sessions"}.`; }); }} className="btn btn-ghost h-9 px-3.5">Sign out everywhere</button>
              </div>
              <div className="space-y-2 border-t border-rule pt-5">
                <h3 className="text-[14px] font-semibold text-paper">{u.suspended ? "Lift the suspension" : "Suspend"}</h3>
                {u.suspended ? (
                  <>
                    <p className="text-[13px] text-dim">The wallet can sign in again. Its videos were never hidden by the suspension.</p>
                    <button disabled={busy} onClick={() => void act(async () => { await unsuspendUser(u.wallet); return "The suspension was lifted."; })} className="btn btn-ghost h-9 px-3.5">Lift the suspension</button>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] text-dim">The wallet is signed out and cannot sign in until you lift it. Its shared videos stay up; taking content down comes with the Content section.</p>
                    <label className="block max-w-[520px]"><span className="block text-[13px] text-paper-2 mb-1.5">Reason (kept with the suspension)</span>
                      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="w-full px-3 py-2 text-[13.5px]" />
                    </label>
                    <button disabled={busy || reason.trim().length < 3} onClick={() => void act(async () => { await suspendUser(u.wallet, reason); setReason(""); return "The wallet is suspended."; })} className="btn h-9 px-3.5 bg-error/90 text-void hover:bg-error disabled:opacity-40">Suspend this wallet</button>
                  </>
                )}
              </div>
              {!u.dataDeleted && (
                <div className="space-y-2 border-t border-rule pt-5">
                  <h3 className="text-[14px] font-semibold text-paper">Delete the data</h3>
                  <p className="text-[13px] text-dim max-w-[70ch]">Deletes this wallet&rsquo;s videos and their files, collections, notes, profile, settings, live events and chat, and its YouTube connection, the same as Delete my data. Copies on Shelby and YouTube stay, and so does its credits ledger, as a record of money. This cannot be undone.</p>
                  <label className="block max-w-[520px]"><span className="block text-[13px] text-paper-2 mb-1.5">Type the wallet address to confirm</span>
                    <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} className="w-full h-9 px-3 text-[13px] tc" />
                  </label>
                  <button disabled={busy || confirm.trim().toLowerCase() !== u.wallet.toLowerCase()} onClick={() => void act(async () => { const r = await deleteUserData(u.wallet, confirm.trim()); setConfirm(""); if (!u.suspended) setGone("The wallet's data was deleted. Only its usage amounts and credits ledger are kept, so it no longer appears in Users."); return `Deleted: ${num(r.deleted.videos ?? 0)} videos, ${num(r.deleted.collections ?? 0)} collections, ${num(r.deleted.notes ?? 0)} notes, ${num(r.deleted.liveEvents ?? 0)} live events.`; })} className="btn h-9 px-3.5 bg-error/90 text-void hover:bg-error disabled:opacity-40">Delete this wallet&rsquo;s data</button>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
