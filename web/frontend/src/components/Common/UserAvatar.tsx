interface Props {
  displayName: string;
  avatar?: string | null;
  size?: number;
  onClick?: () => void;
  className?: string;
}

export function UserAvatar({ displayName, avatar, size = 24, onClick, className = "" }: Props) {
  const cursor = onClick ? "cursor-pointer" : "";

  if (avatar) {
    return (
      <img
        src={avatar}
        alt={displayName}
        onClick={onClick}
        className={`rounded-full object-cover shrink-0 ${cursor} ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      onClick={onClick}
      className={`rounded-full flex items-center justify-center font-bold text-white shrink-0 ${cursor} ${className}`}
      style={{ width: size, height: size, background: "var(--primary)", fontSize: Math.max(Math.round(size * 0.42), 9) }}
    >
      {displayName?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}
