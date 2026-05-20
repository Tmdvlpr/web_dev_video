import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { InteractiveStripe } from "../Common/InteractiveStripe";
import { MeetingListSkeleton } from "../Common/Skeleton";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import { useAuth } from "../../hooks/useAuth";
import { bookingsApi } from "../../api/bookings";
import { usersApi } from "../../api/users";
import type { Booking } from "../../types";

type Tab = "mine" | "invited";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCardClick: (b: Booking) => void;
}

const PALETTES = ["#1565a8","#0891b2","#16a34a","#d97706","#e11d48","#c026d3","#4f46e5","#ea580c"];
function color(uid: number) { return PALETTES[uid % PALETTES.length]; }

function fmtRange(start: string, end: string) {
  const fmt = (d: Date) => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `${fmt(new Date(start))} — ${fmt(new Date(end))}`;
}

type TFn = (key: any, params?: Record<string, string | number>) => string;

function fmtDiff(diffMinutes: number, t: TFn): string {
  if (diffMinutes < 60) return t("meetings.inMin", { n: diffMinutes });
  if (diffMinutes < 24 * 60) {
    const h = Math.floor(diffMinutes / 60);
    const m = diffMinutes % 60;
    return m === 0 ? t("meetings.inH", { h }) : t("meetings.inHM", { h, m });
  }
  return t("meetings.inD", { d: Math.floor(diffMinutes / (24 * 60)) });
}

function statusLabel(b: Booking, t: TFn): { label: string; color: string; bg: string } {
  const now = Date.now();
  const s   = new Date(b.start_time).getTime();
  const e   = new Date(b.end_time).getTime();
  if (now >= s && now <= e) return { label: t("meetings.statusNow"), color: "#15803d", bg: "rgba(22,163,74,0.1)" };
  const diff = Math.round((s - now) / 60_000);
  if (diff <= 15)       return { label: fmtDiff(diff, t), color: "#d97706", bg: "rgba(217,119,6,0.1)" };
  if (diff <= 24 * 60)  return { label: fmtDiff(diff, t), color: "#6b6b8a", bg: "rgba(107,107,138,0.1)" };
  return { label: fmtDiff(diff, t), color: "#94a3b8", bg: "rgba(148,163,184,0.08)" };
}

const DOW_LONG_KEYS = [
  "cal.dow.sun.long", "cal.dow.mon.long", "cal.dow.tue.long",
  "cal.dow.wed.long", "cal.dow.thu.long", "cal.dow.fri.long", "cal.dow.sat.long",
] as const;

