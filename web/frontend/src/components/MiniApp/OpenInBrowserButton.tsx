import { motion } from "framer-motion";
import { useState } from "react";
import { authApi } from "../../api/auth";
import { tg } from "../../utils/telegram";

export default function OpenInBrowserButton() {
  const [isLoading, setIsLoading] = useState(false);

  const handleOpen = async () => {
    try {
      setIsLoading(true);
      const { browser_url } = await authApi.createBrowserSession();
      if (tg) {
        tg.openLink(browser_url);
      } else {
        window.location.href = browser_url;
      }
    } catch {
      alert("Ошибка при открытии браузера");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.button
      onClick={handleOpen}
      disabled={isLoading}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
      style={{
        background: "var(--elevated)",
        border: "1px solid var(--border)",
        color: "var(--text)",
      }}
    >
      {isLoading ? "⏳ Подготовка..." : "🌐 Открыть в браузере"}
    </motion.button>
  );
}
