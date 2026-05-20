import { motion } from "framer-motion";

export default function LoadingSpinner() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--bg)" }}
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-10 h-10 rounded-full border-2"
        style={{
          borderColor: "var(--primary)",
          borderTopColor: "transparent",
        }}
      />
    </div>
  );
}
