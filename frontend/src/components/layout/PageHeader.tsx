// vm_shell: the title row at the top of a workspace page.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({ title, description, actions, back }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="section pt-6 lg:pt-8 pb-6">
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 -ml-1 mb-3 text-[13px] text-dim hover:text-paper transition-colors"
        >
          <ChevronLeft size={14} /> {back.label}
        </Link>
      )}
      <div className="flex items-end justify-between gap-x-6 gap-y-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] sm:text-[24px] leading-[1.2] text-paper">{title}</h1>
          {description && (
            <p className="text-[14px] text-dim mt-1.5 max-w-[64ch] leading-relaxed">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </header>
  );
}
