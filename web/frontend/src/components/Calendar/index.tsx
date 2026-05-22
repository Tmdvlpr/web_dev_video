import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarDragProvider } from "../../contexts/CalendarDragContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useBookings, useSlots, useUpdateBooking } from "../../hooks/useBookings";
import { bookingsApi } from "../../api/bookings";
import { roomsApi } from "../../api/rooms";
import type { Booking, SlotResponse, User } from "../../types";
import { DayColumn } from "./DayColumn";
import { InteractiveStripe } from "../Common/InteractiveStripe";

interface CalendarProps {
  currentUser: User | null;
  onSlotClick: (start: Date, end: Date) => void;
  onCardClick: (booking: Booking) => void;
}

interface DayContainerProps {
  date: Date;
  dateStr: string;
  currentUser: User | null;
  onSlotClick: (start: Date, end: Date) => void;
  onCardClick: (booking: Booking) => void;
  isToday: boolean;
  searchQuery: string;
  workspaceId?: number;
  roomId?: number | null;
}

function DayContainer({ date, dateStr, currentUser, onSlotClick, onCardClick, isToday, searchQuery, workspaceId, roomId }: DayContainerProps) {
  const { data: bookings = [] } = useBookings(dateStr, workspaceId);
  const { data: slots = [] } = useSlots(dateStr);
  const { mutate: updateBooking } = useUpdateBooking();

  const handleBookingDrop = (booking: Booking, newStart: Date) => {
    const durationMs = new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime();
    const newEnd = new Date(newStart.getTime() + durationMs);
    updateBooking({ id: booking.id, payload: { start_time: newStart.toISOString(), end_time: newEnd.toISOString() } });
  };

  const byRoom = roomId ? (bookings as Booking[]).filter((b) => b.room_id === roomId) : bookings as Booking[];
  const filtered = searchQuery
    ? byRoom.filter((b) =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.user.display_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : byRoom;
  return (
    <DayColumn date={date} bookings={filtered} freeSlots={slots as SlotResponse[]} currentUser={currentUser}
      onSlotClick={onSlotClick} onCardClick={onCardClick} onBookingDrop={handleBookingDrop} isToday={isToday} />
  );
}


function getMonthDays(anchor: Date): Date[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const start = new Date(firstDay);
  const dow = firstDay.getDay();
  start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1));
  const end = new Date(lastDay);
  const edow = lastDay.getDay();
  end.setDate(end.getDate() + (edow === 0 ? 0 : 7 - edow));
  const days: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
  return days;
}

function toISODate(d: Date): string { return d.toISOString().split("T")[0]; }
function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const BOOKING_COLORS = ["#7c3aed", "#0284c7", "#059669", "#d97706", "#dc2626", "#db2777"];
function hashColor(id: number) { return BOOKING_COLORS[id % BOOKING_COLORS.length]; }

const MONTH_DOW_KEYS = [
  "cal.dow.mon", "cal.dow.tue", "cal.dow.wed", "cal.dow.thu",
  "cal.dow.fri", "cal.dow.sat", "cal.dow.sun",
] as const;

export const HOUR_HEIGHT_PX  = 64;
export const DAY_START_HOUR  = 7;
export const DAY_END_HOUR    = 22;
export const TOTAL_HOURS     = DAY_END_HOUR - DAY_START_HOUR;
export const HOURS           = Array.from({ length: TOTAL_HOURS }, (_, i) => i + DAY_START_HOUR);

/* ── Month view cell ── */
interface MonthDayCellProps {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  onNavigate: (date: Date) => void;
  onCardClick: (booking: Booking) => void;
  searchQuery: string;
}

