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

  const toggle = (origin?: { x: number; y: number }) => {
    const html = document.documentElement;
    const newTheme = theme === "light" ? "dark" : "light";

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    html.style.setProperty("--ripple-x", `${x}px`);
    html.style.setProperty("--ripple-y", `${y}px`);

    const applyTheme = () => {
      html.setAttribute("data-theme", newTheme);
      localStorage.setItem("meetaholic_theme", newTheme);
      setTheme(newTheme);
    };

    if (!("startViewTransition" in document)) {
      html.classList.add("theme-transitioning");
      applyTheme();
      setTimeout(() => html.classList.remove("theme-transitioning"), 300);
      return;
    }

    (document as Document & { startViewTransition: (cb: () => void) => void })
      .startViewTransition(applyTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === "dark", toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
