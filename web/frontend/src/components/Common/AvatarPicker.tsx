import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi } from "../../api/users";
import { useTheme } from "../../contexts/ThemeContext";
import type { User } from "../../types";

const AVATAR_OPTIONS = [
  "/avatars/free-icon-angry-17849457.png",
  "/avatars/free-icon-confused-mind-17849496.png",
  "/avatars/free-icon-evil-17849470.png",
  "/avatars/free-icon-freeze-17849460.png",
  "/avatars/free-icon-joyful-17849480.png",
  "/avatars/free-icon-meme-17849485.png",
  "/avatars/free-icon-meme-17849488.png",
  "/avatars/free-icon-mind-blowing-17849471.png",
  "/avatars/free-icon-proud-17849494.png",
  "/avatars/free-icon-thoughtful-emoji-17849509.png",
];

interface Props {
  user: User;
  onClose: () => void;
}

export function AvatarPicker({ user, onClose }: Props) {
  const { isDark } = useTheme();
  const qc = useQueryClient();
  const [lightbox, setLightbox] = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: (avatar: string | null) => usersApi.setAvatar(avatar),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="absolute right-0 top-full mt-2 z-50 rounded-md p-4"
        style={{
          width: 224,
          background: isDark ? "#1e1b2e" : "#fff",
          border: `1px solid ${isDark ? "rgba(21,101,168,0.25)" : "#e5e7eb"}`,
          boxShadow: isDark ? "0 16px 48px rgba(0,0,0,0.7)" : "0 8px 32px rgba(15,23,42,0.15)",
        }}
      >
        {/* Current avatar preview */}
        <div className="flex flex-col items-center gap-2 mb-4">
          <div
            className={`transition-transform hover:scale-105 ${user.avatar ? "cursor-zoom-in" : ""}`}
            onClick={() => user.avatar && setLightbox(true)}
          >
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.display_name}
                className="rounded-full object-cover"
                style={{ width: 72, height: 72, border: "3px solid var(--primary)" }}
              />
            ) : (
              <div
                className="rounded-full flex items-center justify-center text-white font-bold"
                style={{ width: 72, height: 72, background: "var(--primary)", fontSize: 28 }}
              >
                {user.display_name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
          <p className="text-xs font-semibold truncate max-w-full" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
            {user.display_name}
          </p>
        </div>

        {/* Avatar grid */}
        <div className="grid grid-cols-5 gap-2 mb-3">
          {AVATAR_OPTIONS.map(src => (
            <button
              key={src}
              onClick={() => { mutate(src); onClose(); }}
              disabled={isPending}
              className="rounded-full overflow-hidden transition-all hover:scale-110 focus:outline-none"
              style={{
                width: 40, height: 40,
                border: user.avatar === src ? "2px solid var(--primary)" : "2px solid transparent",
                boxShadow: user.avatar === src ? "0 0 0 2px var(--primary)" : undefined,
              }}
            >
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>

        {user.avatar && (
          <button
            onClick={() => { mutate(null); onClose(); }}
            disabled={isPending}
            className="w-full text-xs py-1.5 rounded transition-all"
            style={{
              background: isDark ? "rgba(255,255,255,0.06)" : "#f1f5f9",
              color: isDark ? "#94a3b8" : "#64748b",
            }}
          >
            Удалить аватар
          </button>
        )}
      </motion.div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && user.avatar && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(false)}
            className="fixed inset-0 z-[200] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
          >
            <motion.img
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
              src={user.avatar}
              alt={user.display_name}
              className="rounded-md object-contain shadow-2xl"
              style={{ maxWidth: "min(90vw, 480px)", maxHeight: "min(90vh, 480px)" }}
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
