interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className = "", style }: SkeletonProps) {
  return (
    <div
      className={`rounded-lg animate-pulse ${className}`}
      style={{ background: "var(--skeleton, rgba(148,163,184,0.12))", ...style }}
    />
  );
}

export function BookingCardSkeleton() {
  return (
    <div className="absolute left-1 right-1 rounded-xl overflow-hidden" style={{ height: "60px", top: "10%" }}>
      <Skeleton className="w-full h-full" />
    </div>
  );
}

export function MeetingListSkeleton() {
  return (
    <div className="space-y-3 px-4 py-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl p-3.5" style={{ border: "1px solid var(--border)" }}>
          <div className="flex items-start justify-between mb-2">
            <Skeleton className="h-4 rounded" style={{ width: "60%" }} />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 rounded mb-1.5" style={{ width: "40%" }} />
          <div className="flex items-center gap-1.5">
            <Skeleton className="w-5 h-5 rounded-full" />
            <Skeleton className="h-3 rounded" style={{ width: "30%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