function dayLabel(iso: string, t: TFn): string {
  const d     = new Date(iso);
  const today = new Date();
  const tom   = new Date(); tom.setDate(today.getDate() + 1);
  const same  = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return t("cal.today");
  if (same(d, tom))   return t("meetings.tomorrow");
  const dow = t(DOW_LONG_KEYS[d.getDay()]);
  const mo  = t(`cal.mo.${d.getMonth() + 1}`);
  return `${dow}, ${d.getDate()} ${mo}`;
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

interface DayGroup { label: string; bookings: Booking[] }

function ExportFooter({ isDark }: { isDark: boolean }) {
  const { t } = useLocale();
  const [exporting, setExporting] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const queryClient = useQueryClient();

  const { mutate: getFeed, isPending: feedLoading } = useMutation({
    mutationFn: usersApi.getFeedToken,
    onSuccess: (token) => {
      queryClient.setQueryData(["feedToken"], token);
      const url = bookingsApi.getFeedUrl(token);
      navigator.clipboard.writeText(url).then(() => {
        setFeedCopied(true);
        setTimeout(() => setFeedCopied(false), 2500);
      });
    },
  });

  const handleExport = async () => {
    setExporting(true);
    try { await bookingsApi.exportHistory(); } finally { setExporting(false); }
  };

  return (
    <div className="px-4 py-3 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: "var(--text-muted)", opacity: 0.5 }}>
          {t("meetings.refresh")}
        </p>
        <motion.button
          onClick={handleExport} disabled={exporting}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-50 transition-all"
          style={{
            background: isDark ? "rgba(21,101,168,0.12)" : "#e6f0fa",
            border: isDark ? "1px solid rgba(21,101,168,0.3)" : "1px solid #a5cfeb",
            color: "var(--primary)",
          }}>
          {exporting ? "⏳" : "📅"} {exporting ? t("common.loading") : t("meetings.exportIcs")}
        </motion.button>
      </div>
      <motion.button
        onClick={() => getFeed()}
        disabled={feedLoading}
        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-50 transition-all"
        style={{
          background: feedCopied
            ? (isDark ? "rgba(34,197,94,0.12)" : "#f0fdf4")
            : (isDark ? "rgba(8,145,178,0.1)" : "#ecfeff"),
          border: feedCopied
            ? (isDark ? "1px solid rgba(34,197,94,0.3)" : "1px solid #bbf7d0")
            : (isDark ? "1px solid rgba(8,145,178,0.3)" : "1px solid #a5f3fc"),
          color: feedCopied ? "#15803d" : "#0891b2",
        }}>
        {feedLoading ? "⏳" : feedCopied ? `✅ ${t("meetings.feedCopied")}` : `🔗 ${t("meetings.feedCopy")}`}
      </motion.button>
    </div>
  );
}

export function ActiveMeetings({ isOpen, onClose, onCardClick }: Props) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("mine");

  const { data: bookings = [], isLoading, error } = useQuery({
    queryKey: ["bookings", "active"],
    queryFn: bookingsApi.getActive,
    enabled: isOpen,
    refetchInterval: isOpen ? 30_000 : false,
    retry: 1,
  });

  const mine    = bookings.filter(b => b.user_id === user?.id);
  const invited = bookings.filter(b => b.user_id !== user?.id);
  const visible = tab === "mine" ? mine : invited;

  const groups: DayGroup[] = [];
  for (const b of visible) {
    const k = dayKey(b.start_time);
    const lbl = dayLabel(b.start_time, t);
    const existing = groups.find(g => g.label === lbl && dayKey(g.bookings[0]?.start_time) === k);
    if (existing) existing.bookings.push(b);
    else groups.push({ label: lbl, bookings: [b] });
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div key="bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            aria-hidden="true"
            className="fixed inset-0 z-40" onClick={onClose}
            style={{ background: isDark ? "rgba(0,0,0,0.6)" : "rgba(15,23,42,0.3)", backdropFilter: "blur(4px)" }} />

          <motion.div key="panel"
            role="dialog" aria-modal="true" aria-label={t("meetings.title")}
            initial={{ opacity: 0, x: 340 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 340 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[360px] flex flex-col"
            style={{
              background: "var(--panel)",
              borderLeft: "1px solid var(--border)",
              boxShadow: isDark ? "-20px 0 60px rgba(0,0,0,0.8)" : "-8px 0 40px rgba(15,23,42,0.12)",
            }}>

            <InteractiveStripe />

            <div className="px-5 pt-4 mt-1" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("meetings.title")}</h3>
                <button onClick={onClose} type="button" aria-label={t("booking.close")}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-xl transition-all"
                  style={{ color: "var(--text-muted)", background: "var(--elevated)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}><span aria-hidden="true">×</span></button>
              </div>
              {/* Tabs */}
              <div role="tablist" aria-label={t("meetings.title")} className="flex gap-1 pb-3">
                {([
                  { key: "mine"    as const, labelKey: "meetings.tabOrg" as const, count: mine.length },
                  { key: "invited" as const, labelKey: "meetings.tabInv" as const, count: invited.length },
                ] as const).map(({ key, labelKey, count }) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      background: tab === key ? "var(--primary)" : "var(--elevated)",
                      color: tab === key ? "#fff" : "var(--text-sec)",
                      border: tab === key ? "1px solid var(--primary)" : "1px solid var(--border)",
                    }}>
                    {t(labelKey)}
                    {count > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-xs font-bold"
                        style={{
                          background: tab === key ? "rgba(255,255,255,0.25)" : "var(--primary-light)",
                          color: tab === key ? "#fff" : "var(--primary)",
                        }}>
                        {count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-1 px-4">
              {error && (
                <div className="mt-3 px-3 py-2.5 rounded-xl text-xs"
                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                  ⚠️ {t("meetings.loadErr")}
                </div>
              )}
              {isLoading ? (
                <MeetingListSkeleton />
              ) : groups.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-4xl mb-3">{tab === "invited" ? "✉️" : "📭"}</div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                    {tab === "invited" ? t("meetings.noInvTitle") : t("meetings.empty")}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {tab === "invited" ? t("meetings.noInvHint") : t("meetings.emptyHint")}
                  </p>
                </div>
              ) : groups.map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mb-2 mt-1">
                    <span className="text-xs font-bold capitalize" style={{ color: "var(--primary)" }}>
                      {group.label}
                    </span>
                    <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {group.bookings.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {group.bookings.map((b) => {
                      const c   = color(b.user_id);
                      const st  = statusLabel(b, t);
                      const isNow = Date.now() >= new Date(b.start_time).getTime() && Date.now() <= new Date(b.end_time).getTime();
                      return (
                        <motion.div key={b.id}
                          role="button" tabIndex={0}
                          aria-label={`${b.title}, ${st.label}, ${fmtRange(b.start_time, b.end_time)}`}
                          onClick={() => { onCardClick(b); onClose(); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onCardClick(b);
                              onClose();
                            }
                          }}
                          className="rounded-xl p-3.5 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-offset-2"
                          onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
                          style={{
                            background: isNow ? `${c}0d` : "var(--elevated)",
                            border: `1px solid ${isNow ? c + "40" : "var(--border)"}`,
                            boxShadow: isNow ? `0 0 20px ${c}15` : "none",
                          }}>
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <p className="text-sm font-bold leading-tight" style={{ color: "var(--text)" }}>{b.title}</p>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                              style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}30` }}>
                              {st.label}
                            </span>
                          </div>
                          {b.description && (
                            <p className="text-xs mb-1.5 line-clamp-1" style={{ color: "var(--text-sec)" }}>{b.description}</p>
                          )}
                          <p className="text-xs font-semibold mb-1.5" style={{ color: c }}>{fmtRange(b.start_time, b.end_time)}</p>
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                              style={{ background: c }}>{b.user.display_name[0]}</div>
                            <span className="text-xs" style={{ color: "var(--text-sec)" }}>{b.user.display_name}</span>
                            {b.user.username && (
                              <a href={`https://t.me/${b.user.username}`} target="_blank" rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs ml-auto font-medium hover:underline" style={{ color: "#0891b2" }}>
                                @{b.user.username}
                              </a>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <ExportFooter isDark={isDark} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
