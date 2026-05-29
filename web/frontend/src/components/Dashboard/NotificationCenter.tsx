import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import type { NotificationRecord } from "../../types";

const REMINDER_OPTIONS = [5, 15, 30, 60] as const;
const STORAGE_KEY = "corpmeet_notifications";
const REMINDER_KEY = "corpmeet_reminder_minutes";
const UNREAD_KEY = "corpmeet_notif_unread";

export function getStoredNotifications(): NotificationRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
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

  useEffect(() => {
    if (isOpen) {
      setNotifications(getStoredNotifications());
      clearUnreadCount();
    }
  }, [isOpen]);

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
                style={{ color: "var(--text-muted)", background: "var(--elevated)" }}
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
                      className="rounded-2xl p-3.5 flex gap-3"
                      style={{
                        background: "var(--elevated)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        boxShadow: [
                          "0 2px 4px rgba(0,0,0,0.35)",
                          "0 8px 20px rgba(0,0,0,0.28)",
                          "0 20px 50px rgba(0,0,0,0.18)",
                          "0 0 0 1px rgba(255,255,255,0.04)",
                          "0 30px 80px rgba(79,124,255,0.07)",
                        ].join(", "),
                      }}>
                      {/* Icon with status badge */}
                      <div style={{ position: "relative", flexShrink: 0, marginTop: 1 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: "50%",
                          background: "linear-gradient(135deg, #2563eb, #6366f1)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <div style={{
                          position: "absolute", bottom: 0, right: 0,
                          width: 13, height: 13, borderRadius: "50%",
                          background: "#22c55e",
                          border: "2px solid var(--elevated)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width="7" height="7" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        </div>
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold mb-0.5" style={{ color: "var(--text)" }}>{n.title}</p>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--text-sec)" }}>{n.body}</p>
                        <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>{timeAgo(n.time)}</p>
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
                  style={{ border: "1px solid var(--border)", color: "var(--text-muted)", background: "var(--elevated)" }}
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
