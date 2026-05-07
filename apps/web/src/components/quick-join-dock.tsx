"use client";

import type { RoomZone } from "@ignara/sharedtypes";
import { Alert, Box, Button, Chip, Paper, Slider, Stack, Typography } from "@mui/material";
import { DockedSidePanel } from "./docked-side-panel";

type SocketState = "disconnected" | "connecting" | "connected";

type QuickJoinDockProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  socketState: SocketState;
  activeMapName: string | null;
  employeesOnlineCount: number;
  currentUserRoomId: string | null;
  orderedRooms: RoomZone[];
  selectedRoomIndex: number;
  onSelectedRoomIndexChange: (index: number) => void;
  onJumpToRoom: (room: RoomZone) => void;
  onDisconnectSelf: () => void;
  isDisconnecting: boolean;
  jumpStatus: string | null;
  canAct: boolean;
};

export function QuickJoinDock({
  open,
  onOpenChange,
  socketState,
  activeMapName,
  employeesOnlineCount,
  currentUserRoomId,
  orderedRooms,
  selectedRoomIndex,
  onSelectedRoomIndexChange,
  onJumpToRoom,
  onDisconnectSelf,
  isDisconnecting,
  jumpStatus,
  canAct,
}: QuickJoinDockProps) {
  const selectedRoom = orderedRooms[selectedRoomIndex] ?? null;

  return (
    <DockedSidePanel
      side="left"
      open={open}
      rail={
        <Button
          variant="contained"
          size="small"
          onClick={() => onOpenChange(true)}
          aria-label="Show quick join"
          sx={{
            borderRadius: 999,
            minWidth: 44,
            minHeight: 44,
            width: 44,
            height: 44,
            p: 0,
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            boxShadow: 3,
          }}
        >
          Open Quick Join
        </Button>
      }
    >
      <Box sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: "divider" }}>
        <Stack spacing={1.25}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                Quick Join
              </Typography>
              <Typography variant="h6">Room Jump Slider</Typography>
            </Box>
            <Chip
              size="small"
              color={socketState === "connected" ? "success" : socketState === "connecting" ? "warning" : "error"}
              label={socketState}
            />
          </Box>
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="small" variant="outlined" onClick={() => onOpenChange(false)}>
              Hide Quick Join
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Active map: {activeMapName ?? "No map saved yet"}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            <Chip
              color={employeesOnlineCount > 0 ? "success" : "warning"}
              label={`Employees Online: ${employeesOnlineCount}`}
              size="small"
            />
            <Chip
              color={currentUserRoomId ? "success" : "warning"}
              label={`You: ${currentUserRoomId ? `connected (${currentUserRoomId})` : "disconnected"}`}
              size="small"
            />
          </Stack>
        </Stack>
      </Box>

      <Box
        sx={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: "auto",
          px: 2.5,
          py: 2,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {orderedRooms.length > 0 ? (
          <>
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 700, display: "block" }}>
                Room Selector
              </Typography>
              <Slider
                min={0}
                max={Math.max(0, orderedRooms.length - 1)}
                value={selectedRoomIndex}
                onChange={(_, value) => onSelectedRoomIndexChange(Number(value))}
                disabled={orderedRooms.length <= 1}
                color="primary"
              />
            </Box>

            <Paper variant="outlined" sx={{ p: 2, bgcolor: "background.default" }}>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 700, display: "block" }}>
                Selected Room
              </Typography>
              <Typography variant="h6" fontWeight={800} sx={{ mt: 1 }}>
                {selectedRoom?.label ?? "No room selected"}
              </Typography>
              {selectedRoom ? (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                  Room ID: {selectedRoom.id}
                </Typography>
              ) : null}
            </Paper>

            <Stack spacing={1}>
              <Button
                variant="contained"
                color="primary"
                onClick={() => {
                  if (!selectedRoom) return;
                  onJumpToRoom(selectedRoom);
                }}
                disabled={!selectedRoom || !canAct}
              >
                Jump To Selected Room
              </Button>

              <Button
                variant="outlined"
                color="secondary"
                onClick={onDisconnectSelf}
                disabled={!currentUserRoomId || isDisconnecting}
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect Me"}
              </Button>
            </Stack>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {orderedRooms.map((room, index) => {
                const active = selectedRoom?.id === room.id;
                return (
                  <Paper
                    key={room.id}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      bgcolor: active ? "primary.main" : "background.paper",
                      color: active ? "primary.contrastText" : "text.primary",
                      borderColor: active ? "primary.main" : "divider",
                      "&:hover": { bgcolor: active ? "primary.dark" : "action.hover" },
                    }}
                    onClick={() => onSelectedRoomIndexChange(index)}
                  >
                    <Typography variant="body2" fontWeight={800}>
                      {room.label}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.8, display: "block" }}>
                      {room.id}
                    </Typography>
                  </Paper>
                );
              })}
            </Box>
          </>
        ) : (
          <Alert severity="info" variant="outlined">
            No rooms available yet. Ask an admin to save room zones in Map Editor.
          </Alert>
        )}

        {jumpStatus ? (
          <Typography variant="caption" color="text.secondary">
            {jumpStatus}
          </Typography>
        ) : null}
      </Box>
    </DockedSidePanel>
  );
}

