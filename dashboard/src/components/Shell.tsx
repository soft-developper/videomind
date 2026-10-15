"use client";
// vm_admin: the signed in frame, laid out like Atlassian Administration:
// a sidebar of sections (in its order) and a top bar with the admin and
// Sign out. Sections not built yet are listed greyed out and marked Soon.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { clsx } from "clsx";
import { LayoutDashboard, Users, Film, Shield, Wrench, BarChart3, Receipt, Settings, Menu, X, type LucideIcon } from "lucide-react";
import { Brand } from "./AuthCard";
import { ApiError, getMe, logout, type AdminInfo } from "@/lib/api";

const NAV: Array<{ label: string; href?: string; icon: LucideIcon }> = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Users", icon: Users },
  { label: "Content", icon: Film },
  { label: "Security", icon: Shield },
  { label: "Operations", icon: Wrench },
  { label: "Insights", icon: BarChart3 },
  { label: "Costs", icon: Receipt },
  { label: "Settings", icon: Settings },
];

const AdminCtx = createContext<{ admin: AdminInfo; signedOut: () => void } | null>(null);
export const useAdmin = () => useContext(AdminCtx)!;

function Nav({ path, onPick }: { path: string; onPick?: () => void }) {
  return (
    <nav aria-label="Sections" className="space-y-0.5">
      {NAV.map((it) => {
        const Icon = it.icon;
        const active = !!it.href && path === it.href;
        const inner = (
          <>
            <Icon size={15} className={active ? "text-signal" : ""} />
            <span>{it.label}</span>
            {!it.href && <span className="ml-auto text-[11px] text-dim-2">Soon</span>}
          </>
        );
        const cls = clsx("flex items-center gap-2.5 h-9 px-3 rounded text-[13.5px]", active ? "bg-slate-2 text-paper" : it.href ? "text-paper-2 hover:text-paper hover:bg-slate" : "text-dim-2 cursor-default");
        return it.href
          ? <Link key={it.label} href={it.href} onClick={onPick} className={cls} aria-current={active ? "page" : undefined}>{inner}</Link>
          : <div key={it.label} className={cls} aria-disabled>{inner}</div>;
      })}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getMe().then((r) => setAdmin(r.admin), (e) => {
      if (e instanceof ApiError && e.status === 0) return; // offline: keep trying on the next visit
      router.replace("/login");
    });
  }, [router]);

  const signedOut = () => router.replace("/login");
  const signOut = async () => { await logout().catch(() => {}); signedOut(); };

  if (!admin) return <main className="min-h-screen flex items-center justify-center"><p className="text-[14px] text-dim">Loading</p></main>;

  return (
    <AdminCtx.Provider value={{ admin, signedOut }}>
      <div className="min-h-screen lg:pl-[236px]">
        <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[236px] flex-col bg-side border-r border-rule px-3 py-4" aria-label="Sidebar">
          <div className="px-2 mb-6"><Brand /></div>
          <Nav path={path} />
        </aside>
        {open && (
          <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)}>
            <aside className="w-[260px] h-full bg-side border-r border-rule px-3 py-4" onClick={(e) => e.stopPropagation()} aria-label="Sidebar">
              <div className="px-2 mb-6 flex items-center justify-between"><Brand /><button onClick={() => setOpen(false)} aria-label="Close the menu" className="w-9 h-9 inline-flex items-center justify-center text-dim hover:text-paper"><X size={16} /></button></div>
              <Nav path={path} onPick={() => setOpen(false)} />
            </aside>
          </div>
        )}
        <header className="h-14 border-b border-rule flex items-center gap-3 px-4 sm:px-6">
          <button onClick={() => setOpen(true)} className="lg:hidden w-9 h-9 inline-flex items-center justify-center text-dim hover:text-paper" aria-label="Open the menu"><Menu size={17} /></button>
          <span className="lg:hidden"><Brand /></span>
          <span className="ml-auto text-[13px] text-dim truncate hidden sm:block" data-admin-email>{admin.email}</span>
          <button onClick={signOut} className="btn btn-ghost h-8 px-3 text-[13px] no-min">Sign out</button>
        </header>
        <div id="content">{children}</div>
      </div>
    </AdminCtx.Provider>
  );
}
