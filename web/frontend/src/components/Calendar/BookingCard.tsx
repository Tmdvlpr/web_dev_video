import { motion } from "framer-motion";
import { memo, useEffect, useRef, useState } from "react";
import { suppressCardClickRef, useCalendarDrag } from "../../contexts/CalendarDragContext";
import { useTheme } from "../../contexts/ThemeContext";
import type { Booking, User } from "../../types";

interface BookingCardProps {
  booking: Booking;
  topPercent: number;
  heightPercent: number;
  currentUser: User | null;
  onClick: () => void;
  isResizing?: boolean;
  onResizeStart?: (e: React.MouseEvent) => void;
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

export const BookingCard = memo(function BookingCard({ booking, topPercent, heightPercent, currentUser, onClick, isResizing, onResizeStart }: BookingCardProps) {
  const { isDark } = useTheme();
  const { setDrag } = useCalendarDrag();
  const [isDragging, setIsDragging] = useState(false);
  const suppressClickRef = useRef(false);
  const wasResizingRef   = useRef(false);

  const isRedacted = booking.user_id === 0;
  const palettes = isDark ? DARK_PALETTES : LIGHT_PALETTES;
  const p = palettes[booking.user_id % palettes.length];
  const isShort    = heightPercent < 6;
  const canDrag    = !isRedacted && !!currentUser && (currentUser.id === booking.user_id || currentUser.role === "admin" || currentUser.role === "superadmin");

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
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 300);
  };

  useEffect(() => {
    if (isResizing) {
      wasResizingRef.current = true;
    } else if (wasResizingRef.current) {
      wasResizingRef.current = false;
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 300);
    }
  }, [isResizing]);

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
          borderRadius: 4,
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

  const bookingType = booking.booking_type ?? "physical";
  const isVirtual = bookingType === "virtual";
  const isHybrid  = bookingType === "hybrid";

  // Type-specific palette overrides (fixed regardless of user colour)
  const typeOverride = isVirtual
    ? isDark
      ? { bg: "rgba(14,165,233,0.15)", border: "#38bdf8", text: "#e0f2fe", tint: "rgba(56,189,248,0.07)" }
      : { bg: "#e0f7ff", border: "#0ea5e9", text: "#0c4a6e", tint: "rgba(14,165,233,0.08)" }
    : isHybrid
    ? isDark
      ? { bg: "rgba(99,102,241,0.16)", border: "#818cf8", text: "#e0e7ff", tint: "rgba(129,140,248,0.08)" }
      : { bg: "#ede9fe", border: "#6366f1", text: "#1e1b4b", tint: "rgba(99,102,241,0.08)" }
    : null;

  const cp = typeOverride ?? p;
  const leftBorderColor = cp.border;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      onClick={(e) => { e.stopPropagation(); if (!suppressClickRef.current && !suppressCardClickRef.current) onClick(); }}
      whileHover={{ scale: canDrag ? 1.015 : 1.02, zIndex: 10 }}
      draggable={canDrag}
      onDragStartCapture={canDrag ? handleDragStart : undefined}
      onDragEndCapture={canDrag ? handleDragEnd : undefined}
      style={{
        position: "absolute",
        top: `${topPercent}%`,
        height: `${heightPercent}%`,
        left: 4, right: 4,
        background: cp.bg,
        borderTop: `1px solid ${cp.border}28`,
        borderRight: `1px solid ${cp.border}28`,
        borderBottom: `1px solid ${cp.border}28`,
        borderLeft: `3px solid ${leftBorderColor}`,
        borderRadius: 4,
        cursor: canDrag ? "grab" : "pointer",
        overflow: "hidden",
        opacity: isDragging ? 0.3 : isResizing ? 0 : 1,
      }}
      className={`px-2 ${isShort ? "py-0 flex items-center" : "py-1"}`}
    >

      {isShort ? (
        <div className="flex items-center gap-1 w-full relative z-10">
          {isVirtual && <span style={{ fontSize: 9, flexShrink: 0 }}>🖥</span>}
          {isHybrid  && <span style={{ fontSize: 9, flexShrink: 0 }}>🔀</span>}
          <p className="text-xs font-bold truncate leading-none" style={{ color: cp.text }}>{booking.title}</p>
        </div>
      ) : (
        <div className="h-full flex flex-col gap-0.5 relative z-10">
          <div className="flex items-center gap-1">
            {isVirtual && <span style={{ fontSize: 10, flexShrink: 0, lineHeight: 1 }}>🖥</span>}
            {isHybrid  && <span style={{ fontSize: 10, flexShrink: 0, lineHeight: 1 }}>🔀</span>}
            <p className="text-xs font-bold truncate flex-1" style={{ color: cp.text }}>{booking.title}</p>
          </div>
          <p className="text-xs truncate" style={{ color: `${cp.text}99` }}>{booking.user.display_name}</p>
        </div>
      )}
      {canDrag && !isShort && onResizeStart && (
        <div
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onResizeStart(e); }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          style={{
            position: "absolute",
            bottom: 0, left: 0, right: 0,
            height: 7,
            cursor: "ns-resize",
            borderRadius: "0 0 4px 4px",
            background: `linear-gradient(to bottom, transparent, ${cp.border}50)`,
            zIndex: 20,
          }}
        />
      )}
    </motion.div>
  );
});
