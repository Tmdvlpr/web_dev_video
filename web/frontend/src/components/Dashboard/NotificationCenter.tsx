import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { InteractiveStripe } from "../Common/InteractiveStripe";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import type { NotificationRecord } from "../../types";

const REMINDER_OPTIONS = [5, 15, 30, 60] as const;
const STORAGE_KEY = "corpmeet_notifications";
const REMINDER_KEY = "corpmeet_reminder_minutes";

export function getStoredNotifications(): NotificationRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch { return []; }
}

export function addNotification(record: NotificationRecord) {
  const existing = getStoredNotifications();
  const updated = [record, ...existing].slice(0, 50);
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
}

export function NotificationCenter({ isOpen, onClose }: Props) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const [notifications, setNotifications] = useState<NotificationRecord[]>(() => getStoredNotifications());
  const [reminderMins, setReminderMins] = useState<number[]>(() => getReminderMinutes());

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
            initial={{ opacity: 0, x: 340 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 340 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-80 flex flex-col"
            style={{
              background: "var(--panel)",
              borderLeft: "1px solid var(--border)",
              boxShadow: isDark ? "-20px 0 60px rgba(0,0,0,0.8)" : "-8px 0 40px rgba(15,23,42,0.12)",
            }}>

            <InteractiveStripe />

            <div className="flex items-center justify-between px-5 py-4 mt-1"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div>
                <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("nav.notifications")}</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{t("notif.history")}</p>
              </div>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full text-xl transition-all"
                style={{ color: "var(--text-muted)", background: "var(--elevated)" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>×</button>
            </div>

            <div className="px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-sec)" }}>{t("notif.remindBefore")}</p>
              <div className="flex gap-2">
                {REMINDER_OPTIONS.map(min => {
                  const active = reminderMins.includes(min);
                  return (
                    <button key={min} onClick={() => toggleReminder(min)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all"
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
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl p-3"
                      style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                      <p className="text-xs font-bold mb-0.5" style={{ color: "var(--text)" }}>{n.title}</p>
                      <p className="text-xs" style={{ color: "var(--text-sec)" }}>{n.body}</p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{timeAgo(n.time)}</p>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
                <button onClick={clearAll}
                  className="w-full py-2 rounded-xl text-xs font-semibold transition-all"
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
