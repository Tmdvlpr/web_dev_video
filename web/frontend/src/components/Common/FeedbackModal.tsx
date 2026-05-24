import { motion, AnimatePresence } from "framer-motion";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { submissionsApi, type Submission, type SubmissionStatus } from "../../api/submissions";
import { useLocale } from "../../contexts/LocaleContext";
import { useTheme } from "../../contexts/ThemeContext";

const MAX_BYTES = 3_000_000;

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
  onBack?: () => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const STATUS_META: Record<SubmissionStatus, { bg: string; color: string; border: string; dot: string }> = {
  new:         { bg: "rgba(21,101,168,0.12)", color: "#1565a8", border: "rgba(21,101,168,0.3)", dot: "#1565a8" },
  in_progress: { bg: "rgba(217,119,6,0.12)",  color: "#d97706", border: "rgba(217,119,6,0.3)",  dot: "#f59e0b" },
  closed:      { bg: "rgba(22,163,74,0.12)",  color: "#15803d", border: "rgba(22,163,74,0.3)",  dot: "#22c55e" },
};

export function FeedbackModal({ open, onClose, onSuccess, onError, onBack }: Props) {
  const { t, locale } = useLocale();
  const { isDark } = useTheme();
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "form">("list");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: myItems = [], isLoading } = useQuery({
    queryKey: ["submissions", "me"],
    queryFn: submissionsApi.myList,
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: () => submissionsApi.create(text.trim(), photo),
    onSuccess: () => {
      setText("");
      setPhoto(null);
      qc.invalidateQueries({ queryKey: ["submissions", "me"] });
      onSuccess?.(t("feedback.sent"));
      setView("list");
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? "error";
      onError?.(t("feedback.errorSend", { detail }));
    },
  });

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      onError?.(t("feedback.tooLargePhoto"));
      e.target.value = "";
      return;
    }
    try { setPhoto(await fileToDataUrl(file)); }
    catch { onError?.(t("common.error")); }
    e.target.value = "";
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const imageItem = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    if (file.size > MAX_BYTES) { onError?.(t("feedback.tooLargePhoto")); return; }
    try { setPhoto(await fileToDataUrl(file)); }
    catch { onError?.(t("common.error")); }
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(locale === "uz" ? "uz-UZ" : "ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  };

  const statusLabel = (s: SubmissionStatus) => {
    if (s === "new") return t("submissions.statusNew");
    if (s === "in_progress") return t("submissions.statusInProgress");
    return t("submissions.statusClosed");
  };

  const handleClose = () => { setView("list"); (onBack ?? onClose)(); };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="bd"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          />

          {/* Panel — right-side drawer style */}
          <motion.div
            key="panel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed right-0 top-0 bottom-0 z-[51] flex flex-col"
            style={{
              width: 300,
              background: isDark ? "#13111a" : "#ffffff",
              borderLeft: `1px solid ${isDark ? "rgba(21,101,168,0.2)" : "#e5e7eb"}`,
              boxShadow: isDark
                ? "-20px 0 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(21,101,168,0.08)"
                : "-8px 0 40px rgba(15,23,42,0.14)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 shrink-0"
              style={{ borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.07)" : "#f0f0f0"}` }}>
              <div className="flex items-center gap-3">
                {view === "form" && (
                  <button
                    onClick={() => setView("list")}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                    style={{ color: "var(--text-muted)", background: isDark ? "rgba(255,255,255,0.06)" : "#f5f5f5" }}
                    onMouseEnter={e => { e.currentTarget.style.color = "var(--primary)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>
                    ‹
                  </button>
                )}
                <div>
                  <h2 className="text-sm font-bold" style={{ color: isDark ? "#e2e8f0" : "#0f172a" }}>
                    {view === "form" ? t("feedback.title") : t("feedback.tabMy")}
                  </h2>
                  {view === "list" && (
                    <p className="text-xs mt-0.5" style={{ color: isDark ? "#64748b" : "#94a3b8" }}>
                      {t("feedback.subtitle")}
                    </p>
                  )}
                </div>
              </div>
              <button onClick={handleClose}
                className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                style={{ color: isDark ? "#64748b" : "#94a3b8", background: isDark ? "rgba(255,255,255,0.06)" : "#f5f5f5" }}
                onMouseEnter={e => { e.currentTarget.style.color = isDark ? "#e2e8f0" : "#0f172a"; }}
                onMouseLeave={e => { e.currentTarget.style.color = isDark ? "#64748b" : "#94a3b8"; }}>
                {onBack && view === "list"
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                  : <span className="text-xl leading-none">×</span>}
              </button>
            </div>

            {/* List view */}
            {view === "list" && (
              <>
                {/* New submission CTA */}
                <div className="px-4 pt-4 pb-2 shrink-0">
                  <button
                    onClick={() => setView("form")}
                    className="w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                    style={{
                      background: "linear-gradient(135deg,#1565a8,#114e85)",
                      color: "#fff",
                      boxShadow: "0 4px 16px rgba(21,101,168,0.3)",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 6px 24px rgba(21,101,168,0.45)"; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(21,101,168,0.3)"; }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14"/>
                    </svg>
                    {t("feedback.tabNew")}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5" style={{ minHeight: 0 }}>
                  {isLoading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="h-20 rounded-xl animate-pulse"
                        style={{ background: isDark ? "rgba(255,255,255,0.05)" : "#f5f5f5" }} />
                    ))
                  ) : myItems.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-4xl mb-3">💬</div>
                      <p className="text-sm font-semibold mb-1" style={{ color: isDark ? "#cbd5e1" : "#334155" }}>
                        {t("feedback.myEmpty")}
                      </p>
                      <p className="text-xs" style={{ color: isDark ? "#475569" : "#94a3b8" }}>
                        {t("feedback.subtitle")}
                      </p>
                    </div>
                  ) : (
                    (myItems as Submission[]).map((s) => {
                      const meta = STATUS_META[s.status];
                      return (
                        <motion.div
                          key={s.id}
                          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          className="rounded-xl p-3.5"
                          style={{
                            background: isDark ? "rgba(255,255,255,0.04)" : "#fafafa",
                            border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#e5e7eb"}`,
                          }}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-xs" style={{ color: isDark ? "#64748b" : "#94a3b8" }}>{fmtDate(s.created_at)}</p>
                            <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0"
                              style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.dot }} />
                              {statusLabel(s.status)}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed" style={{ color: isDark ? "#cbd5e1" : "#334155" }}>
                            {s.text.length > 180 ? s.text.slice(0, 180) + "…" : s.text}
                          </p>
                        </motion.div>
                      );
                    })
                  )}
                </div>
              </>
            )}

            {/* Form view */}
            {view === "form" && (
              <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3" style={{ minHeight: 0 }}>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={onPaste}
                  placeholder={t("feedback.textPlaceholder")}
                  rows={6}
                  maxLength={4000}
                  className="w-full text-sm rounded-xl px-4 py-3 outline-none resize-none transition-all"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.05)" : "#f8fafc",
                    border: `1.5px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                    color: isDark ? "#e2e8f0" : "#0f172a",
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = "var(--primary)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(21,101,168,0.12)"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"; e.currentTarget.style.boxShadow = "none"; }}
                />

                {photo && (
                  <div className="relative rounded-xl overflow-hidden"
                    style={{ border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e5e7eb"}` }}>
                    <img src={photo} alt="attachment" className="w-full max-h-48 object-contain"
                      style={{ background: isDark ? "rgba(255,255,255,0.03)" : "#f5f5f5" }} />
                    <button
                      onClick={() => setPhoto(null)}
                      className="absolute top-2 right-2 px-2 py-1 rounded-md text-xs font-bold"
                      style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}>
                      {t("feedback.removePhoto")}
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-auto pt-1">
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-xs px-3 py-2 rounded-xl font-semibold transition-all"
                    style={{
                      background: isDark ? "rgba(255,255,255,0.06)" : "#f1f5f9",
                      color: isDark ? "#94a3b8" : "#64748b",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e2e8f0"}`,
                    }}>
                    📎 {t("feedback.attachPhoto")}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => mutate()}
                    disabled={isPending || !text.trim()}
                    className="text-sm px-5 py-2 rounded-xl font-bold text-white transition-all disabled:opacity-50"
                    style={{
                      background: "linear-gradient(135deg,#1565a8,#114e85)",
                      boxShadow: "0 3px 12px rgba(21,101,168,0.35)",
                    }}>
                    {isPending ? t("feedback.sending") : t("feedback.send")}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
