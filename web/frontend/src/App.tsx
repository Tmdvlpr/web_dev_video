import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { MeetingRoom } from "./components/Video/MeetingRoom";
import { GuestJoinPage } from "./components/Video/GuestJoinPage";
import { bookingsApi } from "./api/bookings";
import LoginPage from "./components/Auth/LoginPage";
import RegistrationPage from "./components/Auth/RegistrationPage";
import SessionAuthPage from "./components/Auth/SessionAuthPage";
import { ProfileEditModal } from "./components/Auth/ProfileEditModal";
import { Calendar } from "./components/Calendar";
import { ActiveMeetings } from "./components/Dashboard/BookingsList";
import { BookingModal } from "./components/Dashboard/BookingModal";
import { NotificationCenter, addNotification, getReminderMinutes } from "./components/Dashboard/NotificationCenter";
import { AdminPanel } from "./components/Dashboard/AdminPanel";
import { SubmissionsPanel } from "./components/Dashboard/SubmissionsPanel";
import { SplashScreen } from "./components/Common/SplashScreen";
import { LanguageToggle } from "./components/Common/LanguageToggle";
import { FeedbackModal } from "./components/Common/FeedbackModal";
import { UserAvatar } from "./components/Common/UserAvatar";
import { AvatarPicker } from "./components/Common/AvatarPicker";
import OpenInBrowserButton from "./components/MiniApp/OpenInBrowserButton";
import { useTheme } from "./contexts/ThemeContext";
import { useLocale } from "./contexts/LocaleContext";
import { useAuth } from "./hooks/useAuth";
import { useTelegram } from "./hooks/useTelegram";
import type { Booking } from "./types";

