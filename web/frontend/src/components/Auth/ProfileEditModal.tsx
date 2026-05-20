import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "../../api/auth";
import { useLocale } from "../../contexts/LocaleContext";
import { useTheme } from "../../contexts/ThemeContext";
import type { User } from "../../types";

const POSITIONS = [
  "Начальник департамента/отдела",
  "PM",
  "Аналитик",
  "Программист и др.",
  "Дизайнер",
] as const;

const POSITION_T_KEYS: Record<string, string> = {
  "Начальник департамента/отдела": "pos.chief",
  "PM": "pos.pm",
  "Аналитик": "pos.analyst",
  "Программист и др.": "pos.programmer",
  "Дизайнер": "pos.designer",
};

interface Props {
  open: boolean;
  user: User;
  onClose: () => void;
  onSaved: () => void;
}

export function ProfileEditModal({ open, user, onClose, onSaved }: Props) {
  const { t } = useLocale();
  const { isDark } = useTheme();
  const qc = useQueryClient();

  const [first, setFirst] = useState(user.first_name ?? "");
  const [last, setLast] = useState(user.last_name ?? "");
  const [position, setPosition] = useState<string | null>(user.position ?? null);
  const [error, setError] = useState("");

  // ── Meeting preferences (stored in localStorage) ───────────────────────────
  const [noiseFilter, setNoiseFilter] = useState(
    () => localStorage.getItem("meeting.noise_filter") === "true"
  );
  const [bgBlur, setBgBlur] = useState(
    () => localStorage.getItem("meeting.background_blur") === "true"
  );

  const toggleNoise = () => {
    const next = !noiseFilter;
    localStorage.setItem("meeting.noise_filter", String(next));
    setNoiseFilter(next);
  };

  const toggleBlur = () => {
    const next = !bgBlur;
    localStorage.setItem("meeting.background_blur", String(next));
    setBgBlur(next);
  };

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      authApi.updateMe({ first_name: first.trim(), last_name: last.trim() || undefined, position }),
    onSuccess: (updated) => {
      qc.setQueryData<User>(["me"], updated);
      qc.invalidateQueries({ queryKey: ["me"] });
      onSaved();
      onClose();
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "";
      setError(t("profile.saveError", { detail }));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!first.trim()) { setError(t("profile.required")); return; }
    setError("");
    mutate();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="bg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(8px)" }}
          onClick={onClose}
        >
          <motion.form
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            onSubmit={submit}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm p-6 rounded-2xl"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>
                {t("profile.editTitle")}
              </h2>
              <button type="button" onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-full text-lg leading-none"
                style={{ color: "var(--text-muted)", background: "var(--elevated)" }}>
                ×
              </button>
            </div>

            {/* Name */}
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-sec)" }}>
              {t("profile.firstName")}
            </label>
            <input
              type="text"
              value={first}
              onChange={e => setFirst(e.target.value)}
              autoFocus
              className="w-full text-sm rounded-lg px-3 py-2 mb-3 outline-none"
              style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
            />

            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-sec)" }}>
              {t("profile.lastName")}
            </label>
            <input
              type="text"
              value={last}
              onChange={e => setLast(e.target.value)}
              className="w-full text-sm rounded-lg px-3 py-2 mb-4 outline-none"
              style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
            />

            {/* Position */}
            <label className="block text-xs font-semibold mb-2" style={{ color: "var(--text-sec)" }}>
              {t("profile.position")}
            </label>
            <div className="flex flex-col gap-1.5 mb-4">
              {POSITIONS.map(pos => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setPosition(pos)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: position === pos ? "var(--primary)" : "var(--elevated)",
                    border: `1.5px solid ${position === pos ? "var(--primary)" : "var(--border)"}`,
                    color: position === pos ? "#fff" : isDark ? "var(--text)" : "var(--text-sec)",
                  }}
                >
                  {t(POSITION_T_KEYS[pos] as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>

            {/* Meeting settings */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginBottom: 16 }}>
              <p className="text-xs font-semibold mb-3" style={{ color: "var(--text-sec)" }}>
                Настройки встреч
              </p>
              {[
                {
                  key: "noise",
                  on: noiseFilter,
                  toggle: toggleNoise,
                  label: "Шумоподавление (Krisp)",
                  hint: "Автоматически включается при входе во встречу",
                },
                {
                  key: "blur",
                  on: bgBlur,
                  toggle: toggleBlur,
                  label: "Размытие фона",
                  hint: "Применяется к камере при входе во встречу",
                },
              ].map(({ key, on, toggle, label, hint }) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 mb-3 cursor-pointer select-none"
                  onClick={toggle}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>{label}</p>
                    <p className="text-xs" style={{ color: "var(--text-sec)" }}>{hint}</p>
                  </div>
                  <div
                    style={{
                      flexShrink: 0,
                      width: 40, height: 22,
                      borderRadius: 11,
                      background: on ? "var(--primary)" : "var(--elevated)",
                      border: `1.5px solid ${on ? "var(--primary)" : "var(--border)"}`,
                      position: "relative",
                      transition: "background 0.2s, border-color 0.2s",
                    }}
                  >
                    <div style={{
                      position: "absolute",
                      top: "50%", transform: "translateY(-50%)",
                      left: on ? 21 : 2,
                      width: 14, height: 14,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                    }} />
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <p className="text-xs mb-3 font-semibold" style={{ color: "#ef4444" }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={isPending || !first.trim()}
              className="w-full text-sm py-2.5 rounded-lg font-bold text-white transition-all disabled:opacity-50"
              style={{ background: "var(--primary)" }}
            >
              {isPending ? t("common.loading") : t("common.save")}
            </button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