function MonthDayCell({ date, isCurrentMonth, isToday, onNavigate, onCardClick, searchQuery }: MonthDayCellProps) {
  const { t } = useLocale();
  const today = new Date();
  const isPast = toLocalDate(date) < toLocalDate(today);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const dateStr = toLocalDate(date);
  const { data: rawBookings = [] } = useBookings(dateStr);

  const bookings = (searchQuery
    ? (rawBookings as Booking[]).filter(b =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.user.display_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : rawBookings as Booking[]);
  const visible = bookings.slice(0, 3);
  const overflow = bookings.length - 3;

  const bg = isToday
    ? "var(--day-grid-today)"
    : isWeekend ? "var(--day-grid-weekend)"
    : isPast ? "var(--day-grid-past)"
    : "var(--day-grid)";

  return (
    <div
      onClick={() => onNavigate(date)}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.filter = "brightness(0.965)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.filter = ""; }}
      style={{
        padding: "8px 10px 6px",
        minHeight: 100,
        cursor: "pointer",
        background: bg,
        opacity: isCurrentMonth ? 1 : 0.38,
        borderRight: "1px solid var(--border-light)",
        borderBottom: "1px solid var(--border-light)",
        display: "flex", flexDirection: "column", gap: 3,
        transition: "background 0.12s ease",
      }}
    >
      {/* Day number — top right */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 11,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, fontWeight: isToday ? 800 : 600,
          background: isToday ? "var(--primary)" : "transparent",
          color: isToday ? "#fff"
            : isWeekend ? "var(--danger)"
            : !isCurrentMonth || isPast ? "var(--text-muted)"
            : "var(--text)",
          userSelect: "none",
          letterSpacing: "-0.01em",
          boxShadow: isToday ? "0 2px 8px rgba(109,40,217,0.35)" : undefined,
        }}>
          {date.getDate()}
        </div>
      </div>

      {/* Events */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {visible.map(b => (
          <div
            key={b.id}
            onClick={e => { e.stopPropagation(); onCardClick(b); }}
            title={b.title}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              borderRadius: 5,
              padding: "2px 6px 2px 4px",
              background: hashColor(b.id) + "18",
              borderLeft: `3px solid ${hashColor(b.id)}`,
              overflow: "hidden",
              cursor: "pointer",
              transition: "background 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = hashColor(b.id) + "30"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = hashColor(b.id) + "18"; }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, color: hashColor(b.id), flexShrink: 0, letterSpacing: "-0.01em" }}>
              {new Date(b.start_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {b.title}
            </span>
          </div>
        ))}
        {overflow > 0 && (
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--primary)", paddingLeft: 7 }}>
            {t("cal.moreEvents", { n: overflow })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Month view ── */
interface MonthViewProps {
  anchorDate: Date;
  today: Date;
  onNavigate: (date: Date) => void;
  onCardClick: (booking: Booking) => void;
  searchQuery: string;
  onPrev: () => void;
  onNext: () => void;
  direction: 1 | -1;
}

function MonthView({ anchorDate, today, onNavigate, onCardClick, searchQuery, onPrev, onNext, direction }: MonthViewProps) {
  const { t } = useLocale();
  const days = getMonthDays(anchorDate);
  const currentMonth = anchorDate.getMonth();
  const wheelLock = useRef(false);
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    if (wheelLock.current) return;
    wheelLock.current = true;
    if (e.deltaY > 0) onNext(); else onPrev();
    if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    wheelTimeoutRef.current = setTimeout(() => { wheelLock.current = false; }, 600);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden" onWheel={handleWheel}>
      {/* Day-of-week header */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        borderBottom: "2px solid var(--border)",
        background: "var(--toolbar)", backdropFilter: "blur(12px)", flexShrink: 0,
      }}>
        {MONTH_DOW_KEYS.map((key, i) => (
          <div key={key} style={{
            textAlign: "center", padding: "10px 0",
            fontSize: 11, fontWeight: 800,
            color: i >= 5 ? "var(--danger)" : "var(--text-muted)",
            textTransform: "uppercase", letterSpacing: "0.1em",
            userSelect: "none",
          }}>
            {t(key)}
          </div>
        ))}
      </div>
      {/* Cells */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.div
            key={anchorDate.getFullYear() + "-" + anchorDate.getMonth()}
            custom={direction}
            initial={{ x: direction * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction * -60, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            style={{
              display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
              height: "100%", overflowY: "auto",
              borderLeft: "1px solid var(--border-light)",
              borderTop: "1px solid var(--border-light)",
            }}
          >
            {days.map(day => (
              <MonthDayCell
                key={toISODate(day)}
                date={day}
                isCurrentMonth={day.getMonth() === currentMonth}
                isToday={toLocalDate(day) === toLocalDate(today)}
                onNavigate={onNavigate}
                onCardClick={onCardClick}
                searchQuery={searchQuery}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Workspace picker ── */
function WorkspacePicker({ onRoomReset }: { onRoomReset: () => void }) {
  const { workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (workspaces.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{ background: open ? "var(--elevated)" : "transparent", color: open ? "var(--text)" : "var(--text-muted)", border: `1px solid ${open ? "var(--border)" : "transparent"}` }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; } }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span style={{ maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeWorkspace?.name ?? "Пространство"}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-xl py-1" style={{ minWidth: 160, background: "var(--card)", border: "1px solid var(--border)" }}>
          {workspaces.map(ws => (
            <button key={ws.id} onClick={() => { setActiveWorkspaceId(ws.id); onRoomReset(); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs font-medium transition-all"
              style={{ background: ws.id === activeWorkspace?.id ? "var(--primary-light)" : "transparent", color: ws.id === activeWorkspace?.id ? "var(--primary)" : "var(--text)" }}>
              {ws.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Room picker ── */
function RoomPicker({ activeRoomId, onRoomChange }: { activeRoomId: number | null; onRoomChange: (id: number | null) => void }) {
  const { myRooms, activeWorkspace, refetchRooms } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joinInfo, setJoinInfo] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const rooms = myRooms.filter(r => r.workspace_id === activeWorkspace?.id);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleJoin = async () => {
    if (!activeWorkspace || !joinCode.trim()) return;
    setJoinErr(null); setJoinInfo(null); setJoinBusy(true);
    try {
      const result = await roomsApi.join(joinCode.trim(), activeWorkspace.id);
      if (result.status === 201) {
        refetchRooms();
        setJoinCode(""); setJoining(false);
      } else if (result.status === 202) {
        setJoinCode("");
        setJoinInfo("⏳ Заявка отправлена. Ждём подтверждения от владельца комнаты.");
      }
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number; data?: { detail?: string } } })?.response?.status;
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (status === 403) {
        setJoinErr("❌ Подключение по коду отключено для этой комнаты.");
      } else {
        setJoinErr(msg ?? "Комната не найдена");
      }
    } finally { setJoinBusy(false); }
  };

  const activeRoom = rooms.find(r => r.room.id === activeRoomId);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{
          background: activeRoomId ? "var(--primary-light)" : (open ? "var(--elevated)" : "transparent"),
          color: activeRoomId ? "var(--primary)" : (open ? "var(--text)" : "var(--text-muted)"),
          border: `1px solid ${activeRoomId ? "var(--primary-border)" : (open ? "var(--border)" : "transparent")}`,
        }}
        onMouseEnter={e => { if (!activeRoomId) { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--text)"; } }}
        onMouseLeave={e => { if (!activeRoomId && !open) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; } }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>
        </svg>
        <span style={{ maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeRoom?.room.name ?? (rooms.length > 0 ? "Все комнаты" : "Комнаты")}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-xl" style={{ minWidth: 180, background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="py-1">
            {rooms.length > 0 && (
              <button onClick={() => { onRoomChange(null); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs font-medium transition-all"
                style={{ background: !activeRoomId ? "var(--primary-light)" : "transparent", color: !activeRoomId ? "var(--primary)" : "var(--text-muted)" }}>
                Все комнаты
              </button>
            )}
            {rooms.map(wr => (
              <button key={wr.room.id} onClick={() => { onRoomChange(wr.room.id); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5"
                style={{ background: wr.room.id === activeRoomId ? "var(--primary-light)" : "transparent", color: wr.room.id === activeRoomId ? "var(--primary)" : "var(--text)" }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wr.room.name}</span>
                {wr.role === "shared" && <span style={{ fontSize: 10, opacity: 0.5 }}>↗</span>}
              </button>
            ))}
          </div>
          <div style={{ borderTop: "1px solid var(--border)" }} className="px-2 py-2">
            {!joining ? (
              <button onClick={() => setJoining(true)}
                className="w-full py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ background: "var(--elevated)", color: "var(--text-muted)", border: "1px dashed var(--border)" }}>
                + по коду комнаты
              </button>
            ) : (
              <div className="space-y-1.5">
                <input
                  autoFocus value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Код комнаты"
                  className="w-full rounded-lg px-2 py-1 text-xs outline-none font-mono"
                  style={{ background: "var(--input-bg)", border: "1px solid var(--primary)", color: "var(--text)", letterSpacing: "0.08em" }}
                  onKeyDown={e => { if (e.key === "Enter") handleJoin(); if (e.key === "Escape") { setJoining(false); setJoinCode(""); setJoinErr(null); setJoinInfo(null); } }}
                />
                {joinErr && <p className="text-xs px-1" style={{ color: "#dc2626" }}>{joinErr}</p>}
                {joinInfo && <p className="text-xs px-1" style={{ color: "var(--text-muted)" }}>{joinInfo}</p>}
                <div className="flex gap-1.5">
                  <button onClick={() => { setJoining(false); setJoinCode(""); setJoinErr(null); setJoinInfo(null); }}
                    className="flex-1 py-1 rounded-lg text-xs font-medium"
                    style={{ background: "var(--elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    Отмена
                  </button>
                  <button onClick={handleJoin} disabled={joinBusy}
                    className="flex-1 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                    style={{ background: "var(--primary)" }}>
                    {joinBusy ? "…" : "Добавить"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Room status widget ── */
function RoomStatus({ roomId }: { roomId?: number | null }) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const { data: allBookings = [] } = useQuery({
    queryKey: ["bookings", "room-status"],
    queryFn: bookingsApi.getRoomStatus,
    refetchInterval: 60_000,
  });

  const rooms = roomId ? allBookings.filter((b) => b.room_id === roomId) : allBookings;

  const now = Date.now();
  const current = rooms.find(
    (b) => new Date(b.start_time).getTime() <= now && new Date(b.end_time).getTime() >= now
  );
  const next = rooms.find((b) => new Date(b.start_time).getTime() > now);

  if (current) {
    const endTime = new Date(current.end_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold"
        style={{
          background: isDark ? "rgba(239,68,68,0.1)" : "#fff1f2",
          border: "1px solid #fecdd3",
          color: "#dc2626",
        }}>
        <motion.div animate={{ scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
          className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
        <span>{t("status.busyUntil", { time: endTime })}</span>
      </div>
    );
  }

  if (next) {
    const startTime = new Date(next.start_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const minsLeft = Math.round((new Date(next.start_time).getTime() - now) / 60_000);
    if (minsLeft <= 30) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold"
          style={{ background: isDark ? "rgba(217,119,6,0.1)" : "#fffbeb", border: "1px solid #fde68a", color: "#d97706" }}>
          <div className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
          <span>{t("status.busyAt", { time: startTime })}</span>
        </div>
      );
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold"
      style={{ background: isDark ? "rgba(22,163,74,0.1)" : "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d" }}>
      <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 2, repeat: Infinity }}
        className="w-2 h-2 rounded-full" style={{ background: "#22c55e" }} />
      <span>{t("status.free")}</span>
    </div>
  );
}

export function Calendar({ currentUser, onSlotClick, onCardClick }: CalendarProps) {
  const { t } = useLocale();
  const { activeWorkspace } = useWorkspace();
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen]   = useState(false);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const BUFFER     = 14; // extra columns pre-rendered on each side (= 2× viewport width)
// Extended dates: BUFFER columns before + 7 visible + BUFFER columns after
  const extDates   = Array.from({ length: 7 + BUFFER * 2 }, (_, i) => {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() + i - BUFFER);
    return d;
  });
  const today      = new Date();
  const gridRef    = useRef<HTMLDivElement>(null);
  const timeRef    = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!gridRef.current) return;
    const now = new Date();
    const offset = (now.getHours() + now.getMinutes() / 60 - DAY_START_HOUR) * HOUR_HEIGHT_PX;
    gridRef.current.scrollTop = Math.max(0, offset - 120);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const syncTime = (e: React.UIEvent<HTMLDivElement>) => {
    if (timeRef.current) timeRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const prevWeek = () => { const d = new Date(anchorDate); d.setDate(d.getDate() - 7); navTo(d); };
  const nextWeek = () => { const d = new Date(anchorDate); d.setDate(d.getDate() + 7); navTo(d); };
  const [monthDir, setMonthDir] = useState<1 | -1>(1);
  const prevMonth = () => { setMonthDir(-1); const d = new Date(anchorDate); d.setDate(1); d.setMonth(d.getMonth() - 1); setAnchorDate(d); };
  const nextMonth = () => { setMonthDir(1);  const d = new Date(anchorDate); d.setDate(1); d.setMonth(d.getMonth() + 1); setAnchorDate(d); };
  const handlePrev = viewMode === "month" ? prevMonth : prevWeek;
  const handleNext = viewMode === "month" ? nextMonth : nextWeek;

  const monthLabel = `${t(`cal.mo.${anchorDate.getMonth() + 1}` as "cal.mo.1")} ${anchorDate.getFullYear()}`;

  // ── Drag-to-navigate shared logic ──────────────────────────────────────────
  const dragBaseAnchor = useRef<Date | null>(null);
  const headerDragStartX = useRef<number | null>(null);
  const headerLastDeltaX = useRef(0);
  const headerPrevX = useRef(0);
  const headerPrevTime = useRef(0);
  const headerVelX = useRef(0);
  const cachedColW = useRef(100);
  const [headerDragging, setHeaderDragging] = useState(false);
  const gridInnerRef = useRef<HTMLDivElement>(null);

  const getDayWidth = () => gridRef.current ? gridRef.current.clientWidth / 7 : 100;

  const applyTranslate = (extraDx: number) => {
    const el = gridInnerRef.current;
    if (!el) return;
    const colW = getDayWidth();
    cachedColW.current = colW;
    el.style.transition = "";
    el.style.transform = `translateX(${-BUFFER * colW + extraDx}px)`;
  };

  // Reset to neutral offset whenever anchor changes — useLayoutEffect runs before paint, preventing flash
  useLayoutEffect(() => { applyTranslate(0); }, [anchorDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const navDragStart = () => {
    dragBaseAnchor.current = anchorDate;
    cachedColW.current = getDayWidth(); // read layout once at start, not on every move
  };

  const navDragUpdate = (deltaX: number) => {
    const el = gridInnerRef.current;
    if (!el) return;
    // No getDayWidth() here — zero layout reflows during drag
    el.style.transform = `translateX(${-BUFFER * cachedColW.current + deltaX}px)`;
  };

  const navDragEnd = (finalDeltaX: number, velocityX = 0) => {
    const colW = getDayWidth();
    // Project where the "sled" would coast to with momentum (decay = 320ms)
    const DECAY = 320;
    const projected = finalDeltaX + velocityX * DECAY;
    // Cap to BUFFER-2 so animation never reaches rendered edge
    const days = Math.max(-(BUFFER - 2), Math.min(BUFFER - 2, -Math.round(projected / colW)));
    const snapDx = -days * colW;
    // Duration scales with distance — expo ease-out for sled feel
    const dist = Math.abs(days);
    const duration = Math.min(0.62, 0.22 + dist * 0.09);
    const el = gridInnerRef.current;
    if (el) {
      el.style.transition = `transform ${duration}s cubic-bezier(0.16,1,0.3,1)`;
      el.style.transform = `translateX(${-BUFFER * colW + snapDx}px)`;
      // After animation: commit anchor — useEffect will reset transform invisibly
      // because the new extDates puts the same date at the same visual position
      const onEnd = () => {
        el.removeEventListener("transitionend", onEnd);
        el.style.transition = "";
        if (dragBaseAnchor.current) {
          if (days !== 0) {
            const d = new Date(dragBaseAnchor.current);
            d.setDate(d.getDate() + days);
            setAnchorDate(d);
          } else {
            applyTranslate(0);
          }
          dragBaseAnchor.current = null;
        }
      };
      el.addEventListener("transitionend", onEnd, { once: true });
    } else {
      dragBaseAnchor.current = null;
    }
  };

  // Animate grid to a target date (used by Today / ‹ ›)
  const navTo = (targetDate: Date) => {
    const days = Math.round((targetDate.getTime() - anchorDate.getTime()) / 86_400_000);
    if (days === 0) return;
    if (Math.abs(days) > BUFFER) { setAnchorDate(targetDate); return; }
    const colW = getDayWidth();
    const snapDx = -days * colW;
    const duration = Math.min(0.62, 0.22 + Math.abs(days) * 0.09);
    const el = gridInnerRef.current;
    if (!el) { setAnchorDate(targetDate); return; }
    dragBaseAnchor.current = anchorDate;
    el.style.transition = `transform ${duration}s cubic-bezier(0.16,1,0.3,1)`;
    el.style.transform = `translateX(${-BUFFER * colW + snapDx}px)`;
    const onEnd = () => {
      el.style.transition = "";
      dragBaseAnchor.current = null;
      setAnchorDate(targetDate);
    };
    el.addEventListener("transitionend", onEnd, { once: true });
  };

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    headerDragStartX.current = e.clientX;
    headerLastDeltaX.current = 0;
    headerPrevX.current = e.clientX;
    headerPrevTime.current = performance.now();
    headerVelX.current = 0;
    dragBaseAnchor.current = anchorDate;
    cachedColW.current = getDayWidth(); // cache once, reuse on every move
    setHeaderDragging(true);
  };
  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (headerDragStartX.current === null) return;
    const now = performance.now();
    const dt = now - headerPrevTime.current;
    if (dt > 0) headerVelX.current = (e.clientX - headerPrevX.current) / dt;
    headerPrevX.current = e.clientX;
    headerPrevTime.current = now;
    const delta = e.clientX - headerDragStartX.current;
    headerLastDeltaX.current = delta;
    navDragUpdate(delta);
  };
  const handleHeaderPointerUp = () => {
    if (headerDragStartX.current === null) return;
    navDragEnd(headerLastDeltaX.current, headerVelX.current);
    headerDragStartX.current = null;
    headerVelX.current = 0;
    setHeaderDragging(false);
  };

  return (
    <CalendarDragProvider>
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 sticky top-0 z-20"
        style={{ height: 48, borderBottom: "1px solid var(--border)", background: "var(--toolbar)", backdropFilter: "blur(12px)" }}>

        {/* View mode toggle */}
        <div className="flex items-center shrink-0" style={{ borderRadius: 8, border: "1.5px solid var(--border)", overflow: "hidden" }}>
          {(["week", "month"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="h-7 px-3 text-xs font-semibold transition-all"
              style={{
                background: viewMode === mode ? "var(--primary)" : "transparent",
                color: viewMode === mode ? "#fff" : "var(--text-muted)",
                border: "none", cursor: "pointer",
              }}
            >
              {mode === "week" ? t("cal.week") : t("cal.month")}
            </button>
          ))}
        </div>

        {/* Navigation group */}
        <div className="flex items-center gap-1">
          <button onClick={() => viewMode === "week" ? navTo(new Date()) : setAnchorDate(new Date())}
            className="px-3 h-7 text-xs font-semibold rounded-lg transition-all shrink-0"
            style={{ border: "1.5px solid var(--primary-border)", color: "var(--primary)", background: "var(--primary-light)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--primary)"; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--primary-light)"; e.currentTarget.style.color = "var(--primary)"; }}>
            {t("cal.today")}
          </button>
          <button onClick={handlePrev}
            className="w-7 h-7 flex items-center justify-center rounded-lg font-semibold transition-all shrink-0 text-base leading-none"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--elevated)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = ""; }}>
            ‹
          </button>
          <button onClick={handleNext}
            className="w-7 h-7 flex items-center justify-center rounded-lg font-semibold transition-all shrink-0 text-base leading-none"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--elevated)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = ""; }}>
            ›
          </button>
        </div>

        {/* Month label / search */}
        {searchOpen ? (
          <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 220, opacity: 1 }} style={{ overflow: "hidden" }}>
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("cal.searchPlaceholder")}
              className="w-full text-xs rounded-lg px-3 py-1.5 outline-none"
              style={{ background: "var(--input-bg)", border: "1.5px solid var(--primary)", color: "var(--text)" }}
              onBlur={() => { if (!searchQuery) setSearchOpen(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") { setSearchQuery(""); setSearchOpen(false); } }}
            />
          </motion.div>
        ) : (
          <span className="text-sm font-bold capitalize" style={{ color: "var(--text)", letterSpacing: "-0.01em" }}>{monthLabel}</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <WorkspacePicker onRoomReset={() => setActiveRoomId(null)} />
          <RoomPicker activeRoomId={activeRoomId} onRoomChange={setActiveRoomId} />
          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />
          <RoomStatus roomId={activeRoomId} />

          <button
            onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setSearchQuery(""); }}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
            style={{
              color: searchQuery ? "var(--primary)" : "var(--text-muted)",
              background: searchQuery ? "var(--primary-light)" : "transparent",
            }}
            title="Поиск">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </button>

          <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }}
              className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
            <span>{t("status.now")}</span>
          </div>
        </div>
      </div>

      {viewMode === "month" ? (
        <MonthView
          anchorDate={anchorDate}
          today={today}
          onNavigate={(date) => { setAnchorDate(date); setViewMode("week"); }}
          onCardClick={onCardClick}
          searchQuery={searchQuery}
          onPrev={prevMonth}
          onNext={nextMonth}
          direction={monthDir}
        />
      ) : (<>

      {/* Drag-to-navigate stripe */}
      <div className="relative shrink-0" style={{ height: 4 }}>
        <InteractiveStripe
          edge="top"
          onDragStart={navDragStart}
          onDragUpdate={navDragUpdate}
          onDragEnd={(finalDx, vel) => navDragEnd(finalDx, vel)}
          dayWidth={getDayWidth()}
        />
      </div>

      {/* Grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Time axis */}
        <div ref={timeRef} className="shrink-0 w-14 flex flex-col relative z-10"
          style={{ overflowY: "hidden", background: "var(--time-axis)", borderRight: "1px solid var(--border)", backdropFilter: "blur(20px)" }}>
          <div style={{ height: 56, flexShrink: 0, borderBottom: "1px solid var(--border)" }} />
          {HOURS.map((h) => (
            <div key={h} className="text-right pr-3 text-xs select-none shrink-0 flex items-start justify-end"
              style={{ height: `${HOUR_HEIGHT_PX}px`, color: "var(--text)", paddingTop: 4, fontWeight: 600, fontVariantNumeric: "tabular-nums", opacity: 0.7 }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Scrollable day columns */}
        <div ref={gridRef} className="flex-1 overflow-y-auto overflow-x-hidden relative" onScroll={syncTime}>
          {/* Header drag overlay — sticky 56px zone, intercepts pointer only here */}
          <div
            className="sticky top-0 z-20"
            style={{
              height: 56, marginBottom: -56,
              cursor: headerDragging ? "grabbing" : "grab",
            }}
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={handleHeaderPointerUp}
            onPointerCancel={handleHeaderPointerUp}
          >
            {/* Gradient strip along header bottom */}
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
              background: "linear-gradient(90deg, #c4b5fd, #f9a8d4, #fdba74, #fde68a, #86efac, #67e8f9, #93c5fd, #d8b4fe, #fca5a5, #c4b5fd)",
              backgroundSize: "400% 100%",
              opacity: headerDragging ? 1 : 0.35,
              transition: "opacity 0.2s ease",
              pointerEvents: "none",
            }} />
          </div>
          {/* Inner grid — wider than viewport to hold buffer columns */}
          <div ref={gridInnerRef} className="grid min-h-full"
            style={{
              gridTemplateColumns: `repeat(${7 + BUFFER * 2}, 1fr)`,
              width: `${(7 + BUFFER * 2) / 7 * 100}%`,
              minWidth: `${(7 + BUFFER * 2) / 7 * 560}px`,
              borderLeft: "1px solid var(--border)",
              willChange: "transform",
            }}>
            {extDates.map((date) => {
              const dateStr = toLocalDate(date);
              const isToday = toLocalDate(date) === toLocalDate(today);
              return (
                <DayContainer key={dateStr} date={date} dateStr={dateStr}
                  currentUser={currentUser} onSlotClick={onSlotClick}
                  onCardClick={onCardClick} isToday={isToday} searchQuery={searchQuery}
                  workspaceId={activeWorkspace?.id} roomId={activeRoomId} />
              );
            })}
          </div>
        </div>
      </div>

      </>)}
    </div>
    </CalendarDragProvider>
  );
}
