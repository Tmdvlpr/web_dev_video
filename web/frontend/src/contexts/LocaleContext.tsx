import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { T, format, type Locale, LOCALES } from "../i18n/translations";

const STORAGE_KEY = "corpmeet_locale";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: keyof typeof T, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readInitialLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (LOCALES as string[]).includes(v)) return v as Locale;
  } catch { /* SSR / private mode */ }
  return "ru";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  };

  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);

  const t = (key: keyof typeof T, params?: Record<string, string | number>) => {
    const entry = T[key as string];
    const raw = entry?.[locale] ?? entry?.ru ?? String(key);
    return format(raw, params);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
