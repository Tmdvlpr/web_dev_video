import { createContext, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggle: (origin?: { x: number; y: number }) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  isDark: false,
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("meetaholic_theme") as Theme | null;
    return stored ?? "dark";
  });

  // Tracks the latest transition so rapid clicks don't animate stale pseudo-elements
  const vtTokenRef = useRef<object | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("meetaholic_theme", theme);
  }, [theme]);

  const toggle = async (origin?: { x: number; y: number }) => {
    const html = document.documentElement;
    const newTheme = theme === "light" ? "dark" : "light";

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;

    html.style.setProperty("--wx", `${x}px`);
    html.style.setProperty("--wy", `${y}px`);

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const applyTheme = () => {
      // flushSync forces React to re-render synchronously so inline styles
      // based on isDark are captured correctly in the "after" VT snapshot
      html.setAttribute("data-theme", newTheme);
      localStorage.setItem("meetaholic_theme", newTheme);
      flushSync(() => setTheme(newTheme));
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!("startViewTransition" in document) || reduce) {
      html.classList.add("theme-transitioning");
      applyTheme();
      setTimeout(() => html.classList.remove("theme-transitioning"), 300);
      return;
    }

    const vt = (document as Document & {
      startViewTransition: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
    }).startViewTransition(applyTheme);

    // Token lets us detect if a newer transition superseded this one
    const token = {};
    vtTokenRef.current = token;

    // Suppress all CSS transitions while VT is animating to prevent post-VT color lag
    html.classList.add("vt-running");
    vt.finished.finally(() => html.classList.remove("vt-running"));

    try {
      await vt.ready;
    } catch {
      return;
    }

    if (vtTokenRef.current !== token) return;

    html.animate(
      { "--wave": ["0px", `${endRadius + 280}px`] } as unknown as PropertyIndexedKeyframes,
      {
        duration: 880,
        easing: "cubic-bezier(0.65, 0, 0.35, 1)",
        fill: "forwards",
        pseudoElement: "::view-transition-new(root)",
      }
    );
  };

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === "dark", toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
