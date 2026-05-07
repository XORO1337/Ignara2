"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v14-appRouter";
import { lightTheme, darkTheme } from "../theme";

type ThemeMode = "light" | "dark";
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
  const [mode, setMode] = useState<ThemeMode>("light");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      setMode(stored);
    } else {
      setMode(getSystemTheme());
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setResolvedTheme(mode);
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode, mounted]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [mounted, resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      setMode,
      cycleMode: () => {
        setMode((current) => (current === "light" ? "dark" : "light"));
      },
    }),
    [mode, resolvedTheme],
  );

  const muiTheme = resolvedTheme === "light" ? lightTheme : darkTheme;

  if (!mounted) {
    return (
      <ThemeContext.Provider value={value}>
        <MuiThemeProvider theme={lightTheme}>
          {children}
        </MuiThemeProvider>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={value}>
      <AppRouterCacheProvider options={{ enableCssLayer: true }}>
        <MuiThemeProvider theme={muiTheme}>
          <CssBaseline />
          {children}
        </MuiThemeProvider>
      </AppRouterCacheProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
