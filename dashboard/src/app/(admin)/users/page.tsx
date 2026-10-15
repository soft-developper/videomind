"use client";
// vm_admin_users: every wallet that has signed in, like Atlassian
// Administration's Directory. Search by name or address, filter, sort.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Search } from "lucide-react";
import { useAdmin } from "@/components/Shell";
import { Note } from "@/components/AuthCard";
import { ApiError, getUsers, type AdminUser, type UserSort } from "@/lib/api";
import { num, bytes, day, when, short } from "@/lib/format";

const SORTS: Array<[UserSort, string]> = [["joined", "Newest"], ["active", "Last sign in"], ["videos", "Most videos"], ["storage", "Most storage"]];
const PAGE = 50;

export default function UsersPage() {
  const { signedOut } = useAdmin();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "suspended">("all");
  const [sort, setSort] = useState<UserSort>("joined");
  const [rows, setRows] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  // Search as you type, after a short pause.
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async (offset: number) => {
    const my = ++seq.current;
    setBusy(true); setErr(null);
    try {
      const r = await getUsers({ q: query, filter, sort, offset, limit: PAGE });
      if (my !== seq.current) return;
      setRows((cur) => (offset === 0 ? r.users : [...(cur ?? []), ...r.users])); setTotal(r.total);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return signedOut();
      setErr(e instanceof ApiError ? e.message : "The users could not be loaded.");
    } finally { if (my === seq.current) setBusy(false); }
  }, [query, filter, sort, signedOut]);
  useEffect(() => { void load(0); }, [load]);

  return (
    <div className="section py-6 lg:py-8">
      <h1 className="font-display text-[22px] text-paper">Users</h1>
      <p className="text-[14px] text-dim mt-1 mb-6">Every wallet that has signed in to VideoMind.</p>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <label className="relative flex-1 min-w-[220px] max-w-[420px]">
          <span className="sr-only">Search by name or wallet address</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or wallet address" className="w-full h-9 pl-8 pr-3 text-[13.5px]" />
        </label>
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-md border border-rule p-0.5 bg-slate">
          {(["all", "suspended"] as const).map((f) => (
            <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={clsx("h-8 px-3 rounded text-[13px] no-min", filter === f ? "bg-slate-2 text-paper" : "text-dim hover:text-paper")}>
              {f === "all" ? "All" : "Suspended"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-dim">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as UserSort)} className="h-9 px-2.5 text-[13.5px]" aria-label="Sort">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <span className="text-[12.5px] text-dim ml-auto" data-users-total>{rows ? `${num(total)} ${total === 1 ? "wallet" : "wallets"}` : ""}</span>
      </div>

      {err && <div className="mb-4"><Note kind="error">{err}</Note></div>}
      {!rows && !err && <p className="text-[14px] text-dim">Loading</p>}
      {rows && rows.length === 0 && <p className="text-[14px] text-dim py-6">{query || filter !== "all" ? "No wallet matches." : "No wallet has signed in yet."}</p>}
      {rows && rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[760px]">
            <thead>
              <tr className="text-left text-dim border-b border-rule">
                <th className="font-normal py-2.5 px-4">Wallet</th>
                <th className="font-normal py-2.5 pr-4">Joined</th>
                <th className="font-normal py-2.5 pr-4">Last sign in</th>
                <th className="font-normal py-2.5 pr-4 text-right">Videos</th>
                <th className="font-normal py-2.5 pr-4 text-right">Storage</th>
                <th className="font-normal py-2.5 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.wallet} className="border-b border-rule last:border-0 hover:bg-slate-2" data-user-row={u.wallet}>
                  <td className="py-2.5 px-4 min-w-0">
                    <Link href={`/users/${u.wallet}`} className="block min-w-0 group">
                      <span className="block text-paper group-hover:text-signal truncate">{u.name ?? <span className="text-dim">No name</span>}</span>
                      <span className="block tc text-[12.5px] text-dim">{short(u.wallet)}</span>
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 text-paper-2 whitespace-nowrap">{u.joinedAt ? day(u.joinedAt) : "-"}</td>
                  <td className="py-2.5 pr-4 text-paper-2 whitespace-nowrap">{u.lastSignInAt ? when(u.lastSignInAt) : "-"}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-paper">{num(u.videos)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-paper-2">{bytes(u.storageBytes)}</td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    {u.suspended ? <span className="badge border-error/50 text-error">Suspended</span>
                      : u.openSessions > 0 ? <span className="badge badge-marker">Signed in</span>
                      : <span className="text-dim text-[12.5px]">Signed out</span>}
                    {u.dataDeleted && <span className="text-dim text-[12.5px] ml-2">Data deleted</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length < total && (
        <button onClick={() => void load(rows.length)} disabled={busy} className="btn btn-ghost h-9 px-4 mt-4">{busy ? "Loading" : `Show ${Math.min(PAGE, total - rows.length)} more`}</button>
      )}
    </div>
  );
}
