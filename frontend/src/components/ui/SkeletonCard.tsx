export function SkeletonCard() {
  return (
    <div className="panel">
      <div className="aspect-video scan border-b border-rule" />
      <div className="h-5 scan m-3" />
      <div className="px-3 pb-3 space-y-2">
        <div className="h-4 scan w-3/4" />
        <div className="h-3 scan w-1/3" />
      </div>
    </div>
  );
}

export function SkeletonVideoPage() {
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5">
      <div className="space-y-4">
        <div className="aspect-video scan border border-rule" />
        <div className="h-24 scan border border-rule" />
        <div className="h-64 scan border border-rule" />
      </div>
      <div className="h-96 scan border border-rule" />
    </div>
  );
}
