import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import { bookingsApi } from "../../api/bookings";
import { workspacesApi } from "../../api/workspaces";
import type { NotificationRecord, GuestRsvpStatus } from "../../types";

// ── RSVP icon animation (success check / decline cross) ──────────────────────
const RSVP_ANIM_CSS = `
:root {
  --rsvp-dur: 520ms;
  --rsvp-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --rsvp-ease-bob: cubic-bezier(0.34, 1.35, 0.64, 1);
}
.t-rsvp-icon { display:inline-flex; align-items:center; justify-content:center;
  width:36px; height:36px; border-radius:50%;
  opacity:0; transform-origin:center; will-change:transform,opacity,filter; }
.t-rsvp-icon svg { display:block; overflow:visible; }
.t-rsvp-icon svg path { stroke-dasharray:22; stroke-dashoffset:22; }
.t-rsvp-icon[data-state="check"] {
  background: rgba(34,197,94,0.18);
  animation: rsvp-fade var(--rsvp-dur) var(--rsvp-ease-out) forwards,
             rsvp-rotate var(--rsvp-dur) var(--rsvp-ease-out) forwards,
             rsvp-blur var(--rsvp-dur) var(--rsvp-ease-out) forwards,
             rsvp-bob var(--rsvp-dur) var(--rsvp-ease-bob) forwards; }
.t-rsvp-icon[data-state="cross"] {
  background: rgba(239,68,68,0.15);
  animation: rsvp-fade var(--rsvp-dur) var(--rsvp-ease-out) forwards,
             rsvp-rotate var(--rsvp-dur) var(--rsvp-ease-out) forwards,
             rsvp-blur var(--rsvp-dur) var(--rsvp-ease-out) forwards,
             rsvp-bob var(--rsvp-dur) var(--rsvp-ease-bob) forwards; }
.t-rsvp-icon[data-state="check"] svg path,
.t-rsvp-icon[data-state="cross"] svg path {
  animation: rsvp-draw var(--rsvp-dur) var(--rsvp-ease-out) 80ms forwards; }
@keyframes rsvp-fade   { from{opacity:0} to{opacity:1} }
@keyframes rsvp-rotate { from{transform:rotate(70deg)} to{transform:rotate(0deg)} }
@keyframes rsvp-blur   { from{filter:blur(8px)} to{filter:blur(0)} }
@keyframes rsvp-bob    { from{translate:0 32px} to{translate:0 0} }
@keyframes rsvp-draw   { to{stroke-dashoffset:0} }
@media(prefers-reduced-motion:reduce){
  .t-rsvp-icon{animation:none!important;opacity:1;}
  .t-rsvp-icon svg path{animation:none!important;stroke-dashoffset:0!important;} }
`;
if (typeof document !== "undefined" && !document.getElementById("t-rsvp-styles")) {
  const s = document.createElement("style");
  s.id = "t-rsvp-styles";
  s.textContent = RSVP_ANIM_CSS;
  document.head.appendChild(s);
}

const REMINDER_OPTIONS = [5, 15, 30, 60] as const;
const STORAGE_KEY = "corpmeet_notifications";
const REMINDER_KEY = "corpmeet_reminder_minutes";
const UNREAD_KEY = "corpmeet_notif_unread";

