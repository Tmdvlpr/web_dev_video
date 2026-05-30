import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocale } from "../../contexts/LocaleContext";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmText, cancelText,
  danger = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const confirmLabel = confirmText ?? t("common.confirm");
  const cancelLabel  = cancelText  ?? t("common.cancel");

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9990]"
            style={{ background: isDark ? "rgba(0,0,0,0.6)" : "rgba(15,23,42,0.25)", backdropFilter: "blur(4px)" }}
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed z-[9991] inset-0 m-auto w-full max-w-sm h-fit rounded-md p-6"
            style={{
              background: "var(--modal)",
              border: "1px solid var(--border)",
              backdropFilter: "blur(20px)",
              boxShadow: isDark ? "0 16px 48px rgba(0,0,0,0.5)" : "0 16px 48px rgba(15,23,42,0.12)",
            }}
          >
            <h3 className="text-base font-bold mb-2" style={{ color: "var(--text)" }}>{title}</h3>
            <p className="text-sm mb-6" style={{ color: "var(--text-sec)" }}>{message}</p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-md text-sm font-medium transition-all cursor-pointer"
                style={{ color: "var(--text-muted)", border: "1px solid var(--border)", transition: "background-color 0.15s ease" }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--elevated)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = ""; }}
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 rounded-md text-sm font-bold text-white transition-all cursor-pointer"
                style={{
                  background: danger ? "var(--danger)" : "var(--primary)",
                  boxShadow: danger
                    ? (isDark ? "0 2px 12px rgba(252,165,165,0.25)" : "0 2px 12px rgba(239,68,68,0.25)")
                    : (isDark ? "0 2px 12px rgba(165,180,252,0.25)" : "0 2px 12px rgba(79,70,229,0.25)"),
                  transition: "opacity 0.15s ease",
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
