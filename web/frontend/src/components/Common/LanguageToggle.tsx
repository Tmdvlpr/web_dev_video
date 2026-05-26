import { motion } from "framer-motion";
import { useLocale } from "../../contexts/LocaleContext";
import { LOCALE_LABEL, type Locale } from "../../i18n/translations";

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const next: Locale = locale === "ru" ? "uz" : "ru";
  return (
    <motion.button
      onClick={() => setLocale(next)}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      className="flex items-center justify-center rounded text-xs font-bold transition-all"
      title={locale === "ru" ? "Тилни ўзгартириш" : "Сменить язык"}
      style={{
        height: 32,
        padding: "0 10px",
        border: "1px solid var(--border)",
        background: "var(--elevated)",
        color: "var(--text-sec)",
        letterSpacing: "0.04em",
      }}
    >
      {LOCALE_LABEL[locale]}
    </motion.button>
  );
}
