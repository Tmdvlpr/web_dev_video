import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";

function pad(n: number) { return String(n).padStart(2, "0"); }

const DOW_SHORT_KEYS = [
  "cal.dow.mon", "cal.dow.tue", "cal.dow.wed", "cal.dow.thu",
  "cal.dow.fri", "cal.dow.sat", "cal.dow.sun",
] as const;

// Sun-indexed to match JS Date.getDay() (0=Sun)
const DOW_LONG_KEYS = [
  "cal.dow.sun.long", "cal.dow.mon.long", "cal.dow.tue.long",
  "cal.dow.wed.long", "cal.dow.thu.long", "cal.dow.fri.long", "cal.dow.sat.long",
] as const;

const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 7); // 07..22
const MIN_OPTIONS  = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,10..55

interface DateTimePickerProps {
  label: string;
  value: string; // "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD" when dateOnly
  onChange: (v: string) => void;
  dateOnly?: boolean;
}

export function DateTimePicker({ label, value, onChange, dateOnly }: DateTimePickerProps) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef  = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hourColRef  = useRef<HTMLDivElement>(null);
  const minColRef   = useRef<HTMLDivElement>(null);
  const hourDrag = useRef({ isDragging: false, moved: false, startY: 0, startTop: 0 });
  const minDrag  = useRef({ isDragging: false, moved: false, startY: 0, startTop: 0 });

  const makeDragHandlers = (
    colRef: RefObject<HTMLDivElement>,
    drag: { current: { isDragging: boolean; moved: boolean; startY: number; startTop: number } }
  ) => ({
    onMouseDown(e: { clientY: number }) {
      if (!colRef.current) return;
      drag.current = { isDragging: true, moved: false, startY: e.clientY, startTop: colRef.current.scrollTop };
      const onMove = (ev: MouseEvent) => {
        if (!drag.current.isDragging || !colRef.current) return;
        const dy = ev.clientY - drag.current.startY;
        if (Math.abs(dy) > 4) { drag.current.moved = true; colRef.current.scrollTop = drag.current.startTop - dy; }
      };
      const onUp = () => {
        drag.current.isDragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    onClickCapture(e: { stopPropagation(): void }) {
      if (drag.current.moved) { e.stopPropagation(); drag.current.moved = false; }
    },
  });

  const [datePart, rawTime] = value ? (dateOnly ? [value, "00:00"] : value.split("T")) : ["", "09:00"];
  const timePart = rawTime || "09:00";
  const [sy, sm, sd] = datePart ? datePart.split("-").map(Number) : [0, 0, 0];
  const [sh, smin]   = timePart.split(":").map(Number);

  const [viewYear,  setViewYear]  = useState(() => sy || new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => sm ? sm - 1 : new Date().getMonth());

  useEffect(() => {
    if (sy) setViewYear(sy);
    if (sm) setViewMonth(sm - 1);
  }, [sy, sm]);

  const [pos, setPos] = useState({ top: 0, left: 0, above: false, maxH: 600 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const DROPDOWN_W = 390;
    const DROPDOWN_H = 370;
    const MARGIN = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceBelow = vh - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;
    const above = spaceBelow < DROPDOWN_H && spaceAbove > spaceBelow;

    let left = rect.left;
    if (left + DROPDOWN_W > vw - MARGIN) left = vw - DROPDOWN_W - MARGIN;
    if (left < MARGIN) left = MARGIN;

    const maxH = above
      ? Math.max(spaceAbove - 4, 200)
      : Math.max(spaceBelow, 200);

    setPos({ top: above ? rect.top - 4 : rect.bottom + 6, left, above, maxH });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => {
      const hEl = hourColRef.current?.querySelector("[data-sel='true']") as HTMLElement | null;
      hEl?.scrollIntoView({ block: "center", behavior: "instant" });
      const mEl = minColRef.current?.querySelector("[data-msel='true']") as HTMLElement | null;
      mEl?.scrollIntoView({ block: "center", behavior: "instant" });
    }, 50);
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) ||
          dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const applyDate = (year: number, month: number, day: number) => {
    const d = `${year}-${pad(month + 1)}-${pad(day)}`;
    onChange(dateOnly ? d : `${d}T${pad(sh)}:${pad(smin)}`);
  };
  const applyHour = (h: number) => {
    if (!datePart) return;
    onChange(`${datePart}T${pad(h)}:${pad(smin)}`);
  };
  const applyMin = (m: number) => {
    if (!datePart) return;
    onChange(`${datePart}T${pad(sh)}:${pad(m)}`);
  };
  const goToToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    applyDate(now.getFullYear(), now.getMonth(), now.getDate());
    setOpen(false);
  };
  const clearDate = () => onChange(dateOnly ? "" : `T${pad(sh)}:${pad(smin)}`);

  const firstDay   = new Date(viewYear, viewMonth, 1);
  const lastDayN   = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startPad   = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startPad + lastDayN) / 7) * 7;
  const today      = new Date();

  const displayDate = datePart
    ? (() => {
        const d = new Date(datePart + "T00:00");
        const day = String(d.getDate()).padStart(2, "0");
        const mo = t(`cal.mo.${d.getMonth() + 1}` as "cal.mo.1");
        return dateOnly
          ? `${day} ${mo} ${d.getFullYear()}`
          : `${day} ${mo}`;
      })()
    : "—";
  const displayTime = `${pad(sh)}:${pad(smin)}`;

  const footerDateStr = datePart
    ? (() => {
        const d = new Date(datePart + "T00:00");
        const dowLong = t(DOW_LONG_KEYS[d.getDay()]);
        const mo = t(`cal.mo.${d.getMonth() + 1}` as "cal.mo.1");
        return `${dowLong}, ${d.getDate()} ${mo}`;
      })()
    : "";

  const isWeekend = (dayIdx: number) => dayIdx === 5 || dayIdx === 6; // 0=Mon..6=Sun

  return (
    <div className="flex-1">
      <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-sec)" }}>{label}</label>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full rounded-md px-3 py-2.5 text-left transition-all"
        style={{
          border: open ? "1.5px solid var(--primary)" : "1.5px solid var(--input-border)",
          background: open ? (isDark ? "rgba(168,85,247,0.08)" : "#faf9ff") : "var(--input-bg)",
          boxShadow: open ? "0 0 0 3px rgba(21,101,168,0.12)" : "none",
        }}>
        <div className="flex items-center gap-2">
          {dateOnly ? (
            <div className="flex-1 text-sm font-bold leading-tight" style={{ color: open ? "var(--primary)" : "var(--text)" }}>{displayDate}</div>
          ) : (
            <>
              <div className="flex-1 text-sm font-semibold leading-tight" style={{ color: "var(--text-sec)" }}>{displayDate}</div>
              <div className="text-sm font-black leading-tight shrink-0" style={{ color: open ? "var(--primary)" : "var(--text)" }}>{displayTime}</div>
            </>
          )}
          <svg className="w-4 h-4 shrink-0" style={{ color: open ? "var(--primary)" : "var(--text-muted)" }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: pos.above ? 8 : -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.above ? 8 : -8, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: "fixed",
                top: pos.above ? "auto" : pos.top,
                bottom: pos.above ? window.innerHeight - pos.top : "auto",
                left: pos.left,
                zIndex: 9999,
                borderRadius: 6,
                overflow: "hidden",
                maxHeight: pos.maxH,
                display: "flex",
                flexDirection: "column",
                background: isDark ? "#1a1625" : "#ffffff",
                border: isDark ? "1px solid rgba(21,101,168,0.25)" : "1px solid #e5e7eb",
                boxShadow: isDark
                  ? "0 24px 64px rgba(0,0,0,0.9), 0 0 0 1px rgba(21,101,168,0.1), 0 0 48px rgba(21,101,168,0.12)"
                  : "0 16px 48px rgba(0,0,0,0.16), 0 0 0 1px rgba(21,101,168,0.06)",
              }}>

              {/* Gradient top stripe */}
              <div style={{ height: 2, background: "linear-gradient(90deg,#1565a8,#06b6d4,#114e85)", flexShrink: 0 }} />

              <div style={{ display: "flex", alignItems: "stretch" }}>
                {/* ── Calendar ── */}
                <div className="p-3" style={{ borderRight: isDark ? "1px solid rgba(21,101,168,0.15)" : "1px solid #f0f0f0" }}>

                  {/* Month navigation */}
                  <div className="flex items-center justify-between mb-3 gap-1">
                    <button type="button"
                      onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); }}
                      className="w-7 h-7 flex items-center justify-center rounded transition-all"
                      style={{ color: "var(--text-muted)", background: isDark ? "rgba(255,255,255,0.05)" : "#f5f5f5" }}
                      onMouseEnter={e => { e.currentTarget.style.color = "var(--primary)"; e.currentTarget.style.background = isDark ? "rgba(21,101,168,0.15)" : "#e6f0fa"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.05)" : "#f5f5f5"; }}>
                      ‹
                    </button>

                    <div className="text-center flex-1">
                      <div className="text-xs font-black tracking-wide" style={{ color: "var(--text)" }}>
                        {t(`cal.mo.${viewMonth + 1}` as "cal.mo.1")}
                      </div>
                      <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                        {viewYear}
                      </div>
                    </div>

                    <button type="button"
                      onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); }}
                      className="w-7 h-7 flex items-center justify-center rounded transition-all"
                      style={{ color: "var(--text-muted)", background: isDark ? "rgba(255,255,255,0.05)" : "#f5f5f5" }}
                      onMouseEnter={e => { e.currentTarget.style.color = "var(--primary)"; e.currentTarget.style.background = isDark ? "rgba(21,101,168,0.15)" : "#e6f0fa"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.05)" : "#f5f5f5"; }}>
                      ›
                    </button>
                  </div>

                  {/* Day headers */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 30px)", marginBottom: 4 }}>
                    {DOW_SHORT_KEYS.map((key, i) => (
                      <div key={key} style={{
                        textAlign: "center", fontSize: 11, fontWeight: 700, letterSpacing: "0.03em",
                        color: isWeekend(i) ? (isDark ? "rgba(168,85,247,0.7)" : "#114e85") : "var(--text-muted)",
                        paddingBottom: 2,
                      }}>{t(key)}</div>
                    ))}
                  </div>

                  {/* Day cells */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 30px)", gap: "2px 0" }}>
                    {Array.from({ length: totalCells }, (_, i) => {
                      const day     = i - startPad + 1;
                      const colIdx  = i % 7;
                      if (day < 1 || day > lastDayN) return <div key={i} style={{ width: 30, height: 30 }} />;
                      const isSelected = day === sd && viewMonth === (sm - 1) && viewYear === sy;
                      const isToday    = today.getDate() === day && today.getMonth() === viewMonth && today.getFullYear() === viewYear;
                      const wknd       = isWeekend(colIdx);
                      return (
                        <button key={i} type="button" onClick={() => applyDate(viewYear, viewMonth, day)}
                          style={{
                            width: 30, height: 30, borderRadius: "50%",
                            fontSize: 13, fontWeight: isSelected ? 800 : isToday ? 700 : 400,
                            background: isSelected
                              ? "linear-gradient(135deg,#1565a8,#114e85)"
                              : isToday
                              ? (isDark ? "rgba(21,101,168,0.2)" : "#e6f0fa")
                              : "transparent",
                            color: isSelected ? "#fff" : isToday ? "var(--primary)" : wknd ? (isDark ? "rgba(168,85,247,0.7)" : "#114e85") : "var(--text)",
                            cursor: "pointer", border: "none", transition: "all 0.1s",
                            boxShadow: isSelected ? "0 2px 10px rgba(21,101,168,0.5)" : "none",
                          }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.07)" : "#e6f0fa"; }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isToday ? (isDark ? "rgba(21,101,168,0.2)" : "#e6f0fa") : "transparent"; }}>
                          {day}
                        </button>
                      );
                    })}
                  </div>

                  {/* Footer actions */}
                  <div className="flex items-center justify-between mt-3 pt-2.5"
                    style={{ borderTop: isDark ? "1px solid rgba(255,255,255,0.06)" : "1px solid #f0f0f0" }}>
                    <button type="button" onClick={clearDate}
                      className="text-xs font-semibold transition-all"
                      style={{ color: isDark ? "rgba(239,68,68,0.7)" : "#dc2626" }}
                      onMouseEnter={e => { e.currentTarget.style.color = isDark ? "#f87171" : "#b91c1c"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = isDark ? "rgba(239,68,68,0.7)" : "#dc2626"; }}>
                      {t("cal.delete")}
                    </button>
                    <button type="button" onClick={goToToday}
                      className="text-xs font-semibold transition-all"
                      style={{ color: "var(--primary)" }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = "0.75"; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
                      {t("cal.today")}
                    </button>
                  </div>
                </div>

                {/* ── Time ── */}
                {!dateOnly && <div style={{ display: "flex", flexDirection: "column" }}>
                  {/* Time header */}
                  <div className="px-3 pt-3 pb-2 text-center">
                    <div className="text-lg font-black tracking-tight"
                      style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                      <span className="t-digit-group">
                        {pad(sh).split("").map((d, i) => (
                          <span key={`sh-${i}-${d}`} className="t-digit" style={{
                            background: "linear-gradient(90deg,#1565a8,#06b6d4)",
                            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                          }}>{d}</span>
                        ))}
                      </span>
                      <span style={{
                        background: "linear-gradient(90deg,#1565a8,#06b6d4)",
                        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                      }}>:</span>
                      <span className="t-digit-group">
                        {pad(smin).split("").map((d, i) => (
                          <span key={`sm-${i}-${d}`} className="t-digit" style={{
                            background: "linear-gradient(90deg,#1565a8,#06b6d4)",
                            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                          }}>{d}</span>
                        ))}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flex: 1 }}>
                    {/* Hours */}
                    <div ref={hourColRef}
                      {...makeDragHandlers(hourColRef, hourDrag)}
                      style={{ width: 50, maxHeight: 210, overflowY: "auto", padding: "4px 0", cursor: "grab", userSelect: "none" }}
                      className="thin-scroll">
                      {HOUR_OPTIONS.map(h => (
                        <button key={h} type="button" data-sel={h === sh ? "true" : undefined}
                          onClick={() => applyHour(h)}
                          style={{
                            display: "block", width: "calc(100% - 8px)", margin: "1px 4px",
                            padding: "6px 0", fontSize: 13, fontWeight: h === sh ? 800 : 400,
                            background: h === sh
                              ? "linear-gradient(135deg,#1565a8,#114e85)"
                              : "transparent",
                            color: h === sh ? "#fff" : "var(--text)",
                            borderRadius: 4, cursor: "pointer", border: "none", textAlign: "center",
                            transition: "all 0.1s",
                            boxShadow: h === sh ? "0 2px 8px rgba(21,101,168,0.4)" : "none",
                          }}
                          onMouseEnter={e => { if (h !== sh) e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.07)" : "#e6f0fa"; }}
                          onMouseLeave={e => { if (h !== sh) e.currentTarget.style.background = "transparent"; }}>
                          {pad(h)}
                        </button>
                      ))}
                    </div>

                    {/* Divider */}
                    <div style={{ width: 1, background: isDark ? "rgba(255,255,255,0.06)" : "#f0f0f0", margin: "8px 0" }} />

                    {/* Minutes */}
                    <div ref={minColRef}
                      {...makeDragHandlers(minColRef, minDrag)}
                      style={{ width: 50, maxHeight: 210, overflowY: "auto", padding: "4px 0", cursor: "grab", userSelect: "none" }}
                      className="thin-scroll">
                      {MIN_OPTIONS.map(m => (
                        <button key={m} type="button" data-msel={m === smin ? "true" : undefined}
                          onClick={() => applyMin(m)}
                          style={{
                            display: "block", width: "calc(100% - 8px)", margin: "1px 4px",
                            padding: "6px 0", fontSize: 13, fontWeight: m === smin ? 800 : 400,
                            background: m === smin
                              ? "linear-gradient(135deg,#1565a8,#114e85)"
                              : "transparent",
                            color: m === smin ? "#fff" : "var(--text)",
                            borderRadius: 4, cursor: "pointer", border: "none", textAlign: "center",
                            transition: "all 0.1s",
                            boxShadow: m === smin ? "0 2px 8px rgba(21,101,168,0.4)" : "none",
                          }}
                          onMouseEnter={e => { if (m !== smin) e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.07)" : "#e6f0fa"; }}
                          onMouseLeave={e => { if (m !== smin) e.currentTarget.style.background = "transparent"; }}>
                          :{pad(m)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>}
              </div>

              {/* Footer: date summary + OK button */}
              <div className="px-3 py-2 flex items-center justify-between gap-3"
                style={{ borderTop: isDark ? "1px solid rgba(255,255,255,0.06)" : "1px solid #f0f0f0" }}>
                <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                  {footerDateStr}
                </span>
                <motion.button
                  type="button"
                  onClick={() => setOpen(false)}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.94 }}
                  style={{
                    background: "linear-gradient(135deg,#1565a8,#114e85)",
                    color: "#fff", border: "none", borderRadius: 6,
                    padding: "5px 14px", fontSize: 13, fontWeight: 800,
                    cursor: "pointer", boxShadow: "0 2px 10px rgba(21,101,168,0.45)",
                    letterSpacing: "0.02em",
                  }}>
                  OK ✓
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
