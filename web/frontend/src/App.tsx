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
import { FeedbackModal } from "./components/Common/FeedbackModal";
import { UserAvatar } from "./components/Common/UserAvatar";
import { AvatarPicker } from "./components/Common/AvatarPicker";
import OpenInBrowserButton from "./components/MiniApp/OpenInBrowserButton";
import { useTheme } from "./contexts/ThemeContext";
import { useLocale } from "./contexts/LocaleContext";
import { WorkspaceProvider, useWorkspace } from "./contexts/WorkspaceContext";
import { useAuth } from "./hooks/useAuth";
import { useTelegram } from "./hooks/useTelegram";
import { WorkspaceOnboarding } from "./components/Workspace/WorkspaceOnboarding";
import { WorkspaceSelector } from "./components/Workspace/WorkspaceSelector";
import { WorkspaceSettingsModal } from "./components/Workspace/WorkspaceSettingsModal";
import type { Booking } from "./types";

// ── Web notification reminders ──────────────────────────────────────────────
function useWebReminders(isAuthenticated: boolean) {
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
              addNotification({ id: key, title, body, time: Date.now(), bookingId: b.id, reminderMinutes: mins });
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
interface Toast { id: number; message: string; type: "success" | "error" | "info"; }
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
        error:   { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.35)",  text: "#f87171" },
        info:    { bg: "rgba(21,101,168,0.15)",  border: "rgba(21,101,168,0.4)",  text: "#5ba3df" },
      }
    : {
        success: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" },
        error:   { bg: "#fef2f2", border: "#fecaca", text: "#dc2626" },
        info:    { bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb" },
      };
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => {
          const c = colors[t.type];
          return (
            <motion.div key={t.id}
              initial={{ opacity: 0, x: 60, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }} transition={{ type: "spring", damping: 20, stiffness: 300 }}
              className="px-4 py-3 rounded-md text-sm font-semibold"
              style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text,
                boxShadow: isDark ? "0 8px 32px rgba(0,0,0,0.5)" : "0 4px 20px rgba(0,0,0,0.1)",
                backdropFilter: isDark ? "blur(16px)" : undefined }}>
              {t.message}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── Sidebar icon components ───────────────────────────────────────────────────
const IcPerson  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20v-1a8 8 0 0 1 16 0v1"/></svg>;
const IcBell    = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
const IcCalendar= () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IcShield  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IcFile    = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const IcMsg     = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
const IcSun     = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg>;
const IcMoon    = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
const IcGlobe   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
const IcLogout  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
const IcClose   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IcCamera  = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;

// ── Sidebar nav button ────────────────────────────────────────────────────────
function SideBtn({ label, icon, onClick, danger, rightEl }: {
  label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; rightEl?: React.ReactNode;
}) {
  const { isDark } = useTheme();
  const base = danger ? (isDark ? "#f87171" : "#dc2626") : "var(--text-sec)";
  const hover = danger
    ? (isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)")
    : "var(--elevated)";
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all"
      style={{ color: base, background: "transparent" }}
      onMouseEnter={e => { e.currentTarget.style.background = hover; e.currentTarget.style.color = danger ? base : "var(--text)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = base; }}>
      <span className="w-5 h-5 flex items-center justify-center shrink-0" style={{ opacity: 0.75 }}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {rightEl}
    </button>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-1 pb-1.5 text-xs font-bold tracking-widest uppercase select-none"
      style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard() {
  const { user, logout } = useAuth();
  const { isMiniApp: miniApp } = useTelegram();
  const { isDark, toggle } = useTheme();
  const { t, locale, setLocale } = useLocale();
  const { toasts, add: addToast } = useToasts();
  const { workspaces, isLoading: wsLoading } = useWorkspace();
  const navigate = useNavigate();

  const [modalOpen,      setModalOpen]      = useState(false);
  const [activeOpen,     setActiveOpen]     = useState(false);
  const [notifOpen,      setNotifOpen]      = useState(false);
  const [adminOpen,      setAdminOpen]      = useState(false);
  const [feedbackOpen,   setFeedbackOpen]   = useState(false);
  const [submissionsOpen,setSubmissionsOpen]= useState(false);
  const [wsSettingsOpen, setWsSettingsOpen] = useState(false);
  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [slotStart,      setSlotStart]      = useState<Date | undefined>();
  const [slotEnd,        setSlotEnd]        = useState<Date | undefined>();
  const [editBooking,    setEditBooking]    = useState<Booking | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [profileOpen,    setProfileOpen]    = useState(false);
  const needsOnboarding = !wsLoading && workspaces.length === 0;

  const handleLogout = () => { logout(); navigate("/login", { replace: true }); };

  const handleSlotClick = (start: Date, end: Date) => {
    setEditBooking(null); setSlotStart(start); setSlotEnd(end); setModalOpen(true);
  };
  const handleCardClick = (booking: Booking) => {
    setEditBooking(booking); setSlotStart(undefined); setSlotEnd(undefined); setModalOpen(true);
  };

  const isAdmin    = user?.role === "admin" || user?.role === "superadmin";
  const isSuperadmin = user?.role === "superadmin";
  const canEdit    = editBooking ? user?.id === editBooking.user_id || isAdmin : false;

  const roleLabel  = user?.role === "superadmin" ? "Суперадмин" : user?.role === "admin" ? "Администратор" : "Участник";
  const roleBg     = isSuperadmin ? "rgba(245,158,11,0.12)" : isAdmin ? "rgba(21,101,168,0.12)" : "var(--elevated)";
  const roleColor  = isSuperadmin ? "#d97706" : isAdmin ? "var(--primary)" : "var(--text-muted)";
  const roleBorder = isSuperadmin ? "rgba(245,158,11,0.3)" : isAdmin ? "var(--primary-border)" : "var(--border)";

  const closeSidebar = () => { setSidebarOpen(false); setAvatarPickerOpen(false); };

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      {/* ── Header ── */}
      <header className="flex items-center justify-between px-5 shrink-0 relative"
        style={{ height: 52, background: "var(--header)", backdropFilter: "blur(24px)", zIndex: 30 }}>

        <div className="flex items-center gap-2.5">
          <div className="relative shrink-0">
            <svg viewBox="0 0 184 184" width="26" height="26">
              <rect x="0" y="0" width="183.477" height="183.476" rx="24" fill={isDark ? "#1e293b" : "#ffffff"} stroke={isDark ? "#334155" : "#e0e0e0"} strokeWidth="1" />
              <path d="M183.477 -0.000213652H24.1003C10.8448 -0.000213652 0 10.8442 0 24.1002V29.4577C4.35965 30.1241 9.2007 31.4108 14.4453 33.2707C30.9597 39.1299 51.5212 50.7097 73.5983 66.6973C91.5408 53.3303 108.051 43.7672 121.444 39.0204C134.526 34.3831 144.68 34.3293 150.36 39.7837C156.794 45.9587 156.535 58.3064 150.797 74.4786C144.935 90.9937 133.356 111.555 117.37 133.632C130.738 151.575 140.298 168.087 145.045 181.48C145.286 182.154 145.511 182.818 145.725 183.476H159.377C172.632 183.476 183.477 172.634 183.477 159.378V-0.000213652Z" fill="#1565a8"/>
              <path d="M0 101.189V159.376C0 168.393 5.01728 176.29 12.3973 180.42C18.0218 180.586 24.8281 179.206 32.5683 176.422C48.3471 170.754 67.9784 159.273 89.4463 143.198C89.6156 143.069 89.8609 143.105 89.9921 143.275C90.1104 143.434 90.0894 143.658 89.949 143.793C83.9014 149.56 77.876 155.016 71.9314 160.131C65.8788 165.336 59.906 170.191 54.0732 174.655L54.0705 174.658L50.6656 177.231L50.6641 177.232L50.6599 177.235L50.6572 177.237C47.73 179.421 44.8397 181.502 41.9898 183.475H116.387C121.896 177.132 121.584 165.949 116.392 151.497C110.722 135.719 99.2405 116.088 83.1656 94.6182C83.0359 94.4481 83.071 94.2006 83.2423 94.0716C83.4017 93.9534 83.6256 93.9747 83.7592 94.1147H83.7611C89.5271 100.163 94.9865 106.19 100.101 112.134C105.16 118.017 109.887 123.825 114.25 129.503C121.803 114.774 126.675 101.709 128.415 91.1596C130.095 80.9622 128.849 73.1332 124.268 68.4527C118.097 62.1511 106.564 62.2476 91.463 67.6745C75.6841 73.3441 56.0556 84.8229 34.5862 100.899C34.4156 101.028 34.1715 100.994 34.0391 100.821C33.9217 100.663 33.943 100.438 34.0842 100.305H34.083C40.1287 94.5412 46.1515 89.0841 52.0938 83.9737C57.9766 78.9107 63.7907 74.1829 69.4702 69.8191C54.7411 62.2655 41.6766 57.3913 31.1279 55.6515C20.9285 53.9692 13.1007 55.2151 8.42024 59.7979C2.11631 65.9691 2.21587 77.5024 7.64207 92.6007C13.3097 108.38 24.7911 128.011 40.8664 149.476C40.9965 149.648 40.9587 149.894 40.7867 150.023C40.6299 150.143 40.4056 150.122 40.2706 149.979V149.982C34.5064 143.936 29.052 137.913 23.9397 131.971C18.7325 125.916 13.8754 119.941 9.4105 114.105L9.40821 114.104L6.83453 110.699L6.83148 110.697L6.83034 110.692L6.8269 110.69C4.42679 107.474 2.15065 104.304 0 101.189Z" fill="#1565a8"/>
            </svg>
          </div>
          <span style={{ fontFamily: "Gilroy, sans-serif", fontWeight: 800, fontSize: 26, lineHeight: 1, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            <span style={{ color: isDark ? "#f8fafc" : "#0f172a" }}>Corp</span>
            <span style={{ color: isDark ? "#5ba3df" : "#1565a8" }}>meet</span>
          </span>
          <div className="ml-3">
            <WorkspaceSelector onSettingsOpen={() => setWsSettingsOpen(true)} />
          </div>
        </div>

        {/* Profile trigger */}
        <div className="flex items-center gap-2">
          {miniApp && <OpenInBrowserButton />}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all"
            style={{
              background: sidebarOpen ? "var(--elevated)" : "transparent",
              border: `1px solid ${sidebarOpen ? "var(--border)" : "transparent"}`,
              color: sidebarOpen ? "var(--text)" : "var(--text-sec)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.borderColor = "var(--border)"; }}
            onMouseLeave={e => { if (!sidebarOpen) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-sec)"; e.currentTarget.style.borderColor = "transparent"; } }}
          >
            <UserAvatar displayName={user?.display_name ?? ""} avatar={user?.avatar} size={24} />
            <span className="max-w-[120px] truncate">{user?.display_name}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ opacity: 0.45, transform: sidebarOpen ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <Calendar currentUser={user ?? null} onSlotClick={handleSlotClick} onCardClick={handleCardClick} />
      </main>

      {/* FAB */}
      <button
        onClick={() => handleSlotClick(new Date(), new Date(Date.now() + 3_600_000))}
        className="fixed z-40 flex items-center justify-center rounded-md text-white cursor-pointer"
        style={{ bottom: 24, right: 24, width: 56, height: 56,
          background: "linear-gradient(135deg,#1565a8,#3b82f6)",
          boxShadow: "0 4px 20px rgba(21,101,168,0.40)" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* ── Profile Sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            {/* Backdrop */}
            <motion.div key="sb-bd"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[150]"
              style={{ background: isDark ? "rgba(0,0,0,0.5)" : "rgba(15,23,42,0.28)", backdropFilter: "blur(3px)" }}
              onClick={closeSidebar}
            />

            {/* Panel */}
            <motion.aside key="sb"
              initial={{ x: 320, opacity: 0.6 }} animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="fixed top-0 right-0 bottom-0 z-[160] flex flex-col"
              style={{
                width: 300,
                background: "var(--panel)",
                borderLeft: "1px solid var(--border)",
                boxShadow: isDark ? "-32px 0 80px rgba(0,0,0,0.75)" : "-8px 0 48px rgba(0,0,0,0.16)",
              }}>

              {/* Panel header */}
              <div className="flex items-center justify-between px-5 shrink-0"
                style={{ height: 52, borderBottom: "1px solid var(--border)", background: "var(--header)", backdropFilter: "blur(24px)" }}>
                <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
                  Аккаунт
                </span>
                <button type="button" onClick={closeSidebar}
                  className="w-7 h-7 rounded flex items-center justify-center transition-all"
                  style={{ color: "var(--text-muted)", background: "var(--elevated)" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--border)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--elevated)"; }}>
                  <IcClose />
                </button>
              </div>

              {/* User card */}
              <div className="px-5 pt-5 pb-4 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex items-center gap-4">
                  {/* Avatar — relative wrapper so AvatarPicker anchors here */}
                  <div className="relative shrink-0">
                    <button type="button"
                      onClick={() => setAvatarPickerOpen(v => !v)}
                      className="relative block rounded-full transition-all"
                      style={{
                        outline: avatarPickerOpen ? "2.5px solid var(--primary)" : "2.5px solid transparent",
                        outlineOffset: 2,
                      }}>
                      <UserAvatar displayName={user?.display_name ?? ""} avatar={user?.avatar} size={58} />
                      <span className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center text-white"
                        style={{ background: "var(--primary)", boxShadow: "0 0 0 2px var(--card)" }}>
                        <IcCamera />
                      </span>
                    </button>
                    <AnimatePresence>
                      {avatarPickerOpen && user && (
                        <AvatarPicker user={user} onClose={() => setAvatarPickerOpen(false)} />
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm leading-tight truncate" style={{ color: "var(--text)" }}>
                      {user?.display_name}
                    </p>
                    <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md text-xs font-semibold"
                      style={{ background: roleBg, color: roleColor, border: `1px solid ${roleBorder}` }}>
                      {roleLabel}
                    </span>
                  </div>
                </div>
              </div>

              {/* Nav */}
              <div className="flex-1 overflow-y-auto py-3 px-3 space-y-3">

                <div>
                  <SideLabel>Основное</SideLabel>
                  <SideBtn icon={<IcPerson />}   label={t("nav.profile")}       onClick={() => { setProfileOpen(true);     closeSidebar(); }} />
                  <SideBtn icon={<IcBell />}     label="Уведомления"             onClick={() => { setNotifOpen(true);       closeSidebar(); }} />
                  <SideBtn icon={<IcCalendar />} label="Активные встречи"        onClick={() => { setActiveOpen(true);      closeSidebar(); }} />
                </div>

                {isAdmin && (
                  <div>
                    <SideLabel>Управление</SideLabel>
                    <SideBtn icon={<IcShield />} label={t("nav.admin")}          onClick={() => { setAdminOpen(true);       closeSidebar(); }} />
                    {isSuperadmin && (
                      <SideBtn icon={<IcFile />} label={t("submissions.title")} onClick={() => { setSubmissionsOpen(true); closeSidebar(); }} />
                    )}
                  </div>
                )}

                <div>
                  <SideLabel>Настройки</SideLabel>
                  <SideBtn icon={<IcMsg />}   label={t("feedback.button")}               onClick={() => { setFeedbackOpen(true); closeSidebar(); }} />
                  <SideBtn icon={isDark ? <IcSun /> : <IcMoon />}
                    label={isDark ? "Светлая тема" : "Тёмная тема"}
                    onClick={toggle} />
                  <SideBtn icon={<IcGlobe />}
                    label={locale === "ru" ? "Ўзбекча" : "Русский"}
                    onClick={() => setLocale(locale === "ru" ? "uz" : "ru")} />
                </div>

              </div>

              {/* Logout */}
              <div className="px-3 py-3 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
                <SideBtn icon={<IcLogout />} label={t("nav.logout")} onClick={handleLogout} danger />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <ActiveMeetings isOpen={activeOpen} onClose={() => setActiveOpen(false)} onCardClick={handleCardClick}
        onBack={() => { setActiveOpen(false); setSidebarOpen(true); }} />
      <NotificationCenter isOpen={notifOpen} onClose={() => setNotifOpen(false)}
        onBack={() => { setNotifOpen(false); setSidebarOpen(true); }} />

      {isAdmin && <AdminPanel isOpen={adminOpen} onClose={() => setAdminOpen(false)}
        onBack={() => { setAdminOpen(false); setSidebarOpen(true); }} />}
      {isSuperadmin && <SubmissionsPanel isOpen={submissionsOpen} onClose={() => setSubmissionsOpen(false)}
        onBack={() => { setSubmissionsOpen(false); setSidebarOpen(true); }} />}

      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)}
        onSuccess={(msg) => addToast(msg)} onError={(msg) => addToast(msg, "error")}
        onBack={() => { setFeedbackOpen(false); setSidebarOpen(true); }} />

      <BookingModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditBooking(null); }}
        initialStart={slotStart} initialEnd={slotEnd}
        editBooking={editBooking} canEdit={canEdit} canDelete={canEdit}
        onSuccess={(msg) => addToast(msg)} onError={(msg) => addToast(msg, "error")}
      />

      {user && (
        <ProfileEditModal open={profileOpen} user={user}
          onClose={() => setProfileOpen(false)} onSaved={() => addToast(t("profile.saved"))}
          onBack={() => { setProfileOpen(false); setSidebarOpen(true); }} />
      )}

      <WorkspaceSettingsModal open={wsSettingsOpen} onClose={() => setWsSettingsOpen(false)} />

      {needsOnboarding && <WorkspaceOnboarding onCreated={() => addToast("Пространство готово")} />}

      <Toasts toasts={toasts} />
    </div>
  );
}

// ── Meeting room page ─────────────────────────────────────────────────────────
function MeetingRoomPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  return <MeetingRoom bookingId={Number(bookingId)} onLeave={() => navigate(-1)} />;
}

function GuestJoinPageRoute() {
  const { inviteToken } = useParams<{ inviteToken: string }>();
  return <GuestJoinPage inviteToken={inviteToken ?? ""} />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 rounded-full border-2"
          style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, user } = useAuth();
  useWebReminders(isAuthenticated);
  const { setLocale } = useLocale();

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
        <Route path="/login"   element={<LoginPage />} />
        <Route path="/register" element={<RegistrationPage />} />
        <Route path="/auth/session/:sessionToken" element={<SessionAuthPage />} />
        <Route path="/bookings" element={
          <ProtectedRoute>
            <WorkspaceProvider enabled={isAuthenticated}>
              <Dashboard />
            </WorkspaceProvider>
          </ProtectedRoute>
        } />
        <Route path="/meeting/:bookingId" element={
          <ProtectedRoute><MeetingRoomPage /></ProtectedRoute>
        } />
        <Route path="/meeting/guest/:inviteToken" element={<GuestJoinPageRoute />} />
        <Route path="/" element={<Navigate to={isAuthenticated ? "/bookings" : "/login"} replace />} />
      </Routes>
    </>
  );
}
