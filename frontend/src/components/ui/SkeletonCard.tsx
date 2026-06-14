// src/components/ui/SkeletonCard.tsx
export function SkeletonCard() {
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="aspect-video bg-dark-700 shimmer" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-dark-700 rounded shimmer w-3/4" />
        <div className="h-3 bg-dark-700 rounded shimmer w-1/2" />
        <div className="flex gap-2 pt-1">
          <div className="h-5 w-12 bg-dark-700 rounded shimmer" />
          <div className="h-5 w-16 bg-dark-700 rounded shimmer" />
          <div className="h-5 w-10 bg-dark-700 rounded shimmer" />
        </div>
        <div className="h-px bg-dark-700/60 w-full mt-1" />
        <div className="flex justify-between">
          <div className="h-3 bg-dark-700 rounded shimmer w-24" />
          <div className="h-3 bg-dark-700 rounded shimmer w-12" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonVideoPage() {
  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-6">
      <div className="space-y-6">
        <div className="aspect-video bg-dark-800 rounded-2xl shimmer" />
        <div className="flex gap-2">
          {[80, 60, 100, 70].map((w, i) => (
            <div key={i} className="h-6 bg-dark-700 rounded-full shimmer" style={{ width: w }} />
          ))}
        </div>
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="h-4 bg-dark-700 rounded shimmer w-full" />
          <div className="h-4 bg-dark-700 rounded shimmer w-5/6" />
          <div className="h-4 bg-dark-700 rounded shimmer w-4/6" />
        </div>
      </div>
      <div className="glass-card rounded-2xl h-96 lg:h-auto shimmer" />
    </div>
  );
}
