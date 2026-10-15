// vm_admin: the frame of the signed out pages (sign in, setup, reset).
import Link from "next/link";

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M2 3h12L8 14z" fill="var(--signal)" /></svg>
      <span className="font-display text-[15px] text-paper">VideoMind</span>
      <span className="text-[12px] text-dim border border-rule rounded-full px-2 py-0.5">Admin</span>
    </span>
  );
}

export function AuthCard({ title, intro, children, wide }: { title: string; intro?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-5 sm:px-8 h-14 flex items-center border-b border-rule"><Link href="/login" className="no-min"><Brand /></Link></header>
      <div className="flex-1 flex items-start justify-center px-4 py-10 sm:py-16">
        <section className={`w-full ${wide ? "max-w-[560px]" : "max-w-[400px]"} panel p-6 sm:p-7`} aria-label={title}>
          <h1 className="font-display text-[20px] text-paper">{title}</h1>
          {intro && <div className="text-[13.5px] text-dim mt-1.5 leading-relaxed">{intro}</div>}
          <div className="mt-6">{children}</div>
        </section>
      </div>
      <footer className="px-5 sm:px-8 py-5 text-[12px] text-dim-2">For VideoMind administrators only. Every sign in and action is recorded.</footer>
    </main>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="block text-[13px] text-paper-2">{label}</span>
        {children}
      </label>
      {hint && <p className="text-[12.5px] text-dim leading-relaxed">{hint}</p>}
    </div>
  );
}

export const inputCls = "w-full h-10 px-3 text-[14px]";

export function Note({ kind, children }: { kind: "error" | "ok" | "info"; children: React.ReactNode }) {
  const color = kind === "error" ? "border-error/50 text-error" : kind === "ok" ? "border-marker-dim text-marker" : "border-rule text-paper-2";
  return <p role={kind === "error" ? "alert" : "status"} className={`text-[13.5px] leading-relaxed border rounded px-3 py-2.5 ${color}`}>{children}</p>;
}
