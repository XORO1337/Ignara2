"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
};

const STORAGE_KEY = "ignara-theme-mode";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      setMode(stored);
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const nextResolvedTheme = mode === "system" ? getSystemTheme() : mode;
      document.documentElement.dataset.theme = nextResolvedTheme;
      document.documentElement.style.colorScheme = nextResolvedTheme;
      setResolvedTheme(nextResolvedTheme);
    };

    const handleMediaChange = () => {
      if (mode === "system") {
        applyTheme();
      }
    };

    applyTheme();
    mediaQuery.addEventListener("change", handleMediaChange);
    window.localStorage.setItem(STORAGE_KEY, mode);

    return () => {
      mediaQuery.removeEventListener("change", handleMediaChange);
    };
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      setMode,
      cycleMode: () => {
        setMode((current) => {
          if (current === "system") {
            return "light";
          }
          if (current === "light") {
            return "dark";
          }
          return "system";
        });
      },
    }),
    [mode, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
