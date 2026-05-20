import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        space: {
          950: "#0f172a",
          900: "#1e293b",
          800: "#263248",
          700: "#334155",
        },
        neon: {
          violet: "#6366f1",
          cyan: "#06b6d4",
          pink: "#ec4899",
        },
        surface: {
          DEFAULT: "#1e293b",
          raised: "#263248",
          border: "#334155",
        },
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
      },
      animation: {
        levitate: "levitate 3s ease-in-out infinite",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
      },
      keyframes: {
        levitate: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 8px rgba(139,92,246,0.4)" },
          "50%": { boxShadow: "0 0 20px rgba(139,92,246,0.8), 0 0 40px rgba(139,92,246,0.3)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
