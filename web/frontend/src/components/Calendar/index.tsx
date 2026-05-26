import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
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
  typeFilter?: "all" | "physical" | "virtual" | "hybrid";
}

function DayContainer({ date, dateStr, currentUser, onSlotClick, onCardClick, isToday, searchQuery, workspaceId, roomId, typeFilter = "all" }: DayContainerProps) {
  const { data: bookings = [] } = useBookings(dateStr, workspaceId);
  const { data: slots = [] } = useSlots(dateStr);
  const { mutate: updateBooking } = useUpdateBooking();

  const handleBookingDrop = (booking: Booking, newStart: Date) => {
    const durationMs = new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime();
    const newEnd = new Date(newStart.getTime() + durationMs);
    updateBooking({ id: booking.id, payload: { start_time: newStart.toISOString(), end_time: newEnd.toISOString() } });
  };

  const handleBookingResize = (booking: Booking, newEnd: Date) => {
    updateBooking({ id: booking.id, payload: { end_time: newEnd.toISOString() } });
  };

  // Virtual meetings have no physical room — always show them regardless of room filter
  const byRoom = roomId
    ? (bookings as Booking[]).filter((b) => b.room_id === roomId || (b.booking_type ?? "physical") === "virtual")
    : bookings as Booking[];
  const byType = typeFilter && typeFilter !== "all" ? byRoom.filter((b) => (b.booking_type ?? "physical") === typeFilter) : byRoom;
  const filtered = searchQuery
    ? byType.filter((b) =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.user.display_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : byType;
  return (
    <DayColumn date={date} bookings={filtered} freeSlots={slots as SlotResponse[]} currentUser={currentUser}
      onSlotClick={onSlotClick} onCardClick={onCardClick} onBookingDrop={handleBookingDrop}
      onBookingResize={handleBookingResize} isToday={isToday} />
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
            <span style={{ fontSize: 11, fontWeight: 700, color: hashColor(b.id), flexShrink: 0, letterSpacing: "-0.01em" }}>
              {new Date(b.start_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {b.title}
            </span>
          </div>
        ))}
        {overflow > 0 && (
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary)", paddingLeft: 7 }}>
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
    const absX = Math.abs(e.deltaX);
    const absY = Math.abs(e.deltaY);
    if (absX < 8 && absY < 8) return;
    wheelLock.current = true;
    // Horizontal trackpad swipe takes priority
    if (absX > absY) {
      if (e.deltaX > 0) onNext(); else onPrev();
    } else {
      if (e.deltaY > 0) onNext(); else onPrev();
    }
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

/* ── Filter dropdown (rooms + meeting type) ── */
function FilterDropdown({
  activeRoomId, onRoomChange,
  typeFilter, onTypeFilter,
}: {
  activeRoomId: number | null; onRoomChange: (id: number | null) => void;
  typeFilter: "all" | "physical" | "virtual" | "hybrid"; onTypeFilter: (v: "all" | "physical" | "virtual" | "hybrid") => void;
}) {
  const { t } = useLocale();
  const { myRooms, activeWorkspace, refetchRooms } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"rooms" | "type">("rooms");
  const [joinCode, setJoinCode] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joinInfo, setJoinInfo] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; right: number } | null>(null);

  const rooms = myRooms.filter(r => r.workspace_id === activeWorkspace?.id);
  const hasFilter = activeRoomId !== null || typeFilter !== "all";

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleJoin = async () => {
    if (!activeWorkspace || !joinCode.trim()) return;
    setJoinErr(null); setJoinInfo(null); setJoinBusy(true);
    try {
      const result = await roomsApi.join(joinCode.trim(), activeWorkspace.id);
      if (result.status === 201) { refetchRooms(); setJoinCode(""); }
      else if (result.status === 202) { setJoinCode(""); setJoinInfo("⏳ Заявка отправлена. Ждём подтверждения."); }
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number; data?: { detail?: string } } })?.response?.status;
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setJoinErr(status === 403 ? "❌ Подключение по коду отключено." : msg ?? "Комната не найдена");
    } finally { setJoinBusy(false); }
  };

  const TYPE_OPTS = [
    { key: "all" as const,      label: t("cal.filterAll") },
    { key: "physical" as const, label: t("cal.filterPhysical") },
    { key: "virtual" as const,  label: t("cal.filterVirtual") },
    { key: "hybrid" as const,   label: t("cal.filterHybrid") },
  ];

  return (
    <div ref={ref}>
      {/* Trigger button */}
      <button
        ref={btnRef}
        onClick={() => {
          if (open) { setOpen(false); return; }
          const r = btnRef.current?.getBoundingClientRect();
          if (r) setDropPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
          setOpen(true);
        }}
        className="flex items-center gap-1.5 px-2.5 h-7 text-xs font-semibold rounded-lg transition-all"
        style={{
          border: open || hasFilter ? "1.5px solid var(--primary)" : "1.5px solid var(--border)",
          background: open || hasFilter ? "var(--primary-light)" : "transparent",
          color: open || hasFilter ? "var(--primary)" : "var(--text-muted)",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
        </svg>
        Фильтры
        {hasFilter && (
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--primary)", flexShrink: 0 }} />
        )}
      </button>

      {/* Dropdown via portal — escapes toolbar stacking context */}
      {open && dropPos && createPortal(
        <div
          ref={dropRef}
          style={{
            position: "fixed", top: dropPos.top, right: dropPos.right,
            zIndex: 9999, width: 240,
            background: "var(--card)", border: "1px solid var(--border)",
            borderRadius: 6, boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
          }}
        >
          {/* Tabs */}
          <div className="flex" style={{ borderBottom: "1px solid var(--border)" }}>
            {(["rooms", "type"] as const).map(k => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className="flex-1 py-2 text-xs font-semibold transition-all"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: tab === k ? "var(--primary)" : "var(--text-muted)",
                  borderBottom: tab === k ? "2px solid var(--primary)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {k === "rooms" ? "Комнаты" : "Тип встречи"}
              </button>
            ))}
          </div>

          {/* Rooms tab */}
          {tab === "rooms" && (
            <div className="p-2 flex flex-col gap-1">
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => onRoomChange(null)}
                  className="px-2.5 h-6 text-xs font-medium rounded-md transition-all"
                  style={{
                    background: !activeRoomId ? "var(--primary)" : "var(--elevated)",
                    color: !activeRoomId ? "#fff" : "var(--text-muted)",
                    border: "none",
                  }}
                >Все</button>
                {rooms.map(wr => (
                  <button
                    key={wr.room.id}
                    onClick={() => onRoomChange(wr.room.id)}
                    className="px-2.5 h-6 text-xs font-medium rounded-md transition-all flex items-center gap-1"
                    style={{
                      background: wr.room.id === activeRoomId ? "var(--primary)" : "var(--elevated)",
                      color: wr.room.id === activeRoomId ? "#fff" : "var(--text-muted)",
                      border: "none", maxWidth: 110,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wr.room.name}</span>
                    {wr.role === "shared" && <span style={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }}>↗</span>}
                  </button>
                ))}
              </div>
              {/* Join by code */}
              <div className="mt-1 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="flex gap-1">
                  <input
                    value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="Код комнаты"
                    className="flex-1 rounded-lg px-2 py-1 text-xs outline-none font-mono"
                    style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                    onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
                  />
                  <button onClick={handleJoin} disabled={joinBusy || !joinCode.trim()}
                    className="px-2 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                    style={{ background: "var(--primary)", border: "none" }}>
                    {joinBusy ? "…" : "+"}
                  </button>
                </div>
                {joinErr  && <p className="text-xs mt-1 px-1" style={{ color: "#dc2626" }}>{joinErr}</p>}
                {joinInfo && <p className="text-xs mt-1 px-1" style={{ color: "var(--text-muted)" }}>{joinInfo}</p>}
              </div>
            </div>
          )}

          {/* Type tab */}
          {tab === "type" && (
            <div className="p-2 grid grid-cols-2 gap-1">
              {TYPE_OPTS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => onTypeFilter(key)}
                  className="px-2.5 h-6 text-xs font-medium rounded-md transition-all"
                  style={{
                    background: typeFilter === key ? "var(--primary)" : "var(--elevated)",
                    color: typeFilter === key ? "#fff" : "var(--text-muted)",
                    border: "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

/* ── Room status widget ── */
function RoomStatus({ roomId, workspaceId }: { roomId?: number | null; workspaceId?: number | null }) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const [popupOpen, setPopupOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: allBookings = [] } = useQuery({
    queryKey: ["bookings", "room-status", workspaceId ?? null],
    queryFn: () => bookingsApi.getRoomStatus(workspaceId ?? undefined),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!popupOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPopupOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popupOpen]);

  // Only physical/hybrid bookings occupy the room; virtual meetings don't take physical space
  const physicalBookings = allBookings.filter((b) => b.booking_type !== "virtual");
  const rooms = roomId ? physicalBookings.filter((b) => b.room_id === roomId) : physicalBookings;

  const now = Date.now();
  const current = rooms.find(
    (b) => new Date(b.start_time).getTime() <= now && new Date(b.end_time).getTime() >= now
  );
  const next = rooms.find((b) => new Date(b.start_time).getTime() > now);

  const fmtTime = (s: string) => new Date(s).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const popupStyle: React.CSSProperties = {
    position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 200,
    background: isDark ? "#1e2640" : "#fff",
    border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
    borderRadius: 6, padding: "12px 14px", minWidth: 220,
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
    color: isDark ? "#eceef5" : "#1a2038",
  };

  const renderPopup = (booking: typeof current) => {
    if (!booking) return null;
    const isNow = new Date(booking.start_time).getTime() <= now;
    return (
      <div style={popupStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: isNow ? "#dc2626" : "#d97706", marginBottom: 6 }}>
          {isNow ? "Идёт сейчас" : "Скоро начнётся"}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{booking.title}</div>
        <div style={{ fontSize: 13, color: isDark ? "#7882a8" : "#546080", marginBottom: 2 }}>
          {fmtTime(booking.start_time)} — {fmtTime(booking.end_time)}
        </div>
        {booking.user?.display_name && (
          <div style={{ fontSize: 13, color: isDark ? "#7882a8" : "#546080" }}>
            Организатор: {booking.user.display_name}
          </div>
        )}
        {booking.description && (
          <div style={{ fontSize: 13, color: isDark ? "#9aa3c0" : "#546080", marginTop: 6, borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}`, paddingTop: 6 }}>
            {booking.description}
          </div>
        )}
      </div>
    );
  };

  if (current) {
    const endTime = fmtTime(current.end_time);
    return (
      <div ref={ref} style={{ position: "relative" }}>
        <button
          onClick={() => setPopupOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold"
          style={{ background: isDark ? "rgba(239,68,68,0.1)" : "#fff1f2", border: "1px solid #fecdd3", color: "#dc2626", cursor: "pointer" }}>
          <motion.div animate={{ scale: [1, 1.4, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
            className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
          <span>{t("status.busyUntil", { time: endTime })}</span>
        </button>
        {popupOpen && renderPopup(current)}
      </div>
    );
  }

  if (next) {
    const startTime = fmtTime(next.start_time);
    const minsLeft = Math.round((new Date(next.start_time).getTime() - now) / 60_000);
    if (minsLeft <= 30) {
      return (
        <div ref={ref} style={{ position: "relative" }}>
          <button
            onClick={() => setPopupOpen((v) => !v)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold"
            style={{ background: isDark ? "rgba(217,119,6,0.1)" : "#fffbeb", border: "1px solid #fde68a", color: "#d97706", cursor: "pointer" }}>
            <div className="w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
            <span>{t("status.busyAt", { time: startTime })}</span>
          </button>
          {popupOpen && renderPopup(next)}
        </div>
      );
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold"
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
  const [typeFilter, setTypeFilter] = useState<"all" | "physical" | "virtual" | "hybrid">("all");

  // Reset room filter when workspace changes
  useEffect(() => { setActiveRoomId(null); }, [activeWorkspace?.id]);

  const BUFFER     = 5; // extra columns pre-rendered on each side for swipe buffer
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

  // Trackpad / horizontal mouse-wheel → week navigation
  const _wheelNavRef = useRef({ prev: handlePrev, next: handleNext });
  _wheelNavRef.current.prev = handlePrev;
  _wheelNavRef.current.next = handleNext;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let lastNavMs = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 8) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastNavMs < 500) return;
      lastNavMs = now;
      if (e.deltaX > 0) _wheelNavRef.current.next();
      else _wheelNavRef.current.prev();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          <FilterDropdown
            activeRoomId={activeRoomId} onRoomChange={setActiveRoomId}
            typeFilter={typeFilter} onTypeFilter={setTypeFilter}
          />
          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />
          <RoomStatus roomId={activeRoomId} workspaceId={activeWorkspace?.id} />

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
                  workspaceId={activeWorkspace?.id} roomId={activeRoomId} typeFilter={typeFilter} />
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
