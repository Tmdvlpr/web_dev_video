import { createContext, useContext, useEffect, useState } from "react";

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
    if (stored) return stored;
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("meetaholic_theme", theme);
  }, [theme]);

  const toggle = async (origin?: { x: number; y: number }) => {
    const html = document.documentElement;
    const newTheme = theme === "light" ? "dark" : "light";

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    html.style.setProperty("--ripple-x", `${x}px`);
    html.style.setProperty("--ripple-y", `${y}px`);

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const applyTheme = () => {
      html.setAttribute("data-theme", newTheme);
      localStorage.setItem("meetaholic_theme", newTheme);
      setTheme(newTheme);
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!("startViewTransition" in document) || reduce) {
      html.classList.add("theme-transitioning");
      applyTheme();
      setTimeout(() => html.classList.remove("theme-transitioning"), 300);
      return;
    }

    const vt = (document as Document & {
      startViewTransition: (cb: () => void) => { ready: Promise<void> };
    }).startViewTransition(applyTheme);

    await vt.ready;

    html.animate(
      { "--wave": ["0px", `${endRadius + 220}px`] } as unknown as PropertyIndexedKeyframes,
      {
        duration: 850,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
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
