import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../Common/ConfirmDialog";
import { MeetingListSkeleton } from "../Common/Skeleton";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";
import { useAdminBookings, useAdminStats, useAdminUsers } from "../../hooks/useBookings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminAnalytics } from "../../api/users";
import { bookingsApi } from "../../api/bookings";
import { usersApi } from "../../api/users";
import { useAuth } from "../../hooks/useAuth";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
}

type Tab = "stats" | "bookings" | "users" | "analytics";

const PALETTES = ["#7c3aed","#0891b2","#16a34a","#d97706","#e11d48","#c026d3","#4f46e5","#ea580c"];
function color(uid: number) { return PALETTES[uid % PALETTES.length]; }

function fmtDT(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function fmtHM(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function fmtRange(start: string, end: string) {
  return `${fmtDT(start)} — ${fmtHM(end)}`;
}

export function AdminPanel({ isOpen, onClose, onBack }: Props) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("stats");

  const { user: currentUser } = useAuth();
  const isSuperadmin = currentUser?.role === "superadmin";
  const queryClient = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useAdminStats();
  const { data: bookings = [], isLoading: bookingsLoading } = useAdminBookings();
  const { data: users = [], isLoading: usersLoading } = useAdminUsers();

  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleteBookingTarget, setDeleteBookingTarget] = useState<{ id: number; title: string; seriesId: number | null } | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [inviteResult, setInviteResult] = useState<{ created: boolean; sent: boolean; link: string } | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
  const [analyticsWorkspaceId, setAnalyticsWorkspaceId] = useState<number | undefined>(undefined);
  const [analyticsPeriod, setAnalyticsPeriod] = useState(30);
  const { data: analyticsData, isLoading: analyticsLoading } = useQuery<AdminAnalytics>({
    queryKey: ["admin-analytics", analyticsPeriod, analyticsWorkspaceId],
    queryFn: () => usersApi.adminGetAnalytics({ period_days: analyticsPeriod, workspace_id: analyticsWorkspaceId }),
    enabled: (tab === "analytics" || analyticsModalOpen) && isSuperadmin,
  });

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const toggleSelected = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelection = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  const { mutate: setRole, variables: roleVars } = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: "user" | "admin" }) =>
      usersApi.adminSetRole(userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const { mutate: sendInvite, isPending: inviting } = useMutation({
    mutationFn: () => usersApi.adminInvite(newUsername.trim()),
    onSuccess: (result) => {
      setInviteResult(result);
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
  });

  const { mutate: deleteUser } = useMutation({
    mutationFn: (userId: number) => usersApi.adminDeleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? t("common.error");
      alert(t("admin.deleteUserError", { detail }));
    },
  });

  const { mutate: deleteBooking } = useMutation({
    mutationFn: ({ id, deleteSeries }: { id: number; deleteSeries?: boolean }) =>
      bookingsApi.delete(id, deleteSeries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "bookings"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
    },
  });

  const { mutate: bulkDelete, isPending: bulkDeleting } = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map(id => bookingsApi.delete(id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "bookings"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      setBulkDeleteOpen(false);
      exitSelection();
    },
  });

  const statCards = stats ? [
    ...(isSuperadmin
      ? [{ label: t("admin.statUsers"), value: stats.total_users, color: "var(--text)", goTo: "users" as Tab }]
      : []),
    { label: t("admin.statTotalBookings"), value: stats.total_bookings, color: "var(--text)", goTo: "bookings" as Tab },
    { label: t("admin.statActiveBookings"), value: stats.active_bookings, color: "var(--text)", goTo: "bookings" as Tab },
  ] : [];

  const roleBadge = (role: string) => {
    if (role === "superadmin") return { label: "superadmin", bg: "rgba(239,68,68,0.12)", color: "#ef4444" };
    if (role === "admin") return { label: "admin", bg: "rgba(124,58,237,0.12)", color: "var(--primary)" };
    return null;
  };

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div key="bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40" onClick={onClose}
            style={{ background: isDark ? "rgba(0,0,0,0.6)" : "rgba(15,23,42,0.3)", backdropFilter: "blur(4px)" }} />

          <motion.div key="panel"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
            style={{
              width: 300,
              background: "var(--panel)",
              borderLeft: "1px solid var(--border)",
              boxShadow: isDark ? "-20px 0 60px rgba(0,0,0,0.8)" : "-8px 0 40px rgba(15,23,42,0.12)",
            }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div>
                <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("admin.title")}</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {isSuperadmin ? t("admin.superadmin") : t("admin.subtitle")}
                </p>
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

            {/* Tabs */}
            <div className="grid grid-cols-2 px-4 pt-3 gap-1.5" style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
              {(isSuperadmin ? (["stats", "bookings", "users", "analytics"] as Tab[]) : (["stats", "bookings"] as Tab[])).map(tt => (
                <button key={tt} onClick={() => tt === "analytics" ? setAnalyticsModalOpen(true) : setTab(tt)}
                  className="py-1.5 rounded-md text-xs font-bold transition-all"
                  style={{
                    background: tt === "analytics" ? "var(--elevated)" : tab === tt ? "var(--primary)" : "var(--elevated)",
                    border: `1.5px solid ${tt === "analytics" ? "var(--border)" : tab === tt ? "var(--primary)" : "var(--border)"}`,
                    color: tt === "analytics" ? "var(--text-sec)" : tab === tt ? "#fff" : "var(--text-sec)",
                  }}>
                  {tt === "stats" ? t("admin.tabStats") : tt === "bookings" ? t("admin.tabBookings") : tt === "users" ? t("admin.tabUsers") : "Аналитика ↗"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">

              {/* Stats tab */}
              {tab === "stats" && (
                statsLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-20 rounded-md animate-pulse"
                        style={{ background: "var(--elevated)" }} />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {statCards.map(s => (
                      <motion.div key={s.label}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={() => setTab(s.goTo)}
                        className="rounded-md p-4 flex items-center gap-4 cursor-pointer transition-all"
                        style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = s.color; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}>
                        <div className="flex-1">
                          <div className="text-2xl font-black" style={{ color: s.color }}>{s.value}</div>
                          <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{s.label}</div>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" style={{ opacity: 0.5 }}>
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      </motion.div>
                    ))}
                  </div>
                )
              )}

              {/* Bookings tab */}
              {tab === "bookings" && (
                bookingsLoading ? <MeetingListSkeleton /> : (
                  <div className="space-y-2 pb-20">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                        {selectionMode ? t("admin.selected", { n: selectedIds.size }) : t("admin.recentMeetings", { n: bookings.length })}
                      </p>
                      {bookings.length > 0 && (
                        selectionMode ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setSelectedIds(new Set(bookings.map(b => b.id)))}
                              className="text-xs px-2 py-1 rounded-lg font-semibold transition-all"
                              style={{ background: "var(--elevated)", color: "var(--text-sec)", border: "1px solid var(--border)" }}>
                              {t("admin.selectAll")}
                            </button>
                            <button onClick={exitSelection}
                              className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-all"
                              style={{ background: "var(--elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                              {t("admin.selectDone")}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setSelectionMode(true)}
                            className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-all"
                            style={{ background: "var(--primary)", color: "#fff" }}>
                            {t("admin.selectMode")}
                          </button>
                        )
                      )}
                    </div>
                    {bookings.map(b => {
                      const c = color(b.user_id);
                      const isSelected = selectedIds.has(b.id);
                      return (
                        <div key={b.id}
                          onClick={selectionMode ? () => toggleSelected(b.id) : undefined}
                          className="rounded-md p-3 transition-all"
                          style={{
                            background: "var(--elevated)",
                            border: `1px solid ${isSelected ? "var(--primary)" : "var(--border)"}`,
                            cursor: selectionMode ? "pointer" : "default",
                            boxShadow: isSelected ? "0 0 0 2px var(--primary-border) inset" : undefined,
                          }}>
                          <div className="flex items-start gap-2 mb-1">
                            {selectionMode && (
                              <div className="shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center transition-all"
                                style={{
                                  background: isSelected ? "var(--primary)" : "transparent",
                                  border: `1.5px solid ${isSelected ? "var(--primary)" : "var(--border)"}`,
                                }}>
                                {isSelected && (
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                )}
                              </div>
                            )}
                            <p className="text-xs font-bold flex-1 min-w-0 truncate" style={{ color: "var(--text)" }}>{b.title}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                style={{ background: c }}>{b.user.display_name[0]}</div>
                              {!selectionMode && (
                                <button
                                  onClick={() => setDeleteBookingTarget({ id: b.id, title: b.title, seriesId: b.recurrence_group_id })}
                                  className="w-6 h-6 flex items-center justify-center rounded-lg transition-all"
                                  style={{ color: "var(--text-muted)" }}
                                  onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = ""; }}
                                  title={t("admin.deleteBookingTip")}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-xs font-semibold" style={{ color: c }}>{fmtRange(b.start_time, b.end_time)}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{b.user.display_name}</p>
                          {b.guests.length > 0 && (
                            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                              {t("admin.guestsLabel")} {b.guests.map(g => `@${g}`).join(", ")}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {/* Users tab */}
              {tab === "users" && isSuperadmin && (
                usersLoading ? <MeetingListSkeleton /> : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                        {t("admin.usersCount", { n: users.length })}
                      </p>
                      <button onClick={() => { setShowAddForm(v => !v); setNewUsername(""); setInviteResult(null); setInviteCopied(false); }}
                        className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-all"
                        style={{ background: "var(--primary)", color: "#fff" }}>
                        {showAddForm ? t("common.cancel") : `+ ${t("common.add")}`}
                      </button>
                    </div>

                    {showAddForm && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                        className="rounded-md p-3 space-y-2"
                        style={{ background: "var(--elevated)", border: "1px solid var(--primary-border)" }}>
                        {inviteResult ? (
                          inviteResult.sent ? (
                            <p className="text-xs font-semibold text-center py-1" style={{ color: "#16a34a" }}>
                              {t("admin.inviteSent")}
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("admin.inviteLink")}</p>
                              <div className="flex items-center gap-2">
                                <code className="text-xs flex-1 px-2 py-1 rounded-lg truncate"
                                  style={{ background: "var(--input-bg)", color: "var(--primary)" }}>
                                  {inviteResult.link}
                                </code>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(inviteResult.link);
                                    setInviteCopied(true);
                                    setTimeout(() => setInviteCopied(false), 2000);
                                  }}
                                  className="text-xs px-2.5 py-1 rounded-lg font-semibold shrink-0"
                                  style={{ background: inviteCopied ? "#16a34a" : "var(--primary)", color: "#fff" }}>
                                  {inviteCopied ? t("admin.inviteCopied") : t("admin.inviteCopy")}
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          <>
                            <input type="text" placeholder={t("admin.inviteUsername")} value={newUsername}
                              onChange={e => setNewUsername(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && newUsername.trim()) sendInvite(); }}
                              className="w-full text-xs rounded-lg px-3 py-2 outline-none"
                              style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }} />
                            <button onClick={() => sendInvite()} disabled={!newUsername.trim() || inviting}
                              className="w-full text-xs py-2 rounded-lg font-bold text-white disabled:opacity-40"
                              style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)" }}>
                              {inviting ? t("admin.inviteSending") : t("admin.inviteSend")}
                            </button>
                          </>
                        )}
                      </motion.div>
                    )}

                    {users.map(u => {
                      const c = color(u.id);
                      const badge = roleBadge(u.role);
                      return (
                        <div key={u.id} className="rounded-md p-3 flex items-center gap-3"
                          style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                            style={{ background: c }}>{u.display_name[0]}</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{u.display_name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {u.username && (
                                <span className="text-xs" style={{ color: "var(--text-muted)" }}>@{u.username}</span>
                              )}
                              {badge && (
                                <span className="text-xs font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: badge.bg, color: badge.color }}>
                                  {badge.label}
                                </span>
                              )}
                            </div>
                          </div>
                          {u.id !== currentUser?.id && u.role !== "superadmin" && (
                            <div className="flex items-center gap-1 shrink-0">
                              {isSuperadmin && (
                                <button
                                  onClick={() => setRole({ userId: u.id, role: u.role === "admin" ? "user" : "admin" })}
                                  disabled={roleVars?.userId === u.id}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg text-sm font-bold transition-all disabled:opacity-40"
                                  style={u.role === "admin"
                                    ? { background: "rgba(124,58,237,0.12)", color: "var(--primary)", border: "1px solid var(--primary-border)" }
                                    : { background: "var(--elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }
                                  }
                                  title={u.role === "admin" ? t("admin.removeAdmin") : t("admin.giveAdmin")}
                                >
                                  {u.role === "admin" ? "−" : "+"}
                                </button>
                              )}
                              <button
                                onClick={() => setDeleteUserTarget({ id: u.id, name: u.display_name })}
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-xs transition-all"
                                style={{ color: "var(--text-muted)" }}
                                onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = ""; }}
                                title={t("admin.deleteUserTip")}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            <AnimatePresence>
              {selectionMode && tab === "bookings" && selectedIds.size > 0 && (
                <motion.div
                  key="bulk-bar"
                  initial={{ y: 80, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 80, opacity: 0 }}
                  transition={{ type: "spring", damping: 22, stiffness: 320 }}
                  className="absolute left-0 right-0 bottom-0 px-4 py-3 flex items-center gap-2"
                  style={{
                    background: "var(--panel)",
                    borderTop: "1px solid var(--border)",
                    boxShadow: isDark ? "0 -8px 24px rgba(0,0,0,0.4)" : "0 -8px 24px rgba(15,23,42,0.08)",
                  }}>
                  <button onClick={exitSelection}
                    className="text-xs px-3 py-2 rounded-lg font-semibold transition-all"
                    style={{ background: "var(--elevated)", color: "var(--text-sec)", border: "1px solid var(--border)" }}>
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={bulkDeleting}
                    className="flex-1 text-xs px-3 py-2 rounded-lg font-bold text-white transition-all disabled:opacity-50"
                    style={{ background: "#ef4444" }}>
                    {t("admin.bulkDelete", { n: selectedIds.size })}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}

      <ConfirmDialog
        open={!!deleteUserTarget}
        title={t("admin.deleteUserTitle")}
        message={t("admin.deleteUserConfirm", { name: deleteUserTarget?.name ?? "" })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        danger
        onConfirm={() => { if (deleteUserTarget) deleteUser(deleteUserTarget.id); setDeleteUserTarget(null); }}
        onCancel={() => setDeleteUserTarget(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={t("admin.bulkDeleteTitle")}
        message={t("admin.bulkDeleteConfirm", { n: selectedIds.size })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        danger
        onConfirm={() => bulkDelete(Array.from(selectedIds))}
        onCancel={() => setBulkDeleteOpen(false)}
      />

      <ConfirmDialog
        open={!!deleteBookingTarget}
        title={deleteBookingTarget?.seriesId ? t("admin.deleteSeriesTitle") : t("admin.deleteBookingTitle")}
        message={
          deleteBookingTarget?.seriesId
            ? t("admin.deleteSeriesConfirm", { title: deleteBookingTarget?.title ?? "" })
            : t("admin.deleteBookingConfirm", { title: deleteBookingTarget?.title ?? "" })
        }
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        danger
        onConfirm={() => {
          if (deleteBookingTarget) {
            deleteBooking({
              id: deleteBookingTarget.id,
              deleteSeries: !!deleteBookingTarget.seriesId,
            });
          }
          setDeleteBookingTarget(null);
        }}
        onCancel={() => setDeleteBookingTarget(null)}
      />
    </AnimatePresence>

    {/* Analytics full-screen modal */}
    {analyticsModalOpen && isSuperadmin && createPortal(
      <div
        style={{ position: "fixed", inset: 0, zIndex: 10100, background: isDark ? "rgba(0,0,0,0.75)" : "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={() => setAnalyticsModalOpen(false)}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: 720, maxHeight: "90vh",
            background: "var(--modal)", border: "1px solid var(--border)",
            borderRadius: 8, display: "flex", flexDirection: "column",
            boxShadow: isDark ? "0 32px 80px rgba(0,0,0,0.8)" : "0 8px 40px rgba(15,23,42,0.18)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <h2 className="font-bold text-base" style={{ color: "var(--text)" }}>Аналитика</h2>
            <button onClick={() => setAnalyticsModalOpen(false)}
              className="w-8 h-8 flex items-center justify-center rounded-md transition-all"
              style={{ color: "var(--text-muted)", background: "var(--elevated)" }}
              onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
              </svg>
            </button>
          </div>
          {/* Filters */}
          <div className="px-6 pt-4 pb-3 flex flex-wrap items-center gap-3" style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div className="flex gap-1.5">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setAnalyticsPeriod(d)}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                  style={{
                    background: analyticsPeriod === d ? "var(--primary)" : "var(--elevated)",
                    color: analyticsPeriod === d ? "#fff" : "var(--text-muted)",
                    border: `1px solid ${analyticsPeriod === d ? "var(--primary)" : "var(--border)"}`,
                  }}>
                  {d} дн.
                </button>
              ))}
            </div>
            {(analyticsData?.workspaces?.length ?? 0) > 0 && (
              <div style={{ flex: 1, minWidth: 180 }}>
                <CustomSelect
                  value={analyticsWorkspaceId !== undefined ? String(analyticsWorkspaceId) : ""}
                  onChange={v => setAnalyticsWorkspaceId(v ? Number(v) : undefined)}
                  options={[
                    { value: "", label: "Все пространства" },
                    ...(analyticsData?.workspaces ?? []).map(ws => ({ value: String(ws.id), label: ws.name })),
                  ]}
                />
              </div>
            )}
          </div>
          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {analyticsLoading ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => <div key={i} className="h-24 rounded-md animate-pulse" style={{ background: "var(--elevated)" }} />)}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md p-4" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                    <div className="text-3xl font-black" style={{ color: "var(--text)" }}>{analyticsData?.total_members ?? 0}</div>
                    <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Участников</div>
                  </div>
                  <div className="rounded-md p-4" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                    <div className="text-3xl font-black" style={{ color: "var(--text)" }}>{analyticsData?.total_meetings ?? 0}</div>
                    <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Встреч за период</div>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-bold mb-2" style={{ color: "var(--text-sec)" }}>Новые участники</p>
                  <AdminBarChart data={analyticsData?.new_members ?? []} color="#7c3aed" />
                </div>
                <div>
                  <p className="text-sm font-bold mb-2" style={{ color: "var(--text-sec)" }}>Частота встреч</p>
                  <AdminBarChart data={analyticsData?.meetings_by_day ?? []} color="#0891b2" />
                </div>
                {(analyticsData?.top_organizers?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-sm font-bold mb-2" style={{ color: "var(--text-sec)" }}>Топ организаторов</p>
                    <div className="space-y-3">
                      {analyticsData!.top_organizers.map((item, i) => {
                        const max = Math.max(...analyticsData!.top_organizers.map(x => x.count), 1);
                        return (
                          <div key={i}>
                            <div className="flex justify-between mb-1" style={{ fontSize: 13 }}>
                              <span className="font-semibold truncate" style={{ color: "var(--text)" }}>{item.user_name}</span>
                              <span style={{ color: "var(--text-muted)", flexShrink: 0, marginLeft: 8 }}>{item.count}</span>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--elevated)" }}>
                              <div className="h-full rounded-full" style={{ width: `${(item.count / max) * 100}%`, background: "linear-gradient(90deg,#7c3aed,#a855f7)" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

function CustomSelect({
  value, onChange, options, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropRect, setDropRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(o => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(v => !v);
  };

  return (
    <div>
      <button ref={btnRef} type="button" disabled={disabled} onClick={toggle}
        className="w-full rounded-lg px-2.5 py-1.5 text-xs text-left flex items-center justify-between gap-2 outline-none"
        style={{
          background: "var(--input-bg)", color: "var(--text)",
          border: `1.5px solid ${open ? "var(--primary)" : "var(--input-border)"}`,
          cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
          transition: "border-color 0.15s",
        }}>
        <span className="truncate min-w-0">{selected}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="shrink-0"
          style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}>
          <path d="M1 1l4 4 4-4" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && dropRect && (
        <div onMouseDown={e => e.stopPropagation()}
          style={{
            position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width,
            zIndex: 9999, background: "var(--panel)", border: "1.5px solid var(--border)",
            borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          }}>
          {options.map(o => (
            <button key={o.value} type="button"
              onMouseDown={() => { onChange(o.value); setOpen(false); }}
              className="w-full px-2.5 py-1.5 text-xs text-left"
              style={{
                background: o.value === value ? "var(--primary-light)" : "transparent",
                color: o.value === value ? "var(--primary)" : "var(--text)",
                fontWeight: o.value === value ? "600" : "400",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => { if (o.value !== value) e.currentTarget.style.background = "var(--elevated)"; }}
              onMouseLeave={e => { if (o.value !== value) e.currentTarget.style.background = "transparent"; }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtChartDate(iso: string): string {
  const p = iso.split("-");
  return p.length === 3 ? `${p[2]}.${p[1]}` : iso;
}

function AdminBarChart({ data, color }: { data: Array<{ date: string; count: number }>; color: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (data.length === 0) return (
    <p className="text-xs py-2 text-center" style={{ color: "var(--text-muted)" }}>Нет данных</p>
  );
  const H = 76;
  const TOP = 14;
  const BOTTOM_LABEL = 12;
  const barAreaH = H - TOP - 4 - BOTTOM_LABEL;
  const max = Math.max(...data.map(d => d.count), 1);
  const n = data.length;
  return (
    <svg width="100%" height={H} style={{ display: "block", overflow: "visible" }}>
      {data.map((d, i) => {
        const bH = Math.max(3, (d.count / max) * barAreaH);
        const xPct = (i / n) * 100;
        const wPct = (1 / n) * 100;
        const barY = TOP + barAreaH - bH;
        const cx = `${xPct + wPct * 0.5}%`;
        return (
          <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
            <rect
              x={`${xPct + wPct * 0.1}%`} y={barY}
              width={`${wPct * 0.8}%`} height={bH}
              rx={2} fill={color} opacity={hovered === i ? 1 : 0.75}
            />
            {d.count > 0 && (
              <text x={cx} y={barY - 3} textAnchor="middle" fontSize={9} fontWeight="600" fill={color}>
                {d.count}
              </text>
            )}
            <text x={cx} y={H - 1} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
              {fmtChartDate(d.date)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