// ── Web notification reminders ──────────────────────────────────────────────
function useWebReminders(isAuthenticated: boolean) {
  // notifiedRef: Set of "bookingId-reminderMinutes" strings to avoid double-firing
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isAuthenticated) return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const check = async () => {
      if (Notification.permission !== "granted") return;
      const n = new Date();
      const today = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
      const reminderMins = getReminderMinutes();
      try {
        const bookings = await bookingsApi.getByDate(today);
        const now = Date.now();
        for (const b of bookings) {
          const startMs = new Date(b.start_time).getTime();
          for (const mins of reminderMins) {
            const key = `${b.id}-${mins}`;
            const diff = startMs - now;
            const threshold = mins * 60_000;
            if (diff > 0 && diff <= threshold && !notifiedRef.current.has(key)) {
              notifiedRef.current.add(key);
              const label = mins < 60 ? `${mins} минут` : `${mins / 60} час`;
              const title = `⏰ Встреча через ${label}`;
              const body = `${b.title} · ${new Date(b.start_time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
              new Notification(title, { body, icon: "/logo.png" });
              addNotification({
                id: key,
                title,
                body,
                time: Date.now(),
                bookingId: b.id,
                reminderMinutes: mins,
              });
            }
          }
        }
      } catch (err) {
        console.error("Failed to check web reminders:", err);
      }
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [isAuthenticated]);
}

// ── Toast ────────────────────────────────────────────────────────────────────
interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}
let _tid = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = (message: string, type: Toast["type"] = "success") => {
    const id = ++_tid;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };
  return { toasts, add };
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  const { isDark } = useTheme();
  const colors: Record<Toast["type"], { bg: string; border: string; text: string }> = isDark
    ? {
        success: { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.35)", text: "#34d399" },
        error: { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)", text: "#f87171" },
        info: { bg: "rgba(21,101,168,0.15)", border: "rgba(21,101,168,0.4)", text: "#5ba3df" },
      }
    : {
        success: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" },
        error: { bg: "#fef2f2", border: "#fecaca", text: "#dc2626" },
        info: { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" },
      };
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => {
          const c = colors[t.type];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
              className="px-4 py-3 rounded-2xl text-sm font-semibold"
              style={{
                background: c.bg,
                border: `1px solid ${c.border}`,
                color: c.text,
                boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5)" : "0 4px 20px rgba(0,0,0,0.1)",
                backdropFilter: isDark ? "blur(16px)" : undefined,
              }}
            >
              {t.message}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── Theme toggle ─────────────────────────────────────────────────────────────
function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  return (
    <motion.button
      onClick={toggle}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.93 }}
      className="w-8 h-8 flex items-center justify-center rounded-lg transition-all text-sm"
      title={isDark ? "Светлая тема" : "Тёмная тема"}
      style={{
        border: "1px solid var(--border)",
        background: "var(--elevated)",
        color: "var(--text-sec)",
      }}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={isDark ? "sun" : "moon"}
          initial={{ opacity: 0, rotate: -45, scale: 0.5 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 45, scale: 0.5 }}
          transition={{ duration: 0.18 }}
        >
          {isDark ? "☀️" : "🌙"}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard() {
  const { user, logout } = useAuth();
  const { isMiniApp: miniApp } = useTelegram();
  const { isDark } = useTheme();
  const { t } = useLocale();
  const { toasts, add: addToast } = useToasts();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [activeOpen, setActiveOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [submissionsOpen, setSubmissionsOpen] = useState(false);
  const [slotStart, setSlotStart] = useState<Date | undefined>();
  const [slotEnd, setSlotEnd] = useState<Date | undefined>();
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const avatarPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (avatarPickerRef.current && !avatarPickerRef.current.contains(e.target as Node)) {
        setAvatarPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const handleSlotClick = (start: Date, end: Date) => {
    setEditBooking(null);
    setSlotStart(start);
    setSlotEnd(end);
    setModalOpen(true);
  };

  const handleCardClick = (booking: Booking) => {
    setEditBooking(booking);
    setSlotStart(undefined);
    setSlotEnd(undefined);
    setModalOpen(true);
  };

  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const isSuperadmin = user?.role === "superadmin";
  const canEdit = editBooking
    ? user?.id === editBooking.user_id || isAdmin
    : false;

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <header
        className="flex items-center justify-between px-5 shrink-0 relative"
        style={{
          height: 52,
          borderBottom: "1px solid var(--border)",
          background: "var(--header)",
          backdropFilter: "blur(24px)",
          zIndex: 30,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative shrink-0">
            <svg viewBox="0 0 184 184" width="26" height="26">
              <rect x="0" y="0" width="183.477" height="183.476" rx="24" fill={isDark ? "#1e293b" : "#ffffff"} stroke={isDark ? "#334155" : "#e0e0e0"} strokeWidth="1" />
              <path d="M183.477 -0.000213652H24.1003C10.8448 -0.000213652 0 10.8442 0 24.1002V29.4577C4.35965 30.1241 9.2007 31.4108 14.4453 33.2707C30.9597 39.1299 51.5212 50.7097 73.5983 66.6973C91.5408 53.3303 108.051 43.7672 121.444 39.0204C134.526 34.3831 144.68 34.3293 150.36 39.7837C156.794 45.9587 156.535 58.3064 150.797 74.4786C144.935 90.9937 133.356 111.555 117.37 133.632C130.738 151.575 140.298 168.087 145.045 181.48C145.286 182.154 145.511 182.818 145.725 183.476H159.377C172.632 183.476 183.477 172.634 183.477 159.378V-0.000213652Z" fill="#1565a8"/>
              <path d="M0 101.189V159.376C0 168.393 5.01728 176.29 12.3973 180.42C18.0218 180.586 24.8281 179.206 32.5683 176.422C48.3471 170.754 67.9784 159.273 89.4463 143.198C89.6156 143.069 89.8609 143.105 89.9921 143.275C90.1104 143.434 90.0894 143.658 89.949 143.793C83.9014 149.56 77.876 155.016 71.9314 160.131C65.8788 165.336 59.906 170.191 54.0732 174.655L54.0705 174.658L50.6656 177.231L50.6641 177.232L50.6599 177.235L50.6572 177.237C47.73 179.421 44.8397 181.502 41.9898 183.475H116.387C121.896 177.132 121.584 165.949 116.392 151.497C110.722 135.719 99.2405 116.088 83.1656 94.6182C83.0359 94.4481 83.071 94.2006 83.2423 94.0716C83.4017 93.9534 83.6256 93.9747 83.7592 94.1147H83.7611C89.5271 100.163 94.9865 106.19 100.101 112.134C105.16 118.017 109.887 123.825 114.25 129.503C121.803 114.774 126.675 101.709 128.415 91.1596C130.095 80.9622 128.849 73.1332 124.268 68.4527C118.097 62.1511 106.564 62.2476 91.463 67.6745C75.6841 73.3441 56.0556 84.8229 34.5862 100.899C34.4156 101.028 34.1715 100.994 34.0391 100.821C33.9217 100.663 33.943 100.438 34.0842 100.305H34.083C40.1287 94.5412 46.1515 89.0841 52.0938 83.9737C57.9766 78.9107 63.7907 74.1829 69.4702 69.8191C54.7411 62.2655 41.6766 57.3913 31.1279 55.6515C20.9285 53.9692 13.1007 55.2151 8.42024 59.7979C2.11631 65.9691 2.21587 77.5024 7.64207 92.6007C13.3097 108.38 24.7911 128.011 40.8664 149.476C40.9965 149.648 40.9587 149.894 40.7867 150.023C40.6299 150.143 40.4056 150.122 40.2706 149.979V149.982C34.5064 143.936 29.052 137.913 23.9397 131.971C18.7325 125.916 13.8754 119.941 9.4105 114.105L9.40821 114.104L6.83453 110.699L6.83148 110.697L6.83034 110.692L6.8269 110.69C4.42679 107.474 2.15065 104.304 0 101.189Z" fill="#1565a8"/>
            </svg>
          </div>
          <span style={{
            fontFamily: "Manrope, sans-serif", fontWeight: 800, fontSize: 26,
            lineHeight: 1, letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            <span style={{ color: isDark ? "#f8fafc" : "#0f172a" }}>Corp</span>
            <span style={{ color: isDark ? "#5ba3df" : "#1565a8" }}>meet</span>
          </span>
        </div>

        {/* Right: labeled buttons */}
        <div className="flex items-center gap-1">
          {/* Avatar + name */}
          <div className="relative" ref={avatarPickerRef}>
            <div
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
              style={{ color: "var(--text-sec)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-sec)"; }}
              onClick={() => setActiveOpen(true)}
            >
              <div
                onClick={e => { e.stopPropagation(); setAvatarPickerOpen(v => !v); }}
                className="shrink-0 rounded-full transition-all"
                style={{ outline: avatarPickerOpen ? "2px solid var(--primary)" : undefined, outlineOffset: 2 }}
              >
                <UserAvatar displayName={user?.display_name ?? ""} avatar={user?.avatar} size={20} />
              </div>
              {user?.display_name}
            </div>
            <AnimatePresence>
              {avatarPickerOpen && user && (
                <AvatarPicker user={user} onClose={() => setAvatarPickerOpen(false)} />
              )}
            </AnimatePresence>
          </div>

          <div className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />

          {/* Notifications */}
          <button onClick={() => setNotifOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-muted)"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>

          {/* Admin */}
          {isAdmin && (
            <button onClick={() => setAdminOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--primary)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-muted)"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              {t("nav.admin")}
            </button>
          )}

          {isSuperadmin && (
            <button onClick={() => setSubmissionsOpen(true)}
              title={t("submissions.title")}
              className="flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--primary)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-muted)"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
            </button>
          )}

          <button onClick={() => setFeedbackOpen(true)}
            title={t("feedback.button")}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-muted)"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
          </button>

          {miniApp && <OpenInBrowserButton />}

          <LanguageToggle />
          <ThemeToggle />

          {/* Profile */}
          <button onClick={() => setProfileOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text-muted)"; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            {t("nav.profile")}
          </button>

          {/* Logout */}
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--danger)"; e.currentTarget.style.background = isDark ? "rgba(252,165,165,0.08)" : "rgba(239,68,68,0.05)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = ""; }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            {t("nav.logout")}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <Calendar
          currentUser={user ?? null}
          onSlotClick={handleSlotClick}
          onCardClick={handleCardClick}
        />
      </main>

      {/* FAB — floating + button */}
        <button
          onClick={() => handleSlotClick(new Date(), new Date(Date.now() + 3_600_000))}
          className="fixed z-40 flex items-center justify-center rounded-2xl text-white cursor-pointer"
          style={{
            bottom: 24, right: 24,
            width: 56, height: 56,
            background: "linear-gradient(135deg,#1565a8,#3b82f6)",
            boxShadow: "0 4px 20px rgba(21,101,168,0.40)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </button>

      <ActiveMeetings
        isOpen={activeOpen}
        onClose={() => setActiveOpen(false)}
        onCardClick={handleCardClick}
      />

      <NotificationCenter
        isOpen={notifOpen}
        onClose={() => setNotifOpen(false)}
      />

      {isAdmin && (
        <AdminPanel
          isOpen={adminOpen}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {isSuperadmin && (
        <SubmissionsPanel
          isOpen={submissionsOpen}
          onClose={() => setSubmissionsOpen(false)}
        />
      )}

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSuccess={(msg) => addToast(msg)}
        onError={(msg) => addToast(msg, "error")}
      />

      <BookingModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditBooking(null);
        }}
        initialStart={slotStart}
        initialEnd={slotEnd}
        editBooking={editBooking}
        canEdit={canEdit}
        canDelete={canEdit}
        onSuccess={(msg) => addToast(msg)}
        onError={(msg) => addToast(msg, "error")}
      />

      {user && (
        <ProfileEditModal
          open={profileOpen}
          user={user}
          onClose={() => setProfileOpen(false)}
          onSaved={() => addToast(t("profile.saved"))}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}

// ── Meeting room page ─────────────────────────────────────────────────────────
function MeetingRoomPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  return (
    <MeetingRoom
      bookingId={Number(bookingId)}
      onLeave={() => navigate(-1)}
    />
  );
}

// ── Guest join page (no auth required) ───────────────────────────────────────
function GuestJoinPageRoute() {
  const { inviteToken } = useParams<{ inviteToken: string }>();
  return <GuestJoinPage inviteToken={inviteToken ?? ""} />;
}

// ── Auth guard ────────────────────────────────────────────────────────────────
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg)" }}
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 rounded-full border-2"
          style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, user } = useAuth();
  useWebReminders(isAuthenticated);
  const { setLocale } = useLocale();

  // Sync UI locale from user's Telegram language_code (once per session,
  // so manual switch via header toggle isn't overridden).
  useEffect(() => {
    if (!user?.language_code) return;
    if (sessionStorage.getItem("__corpmeet_locale_synced")) return;
    const lower = user.language_code.toLowerCase();
    if (lower.startsWith("uz")) setLocale("uz");
    else if (lower.startsWith("ru")) setLocale("ru");
    sessionStorage.setItem("__corpmeet_locale_synced", "1");
  }, [user?.language_code, setLocale]);

  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    const replay = () => setSplashDone(false);
    window.addEventListener("corpmeet:replay-splash", replay);
    return () => window.removeEventListener("corpmeet:replay-splash", replay);
  }, []);

  // Also catch sessionStorage flag (set before navigate to /bookings)
  useEffect(() => {
    if (!isAuthenticated) return;
    if (sessionStorage.getItem("__corpmeet_replay_splash")) {
      sessionStorage.removeItem("__corpmeet_replay_splash");
      setSplashDone(false);
    }
  }, [isAuthenticated]);

  return (
    <>
      {!splashDone && <SplashScreen onFinish={() => setSplashDone(true)} userName={user?.display_name} />}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegistrationPage />} />
        <Route path="/auth/session/:sessionToken" element={<SessionAuthPage />} />
        <Route
          path="/bookings"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/meeting/:bookingId"
          element={
            <ProtectedRoute>
              <MeetingRoomPage />
            </ProtectedRoute>
          }
        />
        <Route path="/meeting/guest/:inviteToken" element={<GuestJoinPageRoute />} />
        <Route
          path="/"
          element={<Navigate to={isAuthenticated ? "/bookings" : "/login"} replace />}
        />
      </Routes>
    </>
  );
}
