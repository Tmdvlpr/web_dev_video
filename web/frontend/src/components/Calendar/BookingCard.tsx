import { motion } from "framer-motion";
import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCalendarDrag } from "../../contexts/CalendarDragContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useTelegram } from "../../hooks/useTelegram";
import type { Booking, User } from "../../types";

interface BookingCardProps {
  booking: Booking;
  topPercent: number;
  heightPercent: number;
  currentUser: User | null;
  onClick: () => void;
}

// Light — saturated tinted cards that pop against white background
const LIGHT_PALETTES = [
  { bg: "#ede9fe", border: "#7c3aed", text: "#3b0764", accent: "#6d28d9", tint: "rgba(109,40,217,0.08)" },
  { bg: "#dbeafe", border: "#2563eb", text: "#1e3a8a", accent: "#1d4ed8", tint: "rgba(29,78,216,0.07)" },
  { bg: "#d1fae5", border: "#059669", text: "#064e3b", accent: "#047857", tint: "rgba(4,120,87,0.07)" },
  { bg: "#fef3c7", border: "#d97706", text: "#78350f", accent: "#b45309", tint: "rgba(180,83,9,0.07)" },
  { bg: "#fee2e2", border: "#dc2626", text: "#7f1d1d", accent: "#b91c1c", tint: "rgba(185,28,28,0.07)" },
  { bg: "#fce7f3", border: "#be185d", text: "#500724", accent: "#9d174d", tint: "rgba(157,23,77,0.07)" },
  { bg: "#e0e7ff", border: "#4338ca", text: "#1e1b4b", accent: "#3730a3", tint: "rgba(55,48,163,0.07)" },
  { bg: "#ffedd5", border: "#ea580c", text: "#7c2d12", accent: "#c2410c", tint: "rgba(194,65,12,0.07)" },
];

// Dark — vivid neon glow cards
const DARK_PALETTES = [
  { bg: "rgba(139,92,246,0.16)", border: "#a78bfa", text: "#ede9fe", accent: "#c4b5fd", tint: "rgba(167,139,250,0.08)" },
  { bg: "rgba(59,130,246,0.14)", border: "#60a5fa", text: "#dbeafe", accent: "#93c5fd", tint: "rgba(96,165,250,0.07)" },
  { bg: "rgba(16,185,129,0.14)", border: "#34d399", text: "#d1fae5", accent: "#6ee7b7", tint: "rgba(52,211,153,0.07)" },
  { bg: "rgba(245,158,11,0.14)", border: "#fbbf24", text: "#fef3c7", accent: "#fcd34d", tint: "rgba(251,191,36,0.07)" },
  { bg: "rgba(239,68,68,0.14)",  border: "#f87171", text: "#fee2e2", accent: "#fca5a5", tint: "rgba(248,113,113,0.07)" },
  { bg: "rgba(236,72,153,0.14)", border: "#f472b6", text: "#fce7f3", accent: "#f9a8d4", tint: "rgba(244,114,182,0.07)" },
  { bg: "rgba(99,102,241,0.14)", border: "#818cf8", text: "#e0e7ff", accent: "#a5b4fc", tint: "rgba(129,140,248,0.07)" },
  { bg: "rgba(251,146,60,0.14)", border: "#fb923c", text: "#ffedd5", accent: "#fdba74", tint: "rgba(251,146,60,0.07)" },
];

