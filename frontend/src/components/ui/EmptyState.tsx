// vm_shell: what a page shows when there is nothing to list yet, or when
// something stands between the visitor and their content. Says what is
// going on and offers the one useful next step.
export function EmptyState({ title, children, action }: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-14 max-w-[46ch]">
      <h2 className="font-display text-[17px] text-paper leading-snug">{title}</h2>
      {children && <p className="text-[14px] text-dim mt-1.5 leading-relaxed">{children}</p>}
      {action && <div className="mt-5 flex items-center gap-2.5 flex-wrap">{action}</div>}
    </div>
  );
}
