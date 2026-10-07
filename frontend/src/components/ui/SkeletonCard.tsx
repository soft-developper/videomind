export function SkeletonCard() {
  return (
    <div>
      <div className="aspect-video scan rounded-md" />
      <div className="h-[3px] mt-2 rounded-full bg-rule" />
      <div className="pt-3 space-y-2">
        <div className="h-4 scan w-4/5" />
        <div className="h-3 scan w-2/5" />
      </div>
    </div>
  );
}

export function SkeletonVideoPage() {
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5">
      <div className="space-y-4">
        <div className="aspect-video scan rounded-md" />
        <div className="h-24 scan rounded-md" />
        <div className="h-64 scan rounded-md" />
      </div>
      <div className="h-96 scan rounded-md" />
    </div>
  );
}
