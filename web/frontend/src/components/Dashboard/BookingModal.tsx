import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DateTimePicker } from "../Common/DateTimePicker";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";


import { useBookings, useCreateBooking, useDeleteBooking, useUpdateBooking } from "../../hooks/useBookings";
import { bookingsApi } from "../../api/bookings";
import { meetingsApi } from "../../api/meetings";
import type { Booking } from "../../types";
import { GuestInput } from "./GuestInput";
import { AttachmentsSection } from "./AttachmentsSection";
import { MeetingChatPanel } from "../Video/MeetingChatPanel";

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialStart?: Date;
  initialEnd?: Date;
  editBooking?: Booking | null;
  canEdit?: boolean;
  canDelete?: boolean;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function toLocal(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function fmtHM(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}


const PRESETS = [
  { key: "booking.dur30",   minutes: 30 },
  { key: "booking.dur1h",   minutes: 60 },
  { key: "booking.dur1_5h", minutes: 90 },
  { key: "booking.dur2h",   minutes: 120 },
] as const;

const RECURRENCE_OPTIONS = [
  { value: "none",   key: "booking.recNone" },
  { value: "daily",  key: "booking.recDaily" },
  { value: "weekly", key: "booking.recWeekly" },
  { value: "custom", key: "booking.recCustom" },
] as const;

const WEEKDAYS = [
  { idx: 0, key: "booking.dow.0" as const },
  { idx: 1, key: "booking.dow.1" as const },
  { idx: 2, key: "booking.dow.2" as const },
  { idx: 3, key: "booking.dow.3" as const },
  { idx: 4, key: "booking.dow.4" as const },
  { idx: 5, key: "booking.dow.5" as const },
  { idx: 6, key: "booking.dow.6" as const },
];


type View = "form" | "confirmDelete";

interface ConstellationNode {
  x: number; y: number;
  vx: number; vy: number;
  phase: number;
  size: number;
  hue: number;
  shape: 0|1|2|3; // 0=circle 1=diamond 2=cross 3=triangle
}

export function BookingModal({
  isOpen, onClose, initialStart, initialEnd,
  editBooking, canEdit, canDelete,
  onSuccess, onError
}: BookingModalProps) {
  const { isDark } = useTheme();
  const { t, locale } = useLocale();
  const { activeWorkspace, myRooms } = useWorkspace();
  const navigate    = useNavigate();
  const isEdit     = !!editBooking;
  const isReadOnly = isEdit && !canEdit;
  const now = new Date();
  const isPast     = isEdit && editBooking ? new Date(editBooking.end_time) < now : false;
  // Default start: now + 5min, rounded up to next 30-min boundary
  const defaultStart = (() => {
    const t = new Date(now.getTime() + 5 * 60_000);
    const minutes = t.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 30) * 30;
    t.setMinutes(roundedMinutes, 0, 0);
    return t;
  })();
  const later = new Date(defaultStart.getTime() + 3_600_000);


  const handleJoinVideo = () => {
    if (!editBooking) return;
    onClose();
    navigate(`/meeting/${editBooking.id}`);
  };

  const [copiedLink, setCopiedLink] = useState(false);
  const [guestInviteUrl, setGuestInviteUrl] = useState<string | null>(null);
  const [guestInviteLoading, setGuestInviteLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !editBooking?.video_enabled || !editBooking?.id) { setGuestInviteUrl(null); return; }
    setGuestInviteLoading(true);
    meetingsApi.createInvite(editBooking.id)
      .then(r => setGuestInviteUrl(r.invite_url))
      .catch(console.warn)
      .finally(() => setGuestInviteLoading(false));
  }, [isOpen, editBooking?.id, editBooking?.video_enabled]);

  const handleCopyMeetingLink = () => {
    const url = guestInviteUrl;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const canvasRef    = useRef<HTMLCanvasElement | null>(null);
  const cardRef      = useRef<HTMLDivElement | null>(null);
  const nodesRef     = useRef<ConstellationNode[]>([]);
  const rafRef       = useRef<number>(0);
  const typePulseRef = useRef<number>(0);
  const dragControls = useDragControls();

  /* ── Constellation animation ── */
  useEffect(() => {
    if (!isOpen) return;

    const canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:45";
    document.body.appendChild(canvas);
    canvasRef.current = canvas;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const W0 = window.innerWidth, H0 = window.innerHeight;
    const N_NODES   = 120;
    const MAX_CONN  = 220;
    const HL_RADIUS = 380;

    nodesRef.current = Array.from({ length: N_NODES }, () => {
      const dir = Math.random() * Math.PI * 2;
      const spd = 0.10 + Math.random() * 0.20;
      return {
        x:     Math.random() * W0,
        y:     Math.random() * H0,
        vx:    Math.cos(dir) * spd,
        vy:    Math.sin(dir) * spd,
        phase: Math.random() * Math.PI * 2,
        size:  1.4 + Math.random() * 2.0,
        hue:   Math.random() * 360,
        shape: Math.floor(Math.random() * 4) as 0|1|2|3,
      };
    });

    const onType = () => { typePulseRef.current = 1.0; };
    document.addEventListener("keydown", onType);

    const ctx = canvas.getContext("2d")!;
    let t = 0;

    const loop = () => {
      t += 0.016;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const W = canvas.width, H = canvas.height;

      const el   = cardRef.current;
      const rect = el?.getBoundingClientRect();
      const cx   = rect ? rect.left + rect.width  / 2 : W0 / 2;
      const cy   = rect ? rect.top  + rect.height / 2 : H0 / 2;

      typePulseRef.current *= 0.88;
      const pulse = typePulseRef.current;

      const dark = document.documentElement.getAttribute("data-theme") !== "light";

      const nodes = nodesRef.current;

      /* move nodes — gentle wander, wrap edges */
      for (const n of nodes) {
        n.vx += Math.sin(t * 0.4 + n.phase)        * 0.003;
        n.vy += Math.cos(t * 0.35 + n.phase * 1.2) * 0.003;
        // soft speed limit
        const spd = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (spd > 0.38) { n.vx *= 0.38 / spd; n.vy *= 0.38 / spd; }
        n.x += n.vx; n.y += n.vy;
        // wrap
        if (n.x < -20) n.x = W + 20;
        if (n.x > W + 20) n.x = -20;
        if (n.y < -20) n.y = H + 20;
        if (n.y > H + 20) n.y = -20;
      }

      /* ── draw connection lines ── */
      ctx.lineCap = "round";
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > MAX_CONN * MAX_CONN) continue;
          const dist = Math.sqrt(dist2);

          // base alpha: fades with distance
          const baseA = (1 - dist / MAX_CONN) * (dark ? 0.52 : 0.52);

          // highlight: how close is card center to the midpoint of this line?
          const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
          const cdx = mx - cx, cdy = my - cy;
          const cardDist = Math.sqrt(cdx * cdx + cdy * cdy);
          const hl = Math.max(0, 1 - cardDist / HL_RADIUS);
          const hlPulse = Math.max(0, 1 - Math.sqrt((mx-cx)**2+(my-cy)**2) / (HL_RADIUS * 1.5)) * pulse;

          const alpha = baseA + hl * (dark ? 0.70 : 0.65) + hlPulse * 0.45;
          if (alpha < 0.005) continue;

          const hue = dark ? 220 + hl * 50 : 220;
          const sat = dark ? 60 + hl * 30  : 8 + hl * 10;
          const lit = dark ? 65 + hl * 25  : 12 + hl * 10;

          ctx.globalAlpha = alpha;
          ctx.lineWidth   = 0.8 + hl * 1.4;
          ctx.strokeStyle = `hsl(${hue},${sat}%,${lit}%)`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      /* ── draw nodes ── */
      for (const n of nodes) {
        const ndx = n.x - cx, ndy = n.y - cy;
        const cardDist = Math.sqrt(ndx * ndx + ndy * ndy);
        const hl = Math.max(0, 1 - cardDist / HL_RADIUS);
        const hlPulse = Math.max(0, 1 - cardDist / (HL_RADIUS * 1.5)) * pulse;

        const baseA = dark ? 0.55 : 0.44;
        const alpha = baseA + hl * (dark ? 0.68 : 0.62) + hlPulse * 0.42;
        const r     = n.size * (1 + hl * 1.4 + hlPulse * 0.8);
        const hue   = dark ? 220 + hl * 60 : 220;
        const sat   = dark ? 65 + hl * 40  : 7 + hl * 10;
        const lit   = dark ? 78 + hl * 22  : 22 + hl * 9;

        // star twinkle: high-power product = long dim baseline + brief bright spike
        const s1 = Math.sin(t * 0.31 + n.phase * 2.7) * 0.5 + 0.5;
        const s2 = Math.sin(t * 0.57 + n.phase * 4.3) * 0.5 + 0.5;
        const tw  = Math.pow(s1 * s2, 7);
        const fAlpha = Math.min(1, alpha + tw * (dark ? 0.7 : 0.5));
        const fR     = r * (1 + tw * 0.35);
        const fLit   = dark ? Math.min(100, lit + tw * 45) : Math.max(0, lit - tw * 22);
        const fSat   = dark ? Math.min(100, sat + tw * 30) : Math.max(0, sat - tw * 7);

        // glow for highlighted nodes
        if (hl > 0.05) {
          ctx.globalAlpha = (hl + hlPulse) * (dark ? 0.35 : 0.38);
          ctx.fillStyle   = `hsl(${hue},${sat}%,${lit + 15}%)`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalAlpha = fAlpha;
        ctx.fillStyle   = `hsl(${hue},${fSat}%,${fLit}%)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, fR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      document.removeEventListener("keydown", onType);
      canvas.remove();
    };
  }, [isOpen]);

  const [view,        setView]      = useState<View>("form");
  const [title,       setTitle]     = useState("");
  const [description, setDesc]      = useState("");
  const [startTime,   setStart]     = useState(toLocal(now));
  const [endTime,     setEnd]       = useState(toLocal(later));
  const [guests,      setGuests]    = useState<string[]>([]);
  const [recurrence,  setRecur]     = useState<"none" | "daily" | "weekly" | "custom">("none");
  const [recurUntil,  setRecurUntil]= useState("");
  const [recurDays,   setRecurDays] = useState<number[]>([]);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [bookingType, setBookingType] = useState<"physical" | "virtual" | "hybrid">("physical");
  const [selectedRoomId, setSelectedRoomId] = useState<number | "">("");
  const [roomDropOpen, setRoomDropOpen] = useState(false);
  const roomDropRef = useRef<HTMLDivElement | null>(null);
  const [deleteSeries,setDelSeries] = useState(false);
  const [pendingFiles,setPendingFiles] = useState<File[]>([]);
  const [error,       setError]     = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; time?: string; days?: string; room?: string }>({});
  const [formReady,   setFormReady] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [easterMsg, setEasterMsg] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const longMeetingShown = useRef(false);
  const weekendShown = useRef(false);
  const importantShown = useRef(false);

  // Conflict preview: load bookings for the selected date
  const dateStr = startTime ? startTime.split("T")[0] : undefined;
  const { data: dayBookings = [] } = useBookings(dateStr);
  // Skip optimistic placeholders (negative ID) — those are the booking being saved right now
  const conflicts = !isEdit && formReady && bookingType !== "virtual"
    ? dayBookings.filter((b) => {
        if (b.id < 0) return false;
        if ((b.booking_type ?? "physical") === "virtual") return false;
        // Room-level conflict: only flag if same room selected (or no room info)
        if (selectedRoomId !== "" && b.room_id !== undefined && b.room_id !== null && b.room_id !== selectedRoomId) return false;
        const bStart = new Date(b.start_time).getTime();
        const bEnd   = new Date(b.end_time).getTime();
        const sStart = new Date(startTime).getTime();
        const sEnd   = new Date(endTime).getTime();
        return bStart < sEnd && bEnd > sStart;
      })
    : [];

  const { mutateAsync: createBooking, isPending: isCreating } = useCreateBooking();
  const { mutateAsync: updateBooking, isPending: isUpdating } = useUpdateBooking();
  const { mutateAsync: deleteBooking, isPending: isDeleting } = useDeleteBooking();

  useEffect(() => {
    if (!isOpen) {
      setFormReady(false);
      setShowAdvanced(false);
      longMeetingShown.current = false;
      weekendShown.current = false;
      importantShown.current = false;
      setEasterMsg(null);
      return;
    }
    setView("form"); setError(null); setDelSeries(false); setFormReady(false); setPendingFiles([]);
    if (editBooking) {
      setTitle(editBooking.title);
      setDesc(editBooking.description ?? "");
      setStart(toLocal(new Date(editBooking.start_time)));
      setEnd(toLocal(new Date(editBooking.end_time)));
      setGuests(editBooking.guests ?? []);
      setRecur(editBooking.recurrence ?? "none");
      setRecurUntil(editBooking.recurrence_until ?? "");
      setVideoEnabled(editBooking.video_enabled ?? false);
      setSelectedRoomId(editBooking.room_id ?? "");
      setBookingType(editBooking.booking_type ?? "physical");
    } else {
      setTitle(""); setDesc(""); setGuests([]);
      setRecur("none"); setRecurUntil(""); setRecurDays([]);
      setVideoEnabled(false);
      setSelectedRoomId("");
      setStart(toLocal(initialStart ?? defaultStart));
      setEnd(toLocal(initialEnd ?? later));
      // Default type: physical if rooms available, virtual otherwise
      const available = activeWorkspace
        ? myRooms.filter(wr => wr.workspace_id === activeWorkspace.id)
        : myRooms;
      setBookingType(available.length > 0 ? "physical" : "virtual");
    }
    setFormReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editBooking?.id]);

  const currentDurationMins = startTime && endTime
    ? Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60_000)
    : 0;

  useEffect(() => {
    if (!easterMsg) return;
    const id = setTimeout(() => setEasterMsg(null), 4500);
    return () => clearTimeout(id);
  }, [easterMsg]);

  // Weekend warning (idx 5=Sat, 6=Sun in WEEKDAYS)
  useEffect(() => {
    if (!weekendShown.current && (recurDays.includes(5) || recurDays.includes(6))) {
      weekendShown.current = true;
      setEasterMsg(locale === "uz"
        ? "Ishonchingiz komilmi? Yakshanbada ham? 😬"
        : "Ты уверен? Даже в воскресенье? 😬");
    }
  }, [recurDays, locale]);

  // 2h+ meeting warning
  useEffect(() => {
    if (!longMeetingShown.current && currentDurationMins >= 120) {
      longMeetingShown.current = true;
      setEasterMsg(locale === "uz"
        ? "Bu qadar uzoq, qachon ishlaymiz? 😅"
        : "Так долго, а работать когда будем? 😅");
    }
  }, [currentDurationMins, locale]);

  // "Важная встреча" / "muhim yig'ilish" title
  useEffect(() => {
    const lc = title.toLowerCase();
    if (!importantShown.current && (lc.includes("важная встреча") || lc.includes("muhim yig'ilish"))) {
      importantShown.current = true;
      setEasterMsg(locale === "uz"
        ? "Barcha muhim yig'ilishlar shunday nomlanadi 😏"
        : "Все важные встречи так называются 😏");
    }
  }, [title, locale]);

  const importantTitle = title.toLowerCase().includes("важная встреча") || title.toLowerCase().includes("muhim yig'ilish");

  const applyPreset = (mins: number) =>
    setEnd(toLocal(new Date(new Date(startTime).getTime() + mins * 60_000)));

  const validateFields = (): boolean => {
    const errs: { title?: string; time?: string; days?: string; room?: string } = {};
    if (!title.trim()) errs.title = t("booking.titleError");
    const sMs = new Date(startTime).getTime();
    const eMs = new Date(endTime).getTime();
    const durMin = (eMs - sMs) / 60_000;
    if (!isEdit && sMs < Date.now() - 120_000) errs.time = "Нельзя бронировать время в прошлом";
    else if (sMs >= eMs) errs.time = t("booking.endError");
    else if (durMin < 15) errs.time = t("booking.minDur");
    else if (durMin > 480) errs.time = t("booking.maxDur");
    if (recurrence === "custom" && recurDays.length === 0) errs.days = t("booking.pickDays");
    if (bookingType !== "virtual" && selectedRoomId === "") errs.room = "Выберите переговорную";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!validateFields()) return;
    const startISO = new Date(startTime).toISOString();
    const endISO   = new Date(endTime).toISOString();
    try {
      if (isEdit && editBooking) {
        await updateBooking({ id: editBooking.id, payload: { title, description, start_time: startISO, end_time: endISO, guests, video_enabled: videoEnabled } });
        onSuccess?.(t("booking.toastUpdated"));
      } else {
        const created = await createBooking({
          title, description, start_time: startISO, end_time: endISO, guests,
          recurrence,
          recurrence_until: recurrence !== "none" && recurUntil ? recurUntil : undefined,
          recurrence_days: recurrence === "custom" ? recurDays : undefined,
          video_enabled: bookingType === "virtual" || bookingType === "hybrid" ? true : videoEnabled,
          workspace_id: activeWorkspace?.id,
          room_id: bookingType === "virtual" ? undefined : (selectedRoomId === "" ? undefined : selectedRoomId),
          booking_type: bookingType,
        });
        const count = created.length;
        // Upload pending files to the first created booking
        if (pendingFiles.length > 0 && created.length > 0) {
          const bid = created[0].id;
          for (const f of pendingFiles) {
            await bookingsApi.uploadAttachment(bid, f).catch(() => null);
          }
        }
        if (!localStorage.getItem("__cm_first_booking")) {
          localStorage.setItem("__cm_first_booking", "1");
          onSuccess?.(locale === "uz"
            ? "🚀 Birinchi yig'ilish! Yangi davr boshlanmoqda"
            : "🚀 Первая встреча! Начало эпохи");
        } else {
          onSuccess?.(count > 1 ? t("booking.toastBookedN", { n: count }) : t("booking.toastBooked"));
        }
      }
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      onError?.(msg ?? t("booking.toastSaveErr"));
      setError(msg ?? t("booking.toastSaveErr"));
    }
  };

  const handleDelete = async () => {
    if (!editBooking) return;
    try {
      await deleteBooking({ id: editBooking.id, deleteSeries });
      onSuccess?.(deleteSeries ? t("booking.toastSeriesDel") : t("booking.toastDeleted"));
      onClose();
    } catch {
      onError?.(t("booking.toastDeleteErr"));
      setError(t("booking.toastDeleteErr"));
      setView("form");
    }
  };

  const tgUser  = editBooking?.user;
  const tgLink  = tgUser?.username ? `https://t.me/${tgUser.username}` : `tg://user?id=${tgUser?.telegram_id}`;
  const tgLabel = tgUser?.username ? `@${tgUser.username}` : `ID ${tgUser?.telegram_id}`;

  const errBg     = isDark ? "rgba(239,68,68,0.1)"  : "#fff1f2";
  const errBorder = isDark ? "rgba(239,68,68,0.3)"  : "#fecdd3";
  const errColor  = isDark ? "#f87171"               : "#dc2626";
  const delBg     = isDark ? "rgba(239,68,68,0.08)" : "#fff1f2";
  const delBorder = isDark ? "rgba(239,68,68,0.35)" : "#fecdd3";

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div key="bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40" onClick={onClose}
            style={{ background: isDark ? "rgba(0,0,0,0.72)" : "rgba(15,23,42,0.55)" }} />

          <div className="fixed inset-0 flex items-center justify-center z-50 px-4 pointer-events-none">
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.9, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 24 }}
              transition={{ type: "spring", damping: 22, stiffness: 340 }}
              ref={cardRef}
              drag
              dragControls={dragControls}
              dragListener={false}
              dragMomentum={false}
              dragElastic={0.06}
              whileDrag={{
                scale: 1.018,
              }}
              onDragStart={() => {}}
              onDragEnd={() => {}}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md rounded relative pointer-events-auto"
              style={{
                background: "var(--modal)",
                border: "1px solid var(--border)",
                boxShadow: isDark
                  ? "0 32px 80px rgba(0,0,0,0.8)"
                  : "0 8px 16px rgba(0,0,0,0.10), 0 24px 64px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)",
                maxHeight: "90vh",
                overflow: "hidden",
                cursor: "default",
              }}>
              <div style={{ overflowY: "auto", maxHeight: "90vh" }}>

              {/* Header — drag handle (only this area initiates drag) */}
              <div className="flex items-center justify-between px-6 pt-4 pb-3"
                style={{ borderBottom: "1px solid var(--border)", cursor: "grab", touchAction: "none" }}
                onPointerDown={(e) => dragControls.start(e)}>
                <div>
                  <h2 className="font-bold text-base" style={{ color: "var(--text)" }}>
                    {view === "confirmDelete" ? t("booking.confirmDelete") :
                     isReadOnly ? t("booking.viewInfo") :
                     isEdit ? t("booking.modalEdit") : t("booking.modalNew")}
                  </h2>
                  {isEdit && tgUser && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#06b6d4" }} />
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("booking.organizer")} </span>
                      <a href={tgLink} target="_blank" rel="noreferrer"
                        className="text-xs font-semibold hover:underline" style={{ color: "#0891b2" }}>
                        {tgLabel}
                      </a>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={onClose}
                    className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                    style={{ color: "var(--text-muted)", background: "var(--elevated)" }}
                    onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
                    </svg>
                  </button>
                </div>
              </div>

              <AnimatePresence mode="wait">

                {/* ── Read-only view ── */}
                {isReadOnly && editBooking ? (
                  <motion.div key="readonly" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="px-6 py-5 space-y-3">
                    <div className="rounded-md p-4 space-y-2"
                      style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                      <p className="font-bold text-base" style={{ color: "var(--text)" }}>{editBooking.title}</p>
                      <p className="text-sm" style={{ color: "var(--text-sec)" }}>
                        {fmtTime(editBooking.start_time)} — {fmtHM(editBooking.end_time)}
                      </p>
                      {editBooking.description && (
                        <p className="text-xs" style={{ color: "var(--text-sec)" }}>{editBooking.description}</p>
                      )}
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("booking.author")} {tgUser?.display_name}</p>
                      {editBooking.guests?.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {editBooking.guests.map(g => (
                            <span key={g} className="px-2 py-0.5 rounded text-xs font-semibold"
                              style={{ background: "var(--primary-light)", border: "1px solid var(--primary-border)", color: "var(--primary)" }}>
                              @{g}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Attachments visible to guests (read-only) */}
                    <AttachmentsSection
                      bookingId={editBooking.id}
                      canManage={false}
                      pendingFiles={[]}
                      onAddPending={() => {}}
                      onRemovePending={() => {}}
                    />
                    {tgUser && (
                      <a href={tgLink} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 w-full py-2.5 px-4 rounded-md text-sm font-semibold justify-center"
                        style={{ background: isDark ? "rgba(6,182,212,0.1)" : "#ecfeff", border: isDark ? "1px solid rgba(6,182,212,0.3)" : "1px solid #a5f3fc", color: "#0891b2" }}>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                        </svg>
                        {t("booking.writeTg")}
                      </a>
                    )}
                    {editBooking.video_enabled && (
                      isPast ? (
                        <button
                          type="button"
                          onClick={() => setChatOpen(true)}
                          className="w-full py-2.5 px-4 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                          style={{ background: "var(--elevated)", border: "1.5px solid var(--border)", color: "var(--text)" }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                          </svg>
                          {t("booking.chatHistory")}
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <button
                              onClick={handleJoinVideo}
                              className="flex-1 py-2.5 rounded-md text-sm font-bold text-white flex items-center justify-center gap-2 transition-all"
                              style={{ background: "linear-gradient(135deg,#1565a8,#114e85)", boxShadow: "0 4px 16px rgba(21,101,168,0.3)" }}
                            >
                              {t("booking.joinConference")}
                            </button>
                            <button
                              onClick={handleCopyMeetingLink}
                              disabled={!guestInviteUrl}
                              title={t("booking.copyGuestLink")}
                              className="px-3 py-2.5 rounded-md text-sm font-bold transition-all flex items-center justify-center disabled:opacity-40"
                              style={{ background: copiedLink ? "rgba(34,197,94,0.15)" : "var(--elevated)", border: `1.5px solid ${copiedLink ? "rgba(34,197,94,0.5)" : "var(--border)"}`, color: copiedLink ? "#22c55e" : "var(--text-sec)", minWidth: 42 }}
                            >
                              {copiedLink ? "✓" : "🔗"}
                            </button>
                          </div>
                          {guestInviteLoading ? (
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("booking.creatingLink")}</p>
                          ) : guestInviteUrl ? (
                            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                              <span className="flex-1 text-xs truncate" style={{ color: "var(--text-muted)" }}>{guestInviteUrl}</span>
                            </div>
                          ) : null}
                        </div>
                      )
                    )}
                    <button onClick={onClose}
                      className="w-full py-2.5 rounded-md text-sm font-medium transition-all"
                      style={{ border: "1px solid var(--border)", color: "var(--text-sec)", background: "var(--elevated)" }}>
                      {t("booking.close")}
                    </button>
                  </motion.div>
                ) :

                /* ── Delete confirm ── */
                view === "confirmDelete" ? (
                  <motion.div key="del" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="px-6 py-5 space-y-3">
                    <div className="rounded-md p-4" style={{ background: delBg, border: `1px solid ${delBorder}` }}>
                      <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
                        {t("booking.deleteConfirmQ", { title: editBooking?.title ?? "" })}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {t("booking.deleteConfirmMsg")}
                      </p>
                    </div>

                    {/* Delete series option */}
                    {editBooking?.recurrence_group_id && (
                      <label className="flex items-center gap-2 px-1 cursor-pointer">
                        <input type="checkbox" checked={deleteSeries} onChange={e => setDelSeries(e.target.checked)}
                          className="rounded" style={{ accentColor: "var(--primary)" }} />
                        <span className="text-xs font-semibold" style={{ color: "var(--text-sec)" }}>
                          {t("booking.deleteSeriesAll")}
                        </span>
                      </label>
                    )}

                    <div className="flex gap-3">
                      <button onClick={() => setView("form")}
                        className="flex-1 py-2.5 rounded-md text-sm font-medium transition-all"
                        style={{ border: "1px solid var(--border)", color: "var(--text-sec)", background: "var(--elevated)" }}>
                        {t("common.cancel")}
                      </button>
                      <button onClick={handleDelete} disabled={isDeleting}
                        className="flex-1 py-2.5 rounded-md text-sm font-bold text-white disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg,#dc2626,#ef4444)", boxShadow: "0 4px 14px rgba(220,38,38,0.3)" }}>
                        {isDeleting ? t("booking.deleting") : t("common.delete")}
                      </button>
                    </div>
                  </motion.div>
                ) : (

                /* ── Edit / Create form ── */
                <motion.form key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  onSubmit={handleSubmit} className="px-6 py-4 space-y-3">

                  <AnimatePresence>
                    {easterMsg && (
                      <motion.div
                        key={easterMsg}
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        style={{
                          background: "linear-gradient(135deg,#1565a8,#06b6d4)",
                          borderRadius: 6, padding: "8px 14px", marginBottom: 8,
                          fontSize: 13, fontWeight: 700, color: "#fff",
                        }}
                      >
                        {easterMsg}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Booking type tabs */}
                  {!isEdit && (
                    <div className="flex gap-1.5 mb-1">
                      {([
                        { value: "physical", label: t("booking.typePhysical") },
                        { value: "virtual",  label: t("booking.typeVirtual")  },
                        { value: "hybrid",   label: t("booking.typeHybrid")   },
                      ] as const).map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setBookingType(opt.value)}
                          className="flex-1 py-1.5 rounded text-xs font-semibold transition-all"
                          style={{
                            background: bookingType === opt.value ? "var(--primary)" : "var(--elevated)",
                            border: bookingType === opt.value ? "1.5px solid var(--primary)" : "1.5px solid var(--border)",
                            color: bookingType === opt.value ? "#fff" : "var(--text-sec)",
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Title */}
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-sec)" }}>
                      {t("booking.title")} <span style={{ color: "#ef4444", fontWeight: 400 }}>({t("booking.titleRequired")})</span>
                    </label>
                    <input type="text" autoFocus value={title}
                      onChange={e => { setTitle(e.target.value); if (fieldErrors.title) setFieldErrors(fe => ({ ...fe, title: undefined })); }}
                      placeholder={t("booking.titlePlaceholder")}
                      className="w-full rounded-md px-3 py-2.5 text-sm outline-none transition-all"
                      style={{
                        background: "var(--input-bg)",
                        border: `1.5px solid ${importantTitle ? "#ef4444" : fieldErrors.title ? "#ef4444" : "var(--input-border)"}`,
                        color: "var(--text)",
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = fieldErrors.title ? "#ef4444" : "var(--primary)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(21,101,168,0.12)"; }}
                      onBlur={e => { e.currentTarget.style.borderColor = fieldErrors.title ? "#ef4444" : "var(--input-border)"; e.currentTarget.style.boxShadow = "none"; }} />
                    {fieldErrors.title && (
                      <p className="text-xs mt-1 font-medium" style={{ color: "#ef4444" }}>{fieldErrors.title}</p>
                    )}
                  </div>

                  {/* Room selector — hidden for virtual bookings */}
                  {bookingType !== "virtual" && (() => {
                    const availableRooms = activeWorkspace
                      ? myRooms.filter(wr => wr.workspace_id === activeWorkspace.id)
                      : myRooms;
                    if (availableRooms.length === 0) return null;
                    return (
                      <div>
                        <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-sec)" }}>
                          Переговорная <span style={{ color: "#ef4444", fontWeight: 400 }}>(обязательно)</span>
                        </label>
                        <div ref={roomDropRef} style={{ position: "relative" }}>
                          <button
                            type="button"
                            disabled={isEdit}
                            onClick={() => !isEdit && setRoomDropOpen(v => !v)}
                            onBlur={e => { if (!roomDropRef.current?.contains(e.relatedTarget as Node)) setRoomDropOpen(false); }}
                            className="w-full rounded-md px-3 py-2.5 text-sm text-left flex items-center justify-between gap-2 transition-all outline-none"
                            style={{
                              background: "var(--input-bg)",
                              border: `1.5px solid ${fieldErrors.room ? "#ef4444" : roomDropOpen ? "var(--primary)" : "var(--input-border)"}`,
                              color: selectedRoomId === "" ? "var(--text-muted)" : "var(--text)",
                              opacity: isEdit ? 0.6 : 1,
                              boxShadow: roomDropOpen ? "0 0 0 3px rgba(21,101,168,0.12)" : "none",
                            }}
                          >
                            <span>
                              {selectedRoomId === ""
                                ? "— не выбрана —"
                                : (() => { const wr = availableRooms.find(r => r.room.id === selectedRoomId); return wr ? `${wr.room.name}${wr.role === "shared" ? " (общая)" : ""}` : "— не выбрана —"; })()}
                            </span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, opacity: 0.5, transform: roomDropOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                              <path d="m6 9 6 6 6-6"/>
                            </svg>
                          </button>
                          {roomDropOpen && (
                            <div
                              style={{
                                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
                                background: isDark ? "#0f172a" : "#ffffff", border: "1.5px solid var(--border)",
                                borderRadius: 6, overflow: "hidden",
                                boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.6)" : "0 4px 20px rgba(0,0,0,0.12)",
                              }}
                            >
                              {[{ id: "" as const, name: "— не выбрана —", shared: false }, ...availableRooms.map(wr => ({ id: wr.room.id, name: wr.room.name, shared: wr.role === "shared" }))].map(opt => (
                                <button
                                  key={String(opt.id)}
                                  type="button"
                                  onMouseDown={() => { setSelectedRoomId(opt.id); setRoomDropOpen(false); if (fieldErrors.room) setFieldErrors(fe => ({ ...fe, room: undefined })); }}
                                  className="w-full px-3 py-2.5 text-sm text-left flex items-center gap-2 transition-all"
                                  style={{
                                    background: selectedRoomId === opt.id ? "var(--primary-light)" : "transparent",
                                    color: opt.id === "" ? "var(--text-muted)" : "var(--text)",
                                  }}
                                  onMouseEnter={e => { if (selectedRoomId !== opt.id) e.currentTarget.style.background = "var(--elevated)"; }}
                                  onMouseLeave={e => { if (selectedRoomId !== opt.id) e.currentTarget.style.background = "transparent"; }}
                                >
                                  {selectedRoomId === opt.id && opt.id !== "" && (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" style={{ color: "var(--primary)", flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
                                  )}
                                  <span>{opt.name}{opt.shared ? " (общая)" : ""}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {fieldErrors.room && <p className="text-xs mt-1" style={{ color: "#ef4444" }}>{fieldErrors.room}</p>}
                      </div>
                    );
                  })()}

                  {/* Date/time + duration — compact combined block */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <DateTimePicker label={t("booking.start")} value={startTime}
                        onChange={v => { setStart(v); setFieldErrors(fe => ({ ...fe, time: undefined })); }} />
                      <DateTimePicker label={t("booking.end")} value={endTime}
                        onChange={v => { setEnd(v); setFieldErrors(fe => ({ ...fe, time: undefined })); }} />
                    </div>
                    {fieldErrors.time && (
                      <p className="text-xs font-medium" style={{ color: "#ef4444" }}>{fieldErrors.time}</p>
                    )}
                    {!isEdit && conflicts.length > 0 && !fieldErrors.time && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                        className="rounded-md px-3 py-2 space-y-1"
                        style={{ background: isDark ? "rgba(239,68,68,0.08)" : "#fff1f2", border: "1px solid rgba(239,68,68,0.25)" }}>
                        <p className="text-xs font-semibold" style={{ color: "#ef4444" }}>⚠️ {t("booking.conflictsWith", { n: conflicts.length })}</p>
                        {conflicts.map(c => (
                          <p key={c.id} className="text-xs" style={{ color: isDark ? "#fca5a5" : "#dc2626" }}>
                            • {c.title} ({fmtHM(c.start_time)}–{fmtHM(c.end_time)})
                          </p>
                        ))}
                      </motion.div>
                    )}
                    <div className="flex gap-1.5">
                      {PRESETS.map(p => {
                        const active = currentDurationMins === p.minutes;
                        return (
                          <motion.button key={p.key} type="button" onClick={() => applyPreset(p.minutes)}
                            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                            className="flex-1 py-1.5 rounded text-xs font-bold transition-all"
                            style={{
                              background: active ? "var(--primary)" : "var(--primary-light)",
                              border: `1.5px solid ${active ? "var(--primary)" : "var(--primary-border)"}`,
                              color: active ? "#fff" : "var(--primary)",
                            }}>
                            {t(p.key)}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Guests */}
                  <GuestInput guests={guests} setGuests={setGuests} />

                  {/* Recurrence (only on create) */}
                  {!isEdit && (
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold" style={{ color: "var(--text-sec)" }}>{t("booking.recurrence")}</label>
                      <div className="flex gap-1.5">
                        {RECURRENCE_OPTIONS.map(opt => (
                          <button key={opt.value} type="button"
                            onClick={() => {
                              setRecur(opt.value);
                              if (opt.value !== "none" && !recurUntil) {
                                const d = new Date(startTime || Date.now());
                                d.setMonth(d.getMonth() + (opt.value === "daily" ? 1 : 3));
                                setRecurUntil(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
                              }
                            }}
                            className="flex-1 py-1.5 rounded text-xs font-semibold transition-all"
                            style={{
                              background: recurrence === opt.value ? "var(--primary)" : "var(--elevated)",
                              border: recurrence === opt.value ? "1.5px solid var(--primary)" : "1.5px solid var(--border)",
                              color: recurrence === opt.value ? "#fff" : "var(--text-sec)",
                            }}>
                            {t(opt.key)}
                          </button>
                        ))}
                      </div>
                      {recurrence === "custom" && (
                        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                          <label className="block text-xs font-semibold mb-1.5" style={{ color: fieldErrors.days ? "#ef4444" : "var(--text-sec)" }}>
                            {t("booking.weekdays")} {fieldErrors.days && <span className="font-normal">— {fieldErrors.days}</span>}
                          </label>
                          <div className="flex gap-1">
                            {WEEKDAYS.map(d => {
                              const on = recurDays.includes(d.idx);
                              return (
                                <button key={d.idx} type="button"
                                  onClick={() => { setRecurDays(days => on ? days.filter(x => x !== d.idx) : [...days, d.idx].sort()); setFieldErrors(fe => ({ ...fe, days: undefined })); }}
                                  className="flex-1 py-1 rounded text-xs font-bold transition-all"
                                  style={{
                                    background: on ? "var(--primary)" : "var(--elevated)",
                                    border: `1.5px solid ${on ? "var(--primary)" : "var(--border)"}`,
                                    color: on ? "#fff" : "var(--text-sec)",
                                  }}>
                                  {t(d.key)}
                                </button>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                      {recurrence !== "none" && (
                        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
                          <DateTimePicker label={t("booking.repeatUntil")} value={recurUntil} onChange={setRecurUntil} dateOnly />
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* Video conference — forced on for virtual/hybrid, optional for physical */}
                  {bookingType === "physical" ? (
                    <label className="flex items-center gap-2.5 cursor-pointer select-none py-1">
                      <input
                        type="checkbox"
                        checked={videoEnabled}
                        onChange={e => setVideoEnabled(e.target.checked)}
                        className="w-4 h-4 rounded"
                        style={{ accentColor: "var(--primary)" }}
                      />
                      <span className="text-sm font-medium" style={{ color: "var(--text-sec)" }}>
                        {t("booking.needVideo")}
                      </span>
                      {videoEnabled && editBooking?.video_room_name && (
                        <span className="text-xs font-semibold" style={{ color: isDark ? "#4ade80" : "#16a34a" }}>
                          ✓ Готова
                        </span>
                      )}
                    </label>
                  ) : (
                    <div className="flex items-center gap-2 py-1 px-3 rounded-md text-sm"
                      style={{ background: "var(--elevated)", border: "1px solid var(--border)", color: "var(--text-sec)" }}>
                      <span className="font-medium">
                        {bookingType === "virtual" ? t("booking.videoOnlineInfo") : t("booking.videoHybridInfo")}
                      </span>
                    </div>
                  )}

                  {/* Collapsible: description + attachments */}
                  <div>
                    <button type="button" onClick={() => setShowAdvanced(v => !v)}
                      className="flex items-center gap-1.5 w-full text-xs font-medium transition-all py-1"
                      style={{ color: "var(--text-muted)" }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.18s", flexShrink: 0 }}>
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                      {showAdvanced ? "Скрыть повестку и материалы" : "Добавить повестку и материалы"}
                    </button>
                    <AnimatePresence>
                      {showAdvanced && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                          style={{ overflow: "hidden" }} className="space-y-3 pt-2">
                          <div>
                            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-sec)" }}>
                              {t("booking.agenda")}
                            </label>
                            <textarea value={description} onChange={e => setDesc(e.target.value)}
                              rows={3} placeholder={t("booking.agendaPlaceholder")}
                              className="w-full rounded-md px-3 py-2.5 text-sm outline-none transition-all resize-none"
                              style={{ background: "var(--input-bg)", border: "1.5px solid var(--input-border)", color: "var(--text)" }}
                              onFocus={e => { e.currentTarget.style.borderColor = "var(--primary)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(21,101,168,0.12)"; }}
                              onBlur={e => { e.currentTarget.style.borderColor = "var(--input-border)"; e.currentTarget.style.boxShadow = "none"; }} />
                          </div>
                          <AttachmentsSection
                            bookingId={editBooking?.id}
                            canManage={!isReadOnly}
                            pendingFiles={pendingFiles}
                            onAddPending={files => setPendingFiles(pf => [...pf, ...files])}
                            onRemovePending={i => setPendingFiles(pf => pf.filter((_, idx) => idx !== i))}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {error && (
                    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className="text-xs rounded-md px-3 py-2.5 font-medium"
                      style={{ background: errBg, border: `1px solid ${errBorder}`, color: errColor }}>
                      ⚠️ {error}
                    </motion.p>
                  )}

                  {isEdit && editBooking?.video_enabled && (
                    isPast ? (
                      <button
                        type="button"
                        onClick={() => setChatOpen(true)}
                        className="w-full py-2.5 px-4 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                        style={{ background: "var(--elevated)", border: "1.5px solid var(--border)", color: "var(--text)" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        {t("booking.chatHistory")}
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleJoinVideo}
                            className="flex-1 py-2.5 rounded-md text-sm font-bold text-white flex items-center justify-center gap-2 transition-all"
                            style={{ background: "linear-gradient(135deg,#1565a8,#114e85)", boxShadow: "0 4px 16px rgba(21,101,168,0.3)" }}
                          >
                            {t("booking.joinConference")}
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyMeetingLink}
                            disabled={!guestInviteUrl}
                            title={t("booking.copyGuestLink")}
                            className="px-3 py-2.5 rounded-md text-sm font-bold transition-all flex items-center justify-center disabled:opacity-40"
                            style={{ background: copiedLink ? "rgba(34,197,94,0.15)" : "var(--elevated)", border: `1.5px solid ${copiedLink ? "rgba(34,197,94,0.5)" : "var(--border)"}`, color: copiedLink ? "#22c55e" : "var(--text-sec)", minWidth: 42 }}
                          >
                            {copiedLink ? "✓" : "🔗"}
                          </button>
                        </div>
                        {guestInviteLoading ? (
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("booking.creatingLink")}</p>
                        ) : guestInviteUrl ? (
                          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                            <span className="flex-1 text-xs truncate" style={{ color: "var(--text-muted)" }}>{guestInviteUrl}</span>
                          </div>
                        ) : null}
                      </div>
                    )
                  )}
                  <div className="flex gap-2" style={{
                    position: "sticky",
                    bottom: 0,
                    background: "var(--modal)",
                    borderTop: "1px solid var(--border)",
                    padding: "12px 24px 20px",
                    margin: "8px -24px -16px",
                  }}>
                    {isEdit && canDelete && (
                      <motion.button type="button" onClick={() => setView("confirmDelete")}
                        whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                        className="py-2.5 px-4 rounded-md text-sm font-semibold"
                        style={{ border: `1.5px solid ${delBorder}`, color: errColor, background: delBg }}>
                        {t("common.delete")}
                      </motion.button>
                    )}
                    <button type="button" onClick={onClose}
                      className="flex-1 py-2.5 rounded-md text-sm font-medium transition-all"
                      style={{ border: "1.5px solid var(--border)", color: "var(--text-sec)", background: "var(--elevated)" }}>
                      {t("common.cancel")}
                    </button>
                    <motion.button type="submit" disabled={isCreating || isUpdating}
                      whileHover={{ scale: 1.02, boxShadow: "0 6px 24px rgba(21,101,168,0.4)" }}
                      whileTap={{ scale: 0.98 }}
                      className="flex-1 py-2.5 rounded-md text-sm font-bold text-white disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg,#1565a8,#114e85)", boxShadow: "0 4px 16px rgba(21,101,168,0.25)" }}>
                      {(isCreating || isUpdating) ? t("booking.saving") : isEdit ? t("common.save") : t("booking.book")}
                    </motion.button>
                  </div>
                </motion.form>
                )}
              </AnimatePresence>
              </div>
            </motion.div>
          </div>

          {/* canvas confetti is injected directly into document.body via useEffect */}
        </>
      )}

    </AnimatePresence>
      {/* Chat history modal — rendered in portal to escape parent transforms */}
      {chatOpen && editBooking && createPortal(
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
          }}
          onClick={() => setChatOpen(false)}
        >
          <div
            style={{ width: 440, height: 580, borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}
            onClick={e => e.stopPropagation()}
          >
            <MeetingChatPanel
              bookingId={editBooking.id}
              readOnly
              onClose={() => setChatOpen(false)}
              style={{ flex: 1, minHeight: 0, borderRadius: 8 }}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
