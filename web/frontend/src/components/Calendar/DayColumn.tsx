import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { activeDragRef, suppressCardClickRef, useCalendarDrag } from "../../contexts/CalendarDragContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import type { Booking, SlotResponse, User } from "../../types";
import { BookingCard } from "./BookingCard";
import { HOUR_HEIGHT_PX, DAY_START_HOUR, DAY_END_HOUR, TOTAL_HOURS } from "./index";

interface DayColumnProps {
  date: Date;
  bookings: Booking[];
  freeSlots?: SlotResponse[];
  currentUser: User | null;
  onSlotClick: (start: Date, end: Date) => void;
  onCardClick: (booking: Booking) => void;
  onBookingDrop?: (booking: Booking, newStart: Date) => void;
  onBookingResize?: (booking: Booking, newEnd: Date) => void;
  isToday: boolean;
}

function timeToPercent(date: Date): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  return ((hours - DAY_START_HOUR) / TOTAL_HOURS) * 100;
}

function nowPercent(): number {
  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;
  if (hours < DAY_START_HOUR || hours > DAY_END_HOUR) return -1;
  return ((hours - DAY_START_HOUR) / TOTAL_HOURS) * 100;
}

// Sun-indexed (getDay() returns 0=Sun)
const DOW_LONG_KEYS = [
  "cal.dow.sun.long", "cal.dow.mon.long", "cal.dow.tue.long", "cal.dow.wed.long",
  "cal.dow.thu.long", "cal.dow.fri.long", "cal.dow.sat.long",
] as const;