export function getStoredNotifications(): NotificationRecord[] {
  try {
    const all: NotificationRecord[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    // Migrate old meeting_invited entries that have translated text stored as title
    // (they had Russian text; now title stores raw booking name)
    const migrated = all.filter(n =>
      n.type !== "meeting_invited" ||
      // keep only if title looks like a raw booking name (not a translated phrase)
      (!n.title.startsWith("Приглашение") && !n.title.startsWith("Taklif") && !n.title.startsWith("Таклиф"))
    );
    if (migrated.length !== all.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      // also reset seen-ids so they get re-generated with new format
      localStorage.removeItem("corpmeet_invited_seen");
    }
    return migrated;
  } catch { return []; }
}

export function getUnreadCount(): number {
  try { return Number(localStorage.getItem(UNREAD_KEY) || "0"); } catch { return 0; }
}

export function clearUnreadCount(): void {
  localStorage.removeItem(UNREAD_KEY);
  window.dispatchEvent(new CustomEvent("notif-unread"));
}

export function addNotification(record: NotificationRecord) {
  const existing = getStoredNotifications();
  const updated = [record, ...existing].slice(0, 50);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  localStorage.setItem(UNREAD_KEY, String(getUnreadCount() + 1));
  window.dispatchEvent(new CustomEvent("notif-unread"));
}

export function updateNotificationRsvp(notifId: string, rsvpStatus: GuestRsvpStatus) {
  const existing = getStoredNotifications();
  const updated = existing.map(n => n.id === notifId ? { ...n, rsvpStatus } : n);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function updateNotificationJoinStatus(notifId: string, joinRequestStatus: "accepted" | "declined") {
  const existing = getStoredNotifications();
  const updated = existing.map(n => n.id === notifId ? { ...n, joinRequestStatus } : n);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function getReminderMinutes(): number[] {
  try {
    const stored = localStorage.getItem(REMINDER_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [15];
}

export function setReminderMinutes(minutes: number[]) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(minutes));
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
}

export function NotificationCenter({ isOpen, onClose, onBack }: Props) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const [notifications, setNotifications] = useState<NotificationRecord[]>(() => getStoredNotifications());
  const [reminderMins, setReminderMins] = useState<number[]>(() => getReminderMinutes());
  const [rsvpLoading, setRsvpLoading] = useState<Record<string, boolean>>({});
  const [joinLoading, setJoinLoading] = useState<Record<string, boolean>>({});
  const [iconAnim, setIconAnim] = useState<Record<string, "check" | "cross">>({});
  const iconAnimRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (isOpen) {
      setNotifications(getStoredNotifications());
      clearUnreadCount();
    }
  }, [isOpen]);

  const triggerIconAnim = (id: string, kind: "check" | "cross") => {
    // reset first so keyframes restart if re-triggered
    setIconAnim(prev => ({ ...prev, [id]: undefined as unknown as "check" }));
    requestAnimationFrame(() => {
      setIconAnim(prev => ({ ...prev, [id]: kind }));
      clearTimeout(iconAnimRef.current[id]);
      iconAnimRef.current[id] = setTimeout(() => {
        setIconAnim(prev => { const n = { ...prev }; delete n[id]; return n; });
      }, 2000);
    });
  };

  const handleRsvp = async (notif: NotificationRecord, status: "accepted" | "declined") => {
    if (!notif.bookingId || rsvpLoading[notif.id]) return;
    setRsvpLoading(prev => ({ ...prev, [notif.id]: true }));
    try {
      await bookingsApi.rsvp(notif.bookingId, status);
      updateNotificationRsvp(notif.id, status);
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, rsvpStatus: status } : n)
      );
      triggerIconAnim(notif.id, status === "accepted" ? "check" : "cross");
    } catch {
      // silently ignore
    } finally {
      setRsvpLoading(prev => ({ ...prev, [notif.id]: false }));
    }
  };

  const handleJoinRequest = async (notif: NotificationRecord, approve: boolean) => {
    if (!notif.workspaceId || !notif.workspaceJoinMemberId || joinLoading[notif.id]) return;
    setJoinLoading(prev => ({ ...prev, [notif.id]: true }));
    try {
      await workspacesApi.updateMember(notif.workspaceId, notif.workspaceJoinMemberId, { approve });
      const status = approve ? "accepted" : "declined";
      updateNotificationJoinStatus(notif.id, status);
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, joinRequestStatus: status } : n)
      );
      triggerIconAnim(notif.id, approve ? "check" : "cross");
    } catch {
      // silently ignore
    } finally {
      setJoinLoading(prev => ({ ...prev, [notif.id]: false }));
    }
  };

  const timeAgo = (ms: number): string => {
    const diff = Math.round((Date.now() - ms) / 60_000);
    if (diff < 1)  return t("notif.justNow");
    if (diff < 60) return t("notif.minAgo", { n: diff });
    const h = Math.floor(diff / 60);
    if (h < 24)    return t("notif.hAgo", { n: h });
    return t("notif.dAgo", { n: Math.floor(h / 24) });
  };

  const reminderLabel = (min: number) =>
    min < 60 ? t("notif.min", { n: min }) : t("notif.h", { n: min / 60 });

  const toggleReminder = (min: number) => {
    const next = reminderMins.includes(min)
      ? reminderMins.filter(m => m !== min)
      : [...reminderMins, min].sort((a, b) => a - b);
    if (next.length === 0) return;
    setReminderMins(next);
    setReminderMinutes(next);
  };

  const clearAll = () => {
    setNotifications([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div key="bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40" onClick={onClose}
            style={{ background: isDark ? "rgba(0,0,0,0.6)" : "rgba(15,23,42,0.3)", backdropFilter: "blur(4px)" }} />

          <motion.div key="panel"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[300px] flex flex-col"
            style={{
              background: "var(--panel)",
              borderLeft: "1px solid var(--border)",
              boxShadow: isDark ? "-20px 0 60px rgba(0,0,0,0.8)" : "-8px 0 40px rgba(15,23,42,0.12)",
            }}>

            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div>
                <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("nav.notifications")}</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{t("notif.history")}</p>
              </div>
              <button onClick={onBack ?? onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                style={{ color: "var(--text-muted)", background: "var(--elevated)", transition: "color 0.15s ease" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>
                {onBack
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                  : <span className="text-xl leading-none">×</span>}
              </button>
            </div>

            <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-sec)" }}>{t("notif.remindBefore")}</p>
              <div className="flex gap-2">
                {REMINDER_OPTIONS.map(min => {
                  const active = reminderMins.includes(min);
                  return (
                    <button key={min} onClick={() => toggleReminder(min)}
                      className="flex-1 py-1.5 rounded text-xs font-bold transition-all"
                      style={{
                        background: active ? "var(--primary)" : "var(--elevated)",
                        border: `1.5px solid ${active ? "var(--primary)" : "var(--border)"}`,
                        color: active ? "#fff" : "var(--text-sec)",
                      }}>
                      {reminderLabel(min)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {notifications.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-4xl mb-3">🔔</div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("notif.empty")}</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{t("notif.emptyHint")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notifications.map(n => (
                    <motion.div key={n.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="rounded-md p-3 flex gap-3"
                      style={{
                        background: "var(--elevated)",
                        border: "1px solid var(--border)",
                      }}>
                      {/* Icon — animates to check/cross after RSVP, fades back to bell */}
                      <div style={{ flexShrink: 0, marginTop: 1, width: 36, height: 36, position: "relative" }}>
                        <AnimatePresence mode="wait">
                          {iconAnim[n.id] ? (
                            <motion.span
                              key={`anim-${n.id}-${iconAnim[n.id]}`}
                              className="t-rsvp-icon"
                              data-state={iconAnim[n.id]}
                              exit={{ opacity: 0, scale: 0.7, filter: "blur(6px)", transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}
                              style={{ position: "absolute", inset: 0 }}>
                              {iconAnim[n.id] === "check" ? (
                                <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                                  <path d="M2 7L5.5 10.5L12 3" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              ) : (
                                <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                                  <path d="M2 2L12 12M12 2L2 12" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
                                </svg>
                              )}
                            </motion.span>
                          ) : (
                            <motion.div
                              key={`bell-${n.id}`}
                              initial={{ opacity: 0, scale: 0.7, filter: "blur(6px)" }}
                              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                              style={{
                                position: "absolute", inset: 0,
                                width: 36, height: 36, borderRadius: "50%",
                                background: "linear-gradient(135deg, #2563eb, #6366f1)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}>
                              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold mb-0.5" style={{ color: "var(--text)" }}>
                          {n.type === "meeting_invited"
                            ? t("notif.meetingInvited")
                            : n.type === "workspace_join_request"
                            ? t("notif.wsJoinRequest")
                            : n.title}
                        </p>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--text-sec)" }}>
                          {n.type === "meeting_invited"
                            ? t("notif.meetingInvitedBody", { title: n.title })
                            : n.type === "workspace_join_request"
                            ? t("notif.wsJoinRequestBody", { name: n.requestedUserName ?? "", ws: n.workspaceName ?? n.title })
                            : n.body}
                        </p>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{timeAgo(n.time)}</p>

                        {/* Meeting invite RSVP buttons */}
                        {n.type === "meeting_invited" && n.bookingId && (
                          <div className="mt-1.5">
                            {n.rsvpStatus === "accepted" ? (
                              <motion.span
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18 }}
                                className="inline-flex items-center gap-1 text-xs font-medium"
                                style={{ color: "#16a34a" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                                {t("notif.rsvpAccepted")}
                              </motion.span>
                            ) : n.rsvpStatus === "declined" ? (
                              <motion.span
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18 }}
                                className="inline-flex items-center gap-1 text-xs font-medium"
                                style={{ color: "#ef4444" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                                {t("notif.rsvpDeclined")}
                              </motion.span>
                            ) : (
                              <div className="flex gap-1.5">
                                <motion.button
                                  disabled={rsvpLoading[n.id]}
                                  onClick={() => handleRsvp(n, "accepted")}
                                  whileHover={{ scale: 1.03, backgroundColor: "rgba(34,197,94,0.22)" }}
                                  whileTap={{ scale: 0.96 }}
                                  transition={{ duration: 0.14, ease: "easeOut" }}
                                  className="flex-1 py-1 rounded text-xs font-bold disabled:opacity-50"
                                  style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.3)" }}>
                                  {rsvpLoading[n.id] ? "…" : t("notif.accept")}
                                </motion.button>
                                <motion.button
                                  disabled={rsvpLoading[n.id]}
                                  onClick={() => handleRsvp(n, "declined")}
                                  whileHover={{ scale: 1.03, backgroundColor: "rgba(239,68,68,0.15)" }}
                                  whileTap={{ scale: 0.96 }}
                                  transition={{ duration: 0.14, ease: "easeOut" }}
                                  className="flex-1 py-1 rounded text-xs font-bold disabled:opacity-50"
                                  style={{ background: "rgba(239,68,68,0.07)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.22)" }}>
                                  {rsvpLoading[n.id] ? "…" : t("notif.decline")}
                                </motion.button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Workspace join request approve/reject buttons */}
                        {n.type === "workspace_join_request" && n.workspaceJoinMemberId && (
                          <div className="mt-1.5">
                            {n.joinRequestStatus === "accepted" ? (
                              <motion.span
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18 }}
                                className="inline-flex items-center gap-1 text-xs font-medium"
                                style={{ color: "#16a34a" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                                {t("notif.wsJoinAccepted")}
                              </motion.span>
                            ) : n.joinRequestStatus === "declined" ? (
                              <motion.span
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.18 }}
                                className="inline-flex items-center gap-1 text-xs font-medium"
                                style={{ color: "#ef4444" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                                {t("notif.wsJoinDeclined")}
                              </motion.span>
                            ) : (
                              <div className="flex gap-1.5">
                                <motion.button
                                  disabled={joinLoading[n.id]}
                                  onClick={() => handleJoinRequest(n, true)}
                                  whileHover={{ scale: 1.03, backgroundColor: "rgba(34,197,94,0.22)" }}
                                  whileTap={{ scale: 0.96 }}
                                  transition={{ duration: 0.14, ease: "easeOut" }}
                                  className="flex-1 py-1 rounded text-xs font-bold disabled:opacity-50"
                                  style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.3)" }}>
                                  {joinLoading[n.id] ? "…" : t("notif.accept")}
                                </motion.button>
                                <motion.button
                                  disabled={joinLoading[n.id]}
                                  onClick={() => handleJoinRequest(n, false)}
                                  whileHover={{ scale: 1.03, backgroundColor: "rgba(239,68,68,0.15)" }}
                                  whileTap={{ scale: 0.96 }}
                                  transition={{ duration: 0.14, ease: "easeOut" }}
                                  className="flex-1 py-1 rounded text-xs font-bold disabled:opacity-50"
                                  style={{ background: "rgba(239,68,68,0.07)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.22)" }}>
                                  {joinLoading[n.id] ? "…" : t("notif.decline")}
                                </motion.button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
                <button onClick={clearAll}
                  className="w-full py-2 rounded-md text-xs font-semibold transition-all"
                  style={{ border: "1px solid var(--border)", color: "var(--text-muted)", background: "var(--elevated)", transition: "color 0.15s ease, border-color 0.15s ease" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}>
                  {t("notif.clearAll")}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
