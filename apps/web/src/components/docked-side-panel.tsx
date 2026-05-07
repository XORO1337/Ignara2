"use client";

import type { ReactNode } from "react";
import { Box, Paper } from "@mui/material";

type DockedSidePanelProps = {
  side: "left" | "right";
  open: boolean;
  rail: ReactNode;
  children: ReactNode;
  railWidth?: number;
  panelWidth?: number | { xs?: number | string; md?: number | string };
  topOffset?: number;
  bottomOffset?: number;
};

export function DockedSidePanel({
  side,
  open,
  rail,
  children,
  railWidth = 56,
  panelWidth = { xs: "100%", md: 420 },
  topOffset = 24,
  bottomOffset = 24,
}: DockedSidePanelProps) {
  return (
    <Box
      sx={{
        width: open ? panelWidth : railWidth,
        minWidth: open ? panelWidth : railWidth,
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {!open ? (
        <Box
          sx={{
            width: railWidth,
            position: "sticky",
            top: topOffset,
            height: `calc(100vh - ${topOffset + bottomOffset}px)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            alignSelf: side === "left" ? "flex-start" : "flex-end",
          }}
        >
          {rail}
        </Box>
      ) : (
        <Paper
          elevation={0}
          sx={{
            position: "sticky",
            top: topOffset,
            height: `calc(100vh - ${topOffset + bottomOffset}px)`,
            border: 1,
            borderColor: "divider",
            borderRadius: 2,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </Paper>
      )}
    </Box>
  );
}

