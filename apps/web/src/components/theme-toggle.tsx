"use client";

import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { mode, cycleMode } = useTheme();

  return (
    <button
      type="button"
      onClick={cycleMode}
      className="inline-flex items-center rounded-full border border-outline bg-panel px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-panel-strong"
      title="Toggle theme mode"
    >
      {mode === "dark" ? "Dark" : "Light"}
    </button>
  );
}
