"use client";

import { useTheme } from "./theme-provider";
import { IconButton } from "@mui/material";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";

export function ThemeToggle() {
  const { resolvedTheme, cycleMode } = useTheme();

  return (
    <IconButton onClick={cycleMode} aria-label="Toggle theme">
      {resolvedTheme === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
    </IconButton>
  );
}
