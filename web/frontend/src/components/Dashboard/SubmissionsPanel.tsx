import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { submissionsApi, type Submission, type SubmissionStatus } from "../../api/submissions";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
}

const STATUS_COLORS: Record<SubmissionStatus, { bg: string; color: string; border: string }> = {
  new:         { bg: "rgba(124,58,237,0.12)", color: "#7c3aed", border: "rgba(124,58,237,0.35)" },
  in_progress: { bg: "rgba(217,119,6,0.12)",  color: "#d97706", border: "rgba(217,119,6,0.35)"  },
  closed:      { bg: "rgba(100,116,139,0.12)",color: "#64748b", border: "rgba(100,116,139,0.35)" },
};

function fmtDate(iso: string, locale: string) {
  const d = new Date(iso);
  return d.toLocaleString(locale === "uz" ? "uz-UZ" : "ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function SubmissionsPanel({ isOpen, onClose, onBack }: Props) {
  const { isDark } = useTheme();
  const { t, locale } = useLocale();
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["admin", "submissions"],
    queryFn: submissionsApi.adminList,
    enabled: isOpen,
    refetchInterval: isOpen ? 30_000 : false,
  });

  const { mutate: setStatus, variables: statusVars, isPending: statusPending } = useMutation({
    mutationFn: ({ id, status }: { id: number; status: SubmissionStatus }) =>
      submissionsApi.adminUpdateStatus(id, status),
    onMutate: ({ id, status }) => {
      qc.setQueryData<Submission[]>(["admin", "submissions"], (old = []) =>
        old.map(s => s.id === id ? { ...s, status } : s));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "submissions"] });
      qc.invalidateQueries({ queryKey: ["submissions", "me"] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ["admin", "submissions"] }),
  });

  const { mutate: del } = useMutation({
    mutationFn: (id: number) => submissionsApi.adminDelete(id),
    onMutate: (id) => {
      qc.setQueryData<Submission[]>(["admin", "submissions"], (old = []) =>
        old.filter(s => s.id !== id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "submissions"] });
      qc.invalidateQueries({ queryKey: ["submissions", "me"] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ["admin", "submissions"] }),
  });

  const statusLabel = (s: SubmissionStatus) => {
    if (s === "new") return t("submissions.statusNew");
    if (s === "in_progress") return t("submissions.statusInProgress");
    return t("submissions.statusClosed");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div key="bd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
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

            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>{t("submissions.title")}</h3>
              <button onClick={onBack ?? onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                style={{ color: "var(--text-muted)", background: "var(--elevated)", transition: "color 0.15s ease" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>
                {onBack
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                  : <span className="text-xl leading-none">×</span>}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-32 rounded-md animate-pulse" style={{ background: "var(--elevated)" }} />
                ))
              ) : items.length === 0 ? (
                <p className="text-xs text-center pt-8" style={{ color: "var(--text-muted)" }}>
                  {t("submissions.empty")}
                </p>
              ) : (
                items.map((s: Submission) => {
                  const c = STATUS_COLORS[s.status];
                  return (
                    <div key={s.id}
                      className="rounded-md p-3 space-y-2"
                      style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold" style={{ color: "var(--text)" }}>
                            {s.user.display_name}
                            {s.user.username && (
                              <span className="ml-1" style={{ color: "var(--text-muted)", fontWeight: 400 }}>@{s.user.username}</span>
                            )}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{fmtDate(s.created_at, locale)}</p>
                        </div>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
                          style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                          {statusLabel(s.status)}
                        </span>
                      </div>

                      <p className="text-xs whitespace-pre-wrap break-words" style={{ color: "var(--text-sec)" }}>
                        {s.text}
                      </p>

                      {s.photo_b64 && (
                        <a href={s.photo_b64} target="_blank" rel="noreferrer">
                          <img src={s.photo_b64} alt="attachment"
                            className="w-full max-h-64 object-contain rounded"
                            style={{ background: "var(--card)", border: "1px solid var(--border)" }} />
                        </a>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {s.status !== "in_progress" && (
                          <button onClick={() => setStatus({ id: s.id, status: "in_progress" })}
                            disabled={statusPending && statusVars?.id === s.id}
                            className="text-xs px-2.5 py-1 rounded font-semibold transition-all disabled:opacity-50"
                            style={{ background: "rgba(217,119,6,0.12)", color: "#d97706", border: "1px solid rgba(217,119,6,0.35)" }}>
                            {t("submissions.markInProgress")}
                          </button>
                        )}
                        {s.status !== "closed" && (
                          <button onClick={() => setStatus({ id: s.id, status: "closed" })}
                            disabled={statusPending && statusVars?.id === s.id}
                            className="text-xs px-2.5 py-1 rounded font-semibold transition-all disabled:opacity-50"
                            style={{ background: "rgba(100,116,139,0.12)", color: "#64748b", border: "1px solid rgba(100,116,139,0.35)" }}>
                            {t("submissions.markClosed")}
                          </button>
                        )}
                        {s.status !== "new" && (
                          <button onClick={() => setStatus({ id: s.id, status: "new" })}
                            disabled={statusPending && statusVars?.id === s.id}
                            className="text-xs px-2.5 py-1 rounded font-semibold transition-all disabled:opacity-50"
                            style={{ background: "rgba(124,58,237,0.12)", color: "#7c3aed", border: "1px solid rgba(124,58,237,0.35)" }}>
                            {t("submissions.markNew")}
                          </button>
                        )}
                        <div className="flex-1" />
                        <button onClick={() => { if (confirm(t("submissions.deleteConfirm"))) del(s.id); }}
                          className="text-xs px-2 py-1 rounded font-semibold transition-all"
                          style={{ color: "var(--text-muted)", transition: "color 0.15s ease, background-color 0.15s ease" }}
                          onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = ""; }}>
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
