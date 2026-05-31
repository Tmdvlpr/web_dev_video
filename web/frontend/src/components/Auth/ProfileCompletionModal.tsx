import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { authApi } from "../../api/auth";
import { useLocale } from "../../contexts/LocaleContext";
import { useTheme } from "../../contexts/ThemeContext";
import type { User } from "../../types";

interface Props {
  user: User | null;
}

export function ProfileCompletionModal({ user }: Props) {
  const { t } = useLocale();
  const { isDark } = useTheme();
  const qc = useQueryClient();

  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const isIncomplete = !!user && (!user.position || !user.first_name || user.first_name.startsWith("user_"));

  const createSession = useCallback(async () => {
    setExpired(false);
    setBotUrl(null);
    try {
      const data = await authApi.createQrSession();
      setToken(data.token);
      setBotUrl(data.bot_url);
    } catch {
      setBotUrl(null);
    }
  }, []);

  useEffect(() => {
    if (!isIncomplete) return;
    createSession();
  }, [isIncomplete, createSession]);

  useEffect(() => {
    if (!token || !isIncomplete) return;
    let active = true;
    const poll = async () => {
      while (active) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!active) break;
        try {
          const res = await authApi.pollSession(token);
          if ("access_token" in res) {
            await qc.invalidateQueries({ queryKey: ["me"] });
            return;
          }
        } catch (e: any) {
          if (e?.response?.status === 410 || e?.response?.status === 404) {
            setExpired(true);
            return;
          }
        }
      }
    };
    poll();
    return () => { active = false; };
  }, [token, isIncomplete, qc]);

  const openTgPopup = () => {
    if (!botUrl) return;
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    const w = 520, h = 700;
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top = Math.max(0, (window.screen.height - h) / 2);
    popupRef.current = window.open(
      botUrl,
      "corpmeet_tg_reg",
      `popup,width=${w},height=${h},left=${left},top=${top}`
    );
  };

  if (!isIncomplete) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.72)", backdropFilter: "blur(10px)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm p-6 rounded-md text-center"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <h2 className="text-lg font-bold mb-1" style={{ color: "var(--text)" }}>
          {t("profile.positionTitle")}
        </h2>
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
          {t("profile.positionSubtitle")}
        </p>

        {expired ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm font-semibold" style={{ color: "rgba(239,68,68,0.8)" }}>
              {t("auth.qrExpired")}
            </p>
            <button
              onClick={createSession}
              className="px-4 py-2 rounded-md text-sm font-bold text-white"
              style={{ background: "linear-gradient(135deg, #2563eb, #6366f1)" }}
            >
              {t("auth.createNew")}
            </button>
          </div>
        ) : !botUrl ? (
          <div className="flex justify-center py-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-8 h-8 rounded-full border-2"
              style={{
                borderColor: isDark ? "rgba(96,165,250,0.3)" : "rgba(37,99,235,0.3)",
                borderTopColor: isDark ? "rgba(96,165,250,0.85)" : "rgba(37,99,235,0.8)",
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div
              className="p-3 rounded-md"
              style={{
                background: "white",
                boxShadow: isDark ? "0 2px 16px rgba(96,165,250,0.15)" : "0 2px 16px rgba(37,99,235,0.12)",
              }}
            >
              <QRCodeSVG value={botUrl} size={160} level="M" bgColor="#ffffff" fgColor="#1e293b" />
            </div>

            <p className="text-xs" style={{ color: isDark ? "rgba(255,255,255,0.55)" : "rgba(37,99,235,0.55)", maxWidth: 220, lineHeight: 1.6 }}>
              {t("auth.qrHint")}
            </p>

            <button onClick={openTgPopup} className="tg-glow-btn"
              style={!isDark ? { background: "rgba(255,255,255,0.93)", color: "#0f172a" } : undefined}>
              {t("auth.openTelegram")}
            </button>

            <div className="flex items-center gap-2">
              {[0, 0.2, 0.4].map((d, i) => (
                <motion.div key={i} className="w-1.5 h-1.5 rounded-full"
                  style={{ background: isDark ? "rgba(255,255,255,0.65)" : "rgba(37,99,235,0.65)" }}
                  animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.4, 0.8] }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: d }} />
              ))}
              <span className="text-xs ml-1 font-semibold"
                style={{ color: isDark ? "rgba(255,255,255,0.5)" : "rgba(37,99,235,0.4)", letterSpacing: "0.06em" }}>
                {t("auth.waiting")}
              </span>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