export const BookingCard = memo(function BookingCard({ booking, topPercent, heightPercent, currentUser, onClick }: BookingCardProps) {
  const { isDark } = useTheme();
  const { setDrag } = useCalendarDrag();
  const navigate = useNavigate();
  const { isMiniApp } = useTelegram();
  const [isDragging, setIsDragging] = useState(false);

  const isInMeetingWindow = (() => {
    const now = Date.now();
    const start = new Date(booking.start_time).getTime();
    const end = new Date(booking.end_time).getTime();
    return now >= start - 10 * 60_000 && now <= end + 2 * 3_600_000;
  })();

  const handleJoinVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMiniApp) {
      const url = `${window.location.origin}/meeting/${booking.id}`;
      (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string, opts?: object) => void } } })
        .Telegram?.WebApp?.openLink?.(url, { try_instant_view: false });
    } else {
      navigate(`/meeting/${booking.id}`);
    }
  };
  const isRedacted = booking.user_id === 0;
  const palettes = isDark ? DARK_PALETTES : LIGHT_PALETTES;
  const p = palettes[booking.user_id % palettes.length];
  const isShort    = heightPercent < 6;
  const canDrag    = !isRedacted && !!currentUser && (currentUser.id === booking.user_id || currentUser.role === "admin" || currentUser.role === "superadmin");

  const shadow = isDark
    ? `0 0 0 1px ${p.border}50, 0 4px 20px ${p.accent}30, inset 0 1px 0 rgba(255,255,255,0.07)`
    : `0 1px 0 ${p.border}40, 0 2px 8px ${p.border}30`;

  const handleDragStart = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetFraction = (e.clientY - rect.top) / rect.height;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("bookingId", String(booking.id));
    // Transparent drag image — removes browser ghost flash, our DayColumn ghost handles visuals
    const blank = document.createElement("div");
    blank.style.cssText = "position:fixed;pointer-events:none;opacity:0;width:1px;height:1px";
    document.body.appendChild(blank);
    e.dataTransfer.setDragImage(blank, 0, 0);
    requestAnimationFrame(() => { blank.remove(); setIsDragging(true); });
    setDrag({ booking, offsetFraction });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDrag(null);
  };

  if (isRedacted) {
    const greyBg = isDark ? "rgba(128,128,128,0.15)" : "rgba(0,0,0,0.05)";
    const greyBorder = isDark ? "rgba(148,163,184,0.35)" : "rgba(100,116,139,0.3)";
    const greyText = isDark ? "#94a3b8" : "#64748b";
    return (
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.97 }}
        transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{
          position: "absolute",
          top: `${topPercent}%`,
          height: `${heightPercent}%`,
          left: 4, right: 4,
          background: greyBg,
          borderTop: `1px solid ${greyBorder}`,
          borderRight: `1px solid ${greyBorder}`,
          borderBottom: `1px solid ${greyBorder}`,
          borderLeft: `3px solid ${greyBorder}`,
          borderRadius: 10,
          cursor: "default",
          overflow: "hidden",
        }}
        className={`px-2 ${isShort ? "py-0 flex items-center" : "py-1"}`}
      >
        {isShort ? (
          <p className="text-xs font-bold truncate leading-none w-full" style={{ color: greyText }}>
            Занято
          </p>
        ) : (
          <div className="h-full flex flex-col gap-0.5">
            <p className="text-xs font-bold truncate" style={{ color: greyText }}>Занято</p>
            <p className="text-xs truncate" style={{ color: greyText, opacity: 0.7 }}>
              {new Date(booking.start_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              {" – "}
              {new Date(booking.end_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      whileHover={{ scale: canDrag ? 1.015 : 1.02, zIndex: 10 }}
      draggable={canDrag}
      onDragStartCapture={canDrag ? handleDragStart : undefined}
      onDragEndCapture={canDrag ? handleDragEnd : undefined}
      style={{
        position: "absolute",
        top: `${topPercent}%`,
        height: `${heightPercent}%`,
        left: 4, right: 4,
        background: p.bg,
        borderTop: `1px solid ${p.border}28`,
        borderRight: `1px solid ${p.border}28`,
        borderBottom: `1px solid ${p.border}28`,
        borderLeft: `3px solid ${p.border}`,
        borderRadius: 10,
        cursor: canDrag ? "grab" : "pointer",
        overflow: "hidden",
        opacity: isDragging ? 0.3 : 1,
        boxShadow: shadow,
        backdropFilter: isDark ? "blur(8px)" : "none",
      }}
      className={`px-2 ${isShort ? "py-0 flex items-center" : "py-1"}`}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: p.tint }} />

      {isShort ? (
        <p className="text-xs font-bold truncate leading-none relative z-10 w-full" style={{ color: p.text }}>
          {booking.title}
        </p>
      ) : (
        <div className="h-full flex flex-col gap-0.5 relative z-10">
          <div className="flex items-center gap-1">
            <p className="text-xs font-bold truncate flex-1" style={{ color: p.text }}>{booking.title}</p>
            <div className="flex items-center gap-0.5 shrink-0">
              {booking.recurrence !== "none" && (
                <span className="text-xs font-semibold px-1 rounded" style={{ background: `${p.border}20`, color: p.accent }}>🔄</span>
              )}
              {booking.guests?.length ? (
                <span className="text-xs font-semibold px-1 rounded" style={{ background: `${p.border}20`, color: p.accent }}>
                  👥{booking.guests.length}
                </span>
              ) : null}
              {booking.video_enabled && (
                <button
                  onClick={handleJoinVideo}
                  disabled={!isInMeetingWindow}
                  title={isInMeetingWindow ? "Подключиться к встрече" : "Доступно за 10 мин до начала"}
                  className="text-xs px-1 rounded transition-opacity disabled:opacity-30"
                  style={{ background: `${p.border}25`, color: p.accent }}
                >
                  🎥
                </button>
              )}
            </div>
          </div>
          <p className="text-xs truncate" style={{ color: `${p.text}99` }}>{booking.user.display_name}</p>
        </div>
      )}
    </motion.div>
  );
});
