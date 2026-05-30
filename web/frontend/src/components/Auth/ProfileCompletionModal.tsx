import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/axios";
import { useLocale } from "../../contexts/LocaleContext";
import type { User } from "../../types";

interface Props {
  open: boolean;
}

/**
 * Shown over the dashboard whenever the authenticated user has no
 * real first/last name (auto-created via QR auth → name = "user_<tg_id>").
 * Cannot be dismissed: blocks until profile is completed.
 */
export function ProfileCompletionModal({ open }: Props) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState("");

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const res = await apiClient.patch<User>("/api/v1/auth/me", {
        first_name: first.trim(),
        last_name: last.trim(),
      });
      return res.data;
    },
    onSuccess: (updated) => {
      qc.setQueryData<User>(["me"], updated);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? "Error";
      setError(t("profile.saveError", { detail }));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!first.trim()) {
      setError(t("profile.required"));
      return;
    }
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
        >
          <motion.form
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onSubmit={submit}
            className="w-full max-w-sm p-6 rounded-md"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <h2 className="text-lg font-bold mb-1" style={{ color: "var(--text)" }}>
              {t("profile.completeTitle")}
            </h2>
            <p className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>
              {t("profile.completeSubtitle")}
            </p>

            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-sec)" }}>
              {t("profile.firstName")}
            </label>
            <input
              type="text"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              autoFocus
              className="w-full text-sm rounded px-3 py-2 mb-3 outline-none"
              style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
            />

            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--text-sec)" }}>
              {t("profile.lastName")}
            </label>
            <input
              type="text"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              className="w-full text-sm rounded px-3 py-2 mb-4 outline-none"
              style={{ background: "var(--input-bg)", border: "1px solid var(--input-border)", color: "var(--text)" }}
            />

            <AnimatePresence>
              {error && (
                <motion.p
                  key="completion-error"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="text-xs mb-3 font-semibold"
                  style={{ color: "#ef4444" }}
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={isPending || !first.trim()}
              className="w-full text-sm py-2.5 rounded font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