export function DayColumn({ date, bookings, freeSlots = [], currentUser, onSlotClick, onCardClick, onBookingDrop, onBookingResize, isToday }: DayColumnProps) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const { drag, setDrag } = useCalendarDrag();
  const gridRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const ghostTitleRef = useRef<HTMLSpanElement>(null);
  const ghostLabelRef = useRef<HTMLSpanElement>(null);
  const dayName = t(DOW_LONG_KEYS[date.getDay()]);
  const dayNum  = date.getDate();
  const isPast  = date < new Date(new Date().setHours(0, 0, 0, 0));
  const [nowPct, setNowPct] = useState(() => nowPercent());
  const [hoverSlot, setHoverSlot] = useState<{ startPct: number; heightPct: number; label: string } | null>(null);
  const resizingRef = useRef<{ booking: Booking } | null>(null);
  const [resizingBooking, setResizingBooking] = useState<Booking | null>(null);
  const [resizePreview, setResizePreview] = useState<{ topPct: number; heightPct: number; endLabel: string } | null>(null);

  const computeResize = (clientY: number): { finalEnd: number } | null => {
    if (!resizingRef.current || !gridRef.current) return null;
    const booking = resizingRef.current.booking;
    const rect = gridRef.current.getBoundingClientRect();
    const fraction = (clientY - rect.top) / rect.height;
    const totalMinutes = TOTAL_HOURS * 60;
    const rawEndMinute = DAY_START_HOUR * 60 + fraction * totalMinutes;
    const snappedEnd = Math.round(rawEndMinute / 15) * 15;
    const startDate = new Date(booking.start_time);
    const bookingStartMinute = startDate.getHours() * 60 + startDate.getMinutes();
    const minEndMinute = bookingStartMinute + 15;
    const maxEndMinute = (() => {
      const next = bookings
        .filter(b => b.id !== booking.id)
        .filter(b => {
          const s = new Date(b.start_time);
          return (s.getHours() * 60 + s.getMinutes()) > bookingStartMinute;
        })
        .sort((a, b2) => new Date(a.start_time).getTime() - new Date(b2.start_time).getTime())[0];
      if (!next) return DAY_END_HOUR * 60;
      const ns = new Date(next.start_time);
      return ns.getHours() * 60 + ns.getMinutes();
    })();
    const finalEnd = Math.max(minEndMinute, Math.min(maxEndMinute, snappedEnd));
    const topPct = ((bookingStartMinute - DAY_START_HOUR * 60) / totalMinutes) * 100;
    const endTopPct = ((finalEnd - DAY_START_HOUR * 60) / totalMinutes) * 100;
    const heightPct = endTopPct - topPct;
    const eh = Math.floor(finalEnd / 60), em = finalEnd % 60;
    setResizePreview({ topPct, heightPct, endLabel: `${String(eh).padStart(2,"0")}:${String(em).padStart(2,"0")}` });
    return { finalEnd };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => { computeResize(e.clientY); };
    const onUp = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      suppressCardClickRef.current = true;
      setTimeout(() => { suppressCardClickRef.current = false; }, 300);
      const result = computeResize(e.clientY);
      if (result && onBookingResize) {
        const newEnd = new Date(date);
        newEnd.setHours(Math.floor(result.finalEnd / 60), result.finalEnd % 60, 0, 0);
        onBookingResize(resizingRef.current.booking, newEnd);
      }
      resizingRef.current = null;
      setResizingBooking(null);
      setResizePreview(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, bookings, onBookingResize]);

  function calcDrop(clientY: number): { topPct: number; heightPct: number; startMinute: number } | null {
    const d = drag ?? activeDragRef.current;
    if (!d || !gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const fraction = (clientY - rect.top) / rect.height;
    const durationMs = new Date(d.booking.end_time).getTime() - new Date(d.booking.start_time).getTime();
    const durationHours = durationMs / 3_600_000;
    const startFraction = fraction - (d.offsetFraction * durationHours / TOTAL_HOURS);
    const totalMinutes = TOTAL_HOURS * 60;
    const rawMinute = DAY_START_HOUR * 60 + startFraction * totalMinutes;
    const snapped = Math.round(rawMinute / 30) * 30;
    const maxStart = DAY_END_HOUR * 60 - Math.round(durationMs / 60_000);
    const startMinute = Math.max(DAY_START_HOUR * 60, Math.min(maxStart, snapped));
    const topPct = ((startMinute - DAY_START_HOUR * 60) / totalMinutes) * 100;
    const heightPct = (durationHours / TOTAL_HOURS) * 100;
    return { topPct, heightPct, startMinute };
  }

  const handleDragOver = (e: React.DragEvent) => {
    const activeDrag = drag ?? activeDragRef.current;
    if (isPast || !activeDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHoverSlot(null);
    const calc = calcDrop(e.clientY);
    if (!calc) return;
    const h = Math.floor(calc.startMinute / 60), m = calc.startMinute % 60;
    const durationMs = new Date(activeDrag.booking.end_time).getTime() - new Date(activeDrag.booking.start_time).getTime();
    const endMinute = calc.startMinute + Math.round(durationMs / 60_000);
    const eh = Math.floor(endMinute / 60), em = endMinute % 60;
    const label = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")} – ${String(eh).padStart(2,"0")}:${String(em).padStart(2,"0")}`;
    if (ghostRef.current) {
      ghostRef.current.style.display = "block";
      ghostRef.current.style.top = `${calc.topPct}%`;
      ghostRef.current.style.height = `${calc.heightPct}%`;
    }
    if (ghostTitleRef.current) ghostTitleRef.current.textContent = activeDrag.booking.title;
    if (ghostLabelRef.current) ghostLabelRef.current.textContent = label;
  };

  const hideGhost = () => { if (ghostRef.current) ghostRef.current.style.display = "none"; };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!gridRef.current?.contains(e.relatedTarget as Node)) hideGhost();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    hideGhost();
    const activeDrop = drag ?? activeDragRef.current;
    if (!activeDrop || isPast) return;
    suppressCardClickRef.current = true;
    setTimeout(() => { suppressCardClickRef.current = false; }, 300);
    const calc = calcDrop(e.clientY);
    if (!calc) return;
    const newStart = new Date(date);
    newStart.setHours(Math.floor(calc.startMinute / 60), calc.startMinute % 60, 0, 0);
    onBookingDrop?.(activeDrop.booking, newStart);
    setDrag(null);
  };

  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => setNowPct(nowPercent()), 60_000);
    return () => clearInterval(interval);
  }, [isToday]);

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressCardClickRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientY - rect.top) / rect.height;
    const totalMinutes = TOTAL_HOURS * 60;
    const clickedMinute = DAY_START_HOUR * 60 + Math.round(fraction * totalMinutes / 30) * 30;
    const start = new Date(date);
    start.setHours(Math.floor(clickedMinute / 60), clickedMinute % 60, 0, 0);
    const end = new Date(start.getTime() + 3_600_000);
    onSlotClick(start, end);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientY - rect.top) / rect.height;
    const totalMinutes = TOTAL_HOURS * 60;
    const rawMinute = DAY_START_HOUR * 60 + Math.round(fraction * totalMinutes / 30) * 30;
    const snappedFrac = (rawMinute - DAY_START_HOUR * 60) / totalMinutes;
    const endFrac = Math.min(1, snappedFrac + 60 / totalMinutes);
    const endMinute = rawMinute + 60;
    const label = `${String(Math.floor(rawMinute / 60)).padStart(2, "0")}:${String(rawMinute % 60).padStart(2, "0")} – ${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
    setHoverSlot({ startPct: snappedFrac * 100, heightPct: (endFrac - snappedFrac) * 100, label });
  };

  // Colors derived from theme
  const isWeekend       = date.getDay() === 0 || date.getDay() === 6;
  const todayHeaderBg   = "var(--day-header-today)";
  const headerBg        = "var(--day-header)";
  const todayNumStyle   = {
    background: "linear-gradient(135deg,#1565a8,#3b82f6)",
    color: "#fff",
    boxShadow: isDark ? "0 0 14px rgba(21,101,168,0.55)" : "0 2px 10px rgba(21,101,168,0.35)",
  };
  const pastNumColor    = isDark ? "#64748b" : "#c9cdd6";
  const normalNumColor  = isDark ? "#cbd5e1" : "#64748b";
  const gridBg          = isPast
    ? "var(--day-grid-past)"
    : isToday
      ? "var(--day-grid-today)"
      : isWeekend
        ? "var(--day-grid-weekend)"
        : "var(--day-grid)";
  const todayNameColor  = isDark ? "#5ba3df" : "#1565a8";
  const normalNameColor = isDark ? "#94a3b8" : "#64748b";

  return (
    <div className="flex flex-col min-w-0 relative h-full"
      style={{
        borderRight: "1px solid var(--border)",
        borderLeft: isToday ? "2px solid var(--primary)" : undefined,
      }}>
      {/* Header */}
      <div className="flex items-center justify-center gap-1.5 px-1 sticky top-0 z-10 select-none overflow-hidden"
        style={{
          height: 56,
          background: isToday ? todayHeaderBg : headerBg,
          borderBottom: `1px solid ${isToday ? "var(--primary-border)" : "var(--border)"}`,
          backdropFilter: "blur(8px)",
        }}>
        <div className="flex items-center justify-center shrink-0 w-7 h-7 rounded text-sm font-bold"
          style={isToday ? todayNumStyle : { color: isPast ? pastNumColor : normalNumColor }}>
          {dayNum}
        </div>
        <div className="text-xs font-semibold truncate"
          style={{ color: isToday ? todayNameColor : normalNameColor }}>
          {dayName}
        </div>
      </div>

      {/* Time grid */}
      <div
        ref={gridRef}
        className={`relative ${isPast ? "" : "cursor-crosshair"}`}
        style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT_PX}px`, background: gridBg }}
        onClick={isPast ? undefined : handleColumnClick}
        onMouseMove={!isPast ? handleMouseMove : undefined}
        onMouseLeave={() => setHoverSlot(null)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={hideGhost}
      >
        {/* Free slot highlights */}
        {!isPast && freeSlots.filter(s => s.available).map((slot, i) => {
          const startPct = timeToPercent(new Date(slot.start));
          const endPct = timeToPercent(new Date(slot.end));
          if (endPct <= startPct) return null;
          return (
            <div key={i} className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: `${startPct}%`,
                height: `${endPct - startPct}%`,
                background: isDark ? "rgba(34,197,94,0.04)" : "rgba(34,197,94,0.05)",
                borderLeft: "1.5px solid rgba(34,197,94,0.2)",
              }} />
          );
        })}

        {/* Hour lines */}
        {Array.from({ length: TOTAL_HOURS + 1 }).map((_, i) => (
          <div key={i} className="absolute left-0 right-0"
            style={{ top: `${(i / TOTAL_HOURS) * 100}%`, borderTop: "1px solid var(--hour-line)" }} />
        ))}
        {/* Half-hour lines */}
        {Array.from({ length: TOTAL_HOURS }).map((_, i) => (
          <div key={`h${i}`} className="absolute left-0 right-0"
            style={{ top: `${((i + 0.5) / TOTAL_HOURS) * 100}%`, borderTop: "1px dashed var(--hour-dash)" }} />
        ))}

        {/* Drag-and-drop ghost preview */}
        <div ref={ghostRef} className="absolute left-0 right-0 pointer-events-none z-30"
          style={{
            display: "none",
            background: isDark ? "rgba(21,101,168,0.25)" : "rgba(21,101,168,0.12)",
            border: "2px dashed var(--primary)",
            borderRadius: 6,
            backdropFilter: "blur(2px)",
          }}>
          <span ref={ghostTitleRef} className="absolute top-1 left-2 text-xs font-bold"
            style={{ color: "var(--primary)" }} />
          <span ref={ghostLabelRef} className="absolute bottom-1 left-2 text-xs font-semibold"
            style={{ color: "var(--primary)", opacity: 0.8 }} />
        </div>

        {/* Hover slot preview */}
        {!isPast && !activeDragRef.current && hoverSlot && (
          <div className="absolute left-0 right-0 pointer-events-none z-10"
            style={{
              top: `${hoverSlot.startPct}%`,
              height: `${hoverSlot.heightPct}%`,
              background: isDark ? "rgba(21,101,168,0.12)" : "rgba(21,101,168,0.07)",
              borderLeft: "2px solid var(--primary)",
              borderRadius: "0 4px 4px 0",
            }}>
            <span className="absolute top-0.5 left-1.5 text-xs font-semibold leading-tight"
              style={{ color: "var(--primary)", opacity: 0.85 }}>
              {hoverSlot.label}
            </span>
          </div>
        )}

        {/* Current time indicator */}
        {isToday && nowPct >= 0 && (
          <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${nowPct}%` }}>
            <div className="relative flex items-center">
              <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-2.5 h-2.5 rounded-full shrink-0 -ml-1.5"
                style={{ background: "#ef4444", boxShadow: "0 0 8px #ef4444" }}
              />
              <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg,#ef4444,transparent)", opacity: 0.7 }} />
            </div>
          </div>
        )}

        {/* Booking cards */}
        <AnimatePresence>
          {bookings.map((b) => {
            const top    = timeToPercent(new Date(b.start_time));
            const height = timeToPercent(new Date(b.end_time)) - top;
            if (height <= 0) return null;
            return (
              <BookingCard key={b.id} booking={b} topPercent={top} heightPercent={height}
                currentUser={currentUser} onClick={() => onCardClick(b)}
                isResizing={resizingBooking?.id === b.id}
                onResizeStart={(e) => { e.preventDefault(); resizingRef.current = { booking: b }; setResizingBooking(b); }} />
            );
          })}
        </AnimatePresence>

        {/* Resize preview */}
        {resizePreview && resizingBooking && (
          <div className="absolute pointer-events-none z-40"
            style={{
              top: `${resizePreview.topPct}%`,
              height: `${resizePreview.heightPct}%`,
              left: 4, right: 4,
              border: "2px solid var(--primary)",
              borderRadius: 6,
              background: isDark ? "rgba(21,101,168,0.18)" : "rgba(21,101,168,0.10)",
              padding: "4px 8px",
              overflow: "hidden",
            }}>
            <p className="text-xs font-bold truncate m-0" style={{ color: "var(--primary)" }}>
              {resizingBooking.title}
            </p>
            <p className="text-xs m-0" style={{ color: "var(--primary)", opacity: 0.75 }}>
              {new Date(resizingBooking.start_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              {" – "}
              {resizePreview.endLabel}
            </p>
          </div>
        )}
      </div>
      {/* Filler to eliminate whitespace below the time grid */}
      <div className="flex-1" style={{ background: gridBg }} />
    </div>
  );
}
