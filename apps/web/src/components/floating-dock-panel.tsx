"use client";

import type { ReactNode } from "react";
import { alpha } from "@mui/material/styles";
import { Box, Paper } from "@mui/material";

type FloatingDockPanelProps = {
  side: "left" | "right";
  open: boolean;
  top?: number;
  margin?: number;
  zIndex?: number;
  width?: { xs: string | number; md?: string | number };
  minWidth?: { xs?: string | number; md?: string | number };
  minHeight?: number | { xs?: number; md?: number };
  collapsedSlot?: ReactNode;
  children: ReactNode;
};

export function FloatingDockPanel({
  side,
  open,
  top = 96,
  margin = 16,
  zIndex = 1300,
  width = { xs: `min(calc(100vw - ${margin * 2}px), 420px)`, md: 420 },
  minWidth,
  minHeight = 500,
  collapsedSlot,
  children,
}: FloatingDockPanelProps) {
  const hiddenTranslate = side === "left" ? `translateX(calc(-100% - 1.5rem))` : `translateX(calc(100% + 1.5rem))`;
  const resolvedMinHeight =
    typeof minHeight === "number" ? minHeight : { xs: minHeight.xs, md: minHeight.md };

  return (
    <Box
      sx={{
        position: "fixed",
        top,
        bottom: margin,
        left: side === "left" ? margin : undefined,
        right: side === "right" ? margin : undefined,
        zIndex,
        pointerEvents: "none",
        maxHeight: `calc(100vh - ${top + margin}px)`,
        display: "flex",
        flexDirection: "column",
        alignItems: side === "left" ? "flex-start" : "flex-end",
      }}
    >
      {!open ? <Box sx={{ pointerEvents: "auto" }}>{collapsedSlot}</Box> : null}
      <Paper
        elevation={0}
        sx={(theme) => ({
          pointerEvents: open ? "auto" : "none",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          maxHeight: "100%",
          minHeight: resolvedMinHeight,
          width,
          minWidth,
          borderRadius: "8px",
          boxShadow: "0 8px 24px rgba(15,23,42,0.22)",
          overflow: "hidden",
          opacity: open ? 1 : 0,
          transform: open ? "translateX(0)" : hiddenTranslate,
          visibility: open ? "visible" : "hidden",
          transition: "transform 300ms ease, opacity 300ms ease, visibility 300ms ease",
          backgroundImage: `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 0.95)}, ${alpha(
            theme.palette.background.paper,
            0.9,
          )})`,
        })}
      >
        {children}
      </Paper>
    </Box>
  );
}

