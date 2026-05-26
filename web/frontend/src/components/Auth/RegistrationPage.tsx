import { motion } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../api/auth";
import { storage } from "../../utils/storage";
import { useTelegram } from "../../hooks/useTelegram";

export default function RegistrationPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { initData } = useTelegram();
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError("Заполните имя и фамилию");
      return;
    }

    try {
      setIsLoading(true);
      setError("");
      const res = await authApi.register(initData, firstName.trim(), lastName.trim());
      storage.setToken(res.access_token);
      sessionStorage.setItem("__corpmeet_replay_splash", "1");
      window.dispatchEvent(new CustomEvent("corpmeet:replay-splash"));
      navigate("/bookings", { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Ошибка регистрации. Попробуйте ещё раз.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--bg)" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm p-8 rounded-md"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <div className="text-center mb-8">
          <div
            className="text-3xl font-black mb-2"
            style={{ color: "var(--text)" }}
          >
            Corp
            <span
              style={{
                background: "linear-gradient(90deg,#1565a8,#06b6d4)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Meet
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Первый вход — заполните данные
          </p>
        </div>

        <form onSubmit={handleRegister} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Имя"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-md text-sm outline-none"
            style={{
              background: "var(--elevated)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
          <input
            type="text"
            placeholder="Фамилия"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-md text-sm outline-none"
            style={{
              background: "var(--elevated)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />

          {error && (
            <p className="text-sm text-center" style={{ color: "#f87171" }}>
              {error}
            </p>
          )}

          <motion.button
            type="submit"
            disabled={isLoading}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3 rounded-md text-sm font-bold text-white disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg,#1565a8,#114e85)",
              boxShadow: "0 4px 16px rgba(21,101,168,0.35)",
            }}
          >
            {isLoading ? "Регистрация..." : "Зарегистрироваться"}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
}
