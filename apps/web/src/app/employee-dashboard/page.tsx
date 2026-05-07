"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { EmployeePresenceEvent, LastKnownLocation, RoomZone, UserGender } from "@ignara/sharedtypes";
import type { Socket } from "socket.io-client";
import { apiRequest } from "../../lib/api";
import { parseMapEditorData, pickActiveMap, type MapBackgroundConfig, type MapPropElement } from "../../lib/map-config";
import { createLocationSocket } from "../../lib/socket";
import { useAuthStore, type SessionUser } from "../../store/auth-store";
import { useLocationStore } from "../../store/location-store";
import { useToastStore } from "../../store/toast-store";
import { EmployeeCollabDock } from "../../components/employee-collab-dock";
import { alpha } from "@mui/material/styles";
import { Container, Card, Typography, Box, Stack, Button, Slider, Paper, Alert, Chip, Grid } from "@mui/material";

const LiveMap = dynamic(
  () => import("../../components/live-map").then((module) => module.LiveMap),
  { ssr: false },
);

type PersistedMap = { id: string; orgId: string; name: string; jsonConfig?: Record<string, unknown> | null };
type OrgUser = {
  id: string;
  orgId: string;
  email: string;
  role: "admin" | "manager" | "employee";
  gender?: UserGender;
};

type DisconnectPing = {
  employeeId: string;
  roomId: string;
  x?: number;
  y?: number;
  startedAt: number;
};

const DISCONNECT_PING_DURATION_MS = 900;

export default function EmployeeDashboardPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const locationsRecord = useLocationStore((state) => state.locations);
  const setLocations = useLocationStore((state) => state.setLocations);
  const upsertLocation = useLocationStore((state) => state.upsertLocation);
  const addToast = useToastStore((state) => state.addToast);

  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<"disconnected" | "connecting" | "connected">("disconnected");

  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [activeMapName, setActiveMapName] = useState<string | null>(null);
  const [mapRooms, setMapRooms] = useState<RoomZone[]>([]);
  const [mapProps, setMapProps] = useState<MapPropElement[]>([]);
  const [mapBackground, setMapBackground] = useState<MapBackgroundConfig | null>(null);
  const [userGenderMap, setUserGenderMap] = useState<Record<string, UserGender>>({});
  const [disconnectPings, setDisconnectPings] = useState<DisconnectPing[]>([]);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState(0);
  const [jumpStatus, setJumpStatus] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const spawnedPlayerRef = useRef<Record<string, boolean>>({});
  const employeeEmailSetRef = useRef<Set<string>>(new Set());

  function hydrateMapFromList(maps: PersistedMap[]) {
    const activeMap = pickActiveMap(maps);
    if (!activeMap) {
      setActiveMapId(null);
      setActiveMapName(null);
      setMapRooms([]);
      setMapProps([]);
      setMapBackground(null);
      return;
    }

    const parsedMap = parseMapEditorData(activeMap.jsonConfig ?? {});
    setActiveMapId(activeMap.id);
    setActiveMapName(activeMap.name);
    setMapRooms(parsedMap.rooms);
    setMapProps(parsedMap.props);
    setMapBackground(parsedMap.background);
  }

  useEffect(() => {
    if (!user) {
      return;
    }

    if (user.role !== "employee") {
      router.replace("/dashboard");
    }
  }, [router, user]);

  useEffect(() => {
    let active = true;
    let orgId = "";
    let locationSocket: Socket | null = null;

    const bootstrap = async () => {
      try {
        let sessionUser = user;

        if (!sessionUser) {
          const me = await apiRequest<{ user: SessionUser }>("/auth/me");
          sessionUser = me.user;
          if (active) {
            setUser(sessionUser);
          }
        }

        if (!sessionUser) {
          throw new Error("Missing session");
        }

        if (sessionUser.role !== "employee") {
          router.replace("/dashboard");
          return;
        }

        orgId = sessionUser.orgId;
        const viewerEmployeeId = sessionUser.email;

        const [current, maps, users] = await Promise.all([
          apiRequest<LastKnownLocation[]>("/locations/current"),
          apiRequest<PersistedMap[]>("/maps"),
          apiRequest<OrgUser[]>("/users"),
        ]);

        const employeeEmails = new Set(users.filter((entry) => entry.role === "employee").map((entry) => entry.email));

        if (active) {
          employeeEmailSetRef.current = employeeEmails;
          setLocations(current.filter((location) => employeeEmails.has(location.employeeId)));
          setDisconnectPings([]);
          hydrateMapFromList(maps);
          setUserGenderMap(
            users.reduce<Record<string, UserGender>>((acc, entry) => {
              if (entry.role === "employee") {
                acc[entry.email] = entry.gender ?? "other";
              }
              return acc;
            }, {}),
          );
          setBootstrapError(null);

          setSocketState("connecting");
          const socket = await createLocationSocket();
          if (!active) {
            socket.disconnect();
            return;
          }

          locationSocket = socket;
          socket.on("connect", () => {
            socket.emit("join", { room: `org:${orgId}:locations` });
          });
          socket.on("joined", (room: string) => {
            if (room === `org:${orgId}:locations`) {
              setSocketState("connected");
            }
          });
          socket.on("disconnect", () => {
            setSocketState("disconnected");
          });
          socket.on("location:update", (location: LastKnownLocation) => {
            if (!employeeEmailSetRef.current.has(location.employeeId)) {
              return;
            }

            if (location.connected) {
              setDisconnectPings((prev) => prev.filter((ping) => ping.employeeId !== location.employeeId));
              upsertLocation(location);
              return;
            }

            upsertLocation(location);
            setDisconnectPings((prev) => {
              const nextPing: DisconnectPing = {
                employeeId: location.employeeId,
                roomId: location.roomId,
                x: location.x,
                y: location.y,
                startedAt: Date.now(),
              };

              return [...prev.filter((ping) => ping.employeeId !== location.employeeId), nextPing];
            });
          });
          socket.on("presence:joined", (presence: EmployeePresenceEvent) => {
            if (!employeeEmailSetRef.current.has(presence.employeeId)) {
              return;
            }

            if (presence.employeeId === viewerEmployeeId) {
              return;
            }

            addToast({
              message: `${presence.employeeId} joined ${presence.roomId}`,
              tone: "success",
            });
          });
          socket.on("presence:left", (presence: EmployeePresenceEvent) => {
            if (!employeeEmailSetRef.current.has(presence.employeeId)) {
              return;
            }

            if (presence.employeeId === viewerEmployeeId) {
              return;
            }

            addToast({
              message: `${presence.employeeId} left ${presence.roomId}`,
              tone: "warning",
            });
          });
          socket.connect();
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : "Unknown error";
          setBootstrapError(`Could not load employee dashboard data. ${message}`);
          setSocketState("disconnected");
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
      if (locationSocket) {
        locationSocket.off("connect");
        locationSocket.off("joined");
        locationSocket.off("disconnect");
        locationSocket.off("location:update");
        locationSocket.off("presence:joined");
        locationSocket.off("presence:left");
        locationSocket.disconnect();
      }
    };
  }, [addToast, router, setLocations, setUser, upsertLocation, user]);

  useEffect(() => {
    if (disconnectPings.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      const now = Date.now();
      setDisconnectPings((previous) =>
        previous.filter((ping) => now - ping.startedAt < DISCONNECT_PING_DURATION_MS),
      );
    }, 200);

    return () => {
      window.clearInterval(interval);
    };
  }, [disconnectPings.length]);

  useEffect(() => {
    if (!user || user.role !== "employee" || mapRooms.length === 0) {
      return;
    }

    if (locationsRecord[user.email] || spawnedPlayerRef.current[user.email]) {
      return;
    }

    const defaultRoom = mapRooms[0];
    if (!defaultRoom) {
      return;
    }

    spawnedPlayerRef.current[user.email] = true;
    const defaultX = Math.round(defaultRoom.x + defaultRoom.w / 2);
    const defaultY = Math.round(defaultRoom.y + defaultRoom.h / 2);

    void apiRequest<LastKnownLocation>("/locations/move", {
      method: "POST",
      body: JSON.stringify({
        roomId: defaultRoom.id,
        x: defaultX,
        y: defaultY,
      }),
    })
      .then((location) => upsertLocation(location))
      .catch(() => {
        spawnedPlayerRef.current[user.email] = false;
      });
  }, [locationsRecord, mapRooms, upsertLocation, user]);

  const moveCurrentPlayer = useCallback(async (payload: { roomId?: string; x: number; y: number }) => {
    try {
      const updated = await apiRequest<LastKnownLocation>("/locations/move", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      upsertLocation(updated);
    } catch {
      // Keep local movement smooth even when transient API calls fail.
    }
  }, [upsertLocation]);

  const allLocations = useMemo(() => Object.values(locationsRecord), [locationsRecord]);
  const visibleLocations = useMemo(
    () => allLocations.filter((location) => employeeEmailSetRef.current.has(location.employeeId)),
    [allLocations],
  );
  const connectedLocations = useMemo(
    () => visibleLocations.filter((location) => location.connected),
    [visibleLocations],
  );

  const orderedRooms = useMemo(
    () => [...mapRooms].sort((left, right) => left.label.localeCompare(right.label)),
    [mapRooms],
  );

  useEffect(() => {
    if (orderedRooms.length === 0) {
      setSelectedRoomIndex(0);
      return;
    }

    setSelectedRoomIndex((previous) => Math.min(previous, orderedRooms.length - 1));
  }, [orderedRooms.length]);

  const selectedRoom = orderedRooms[selectedRoomIndex] ?? null;
  const currentUserRoomId = useMemo(() => {
    if (!user || user.role !== "employee") {
      return null;
    }

    const current = locationsRecord[user.email];
    if (!current?.connected) {
      return null;
    }

    return current.roomId ?? null;
  }, [locationsRecord, user]);

  const jumpToRoom = useCallback(async (room: RoomZone) => {
    const targetX = Math.round(room.x + room.w / 2);
    const targetY = Math.round(room.y + room.h / 2);

    await moveCurrentPlayer({
      roomId: room.id,
      x: targetX,
      y: targetY,
    });

    setJumpStatus(`Joined ${room.label}.`);
  }, [moveCurrentPlayer]);

  const disconnectSelf = useCallback(async () => {
    try {
      setIsDisconnecting(true);
      const updated = await apiRequest<LastKnownLocation>("/locations/disconnect/self", {
        method: "POST",
        body: JSON.stringify({}),
      });
      upsertLocation(updated);
      setJumpStatus("You are disconnected. Use room jump to reconnect when ready.");
    } catch {
      setJumpStatus("Could not disconnect right now. Please try again.");
    } finally {
      setIsDisconnecting(false);
    }
  }, [upsertLocation]);

  if (user && user.role !== "employee") {
    return (
      <Container maxWidth={false}>
        <Card sx={{ p: 4 }}>
          <Typography variant="body2" color="text.secondary">Redirecting to the manager dashboard...</Typography>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth={false} sx={{ px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 } }}>
      {user ? (
        <EmployeeCollabDock
          orgId={user.orgId}
          employeeId={user.email}
          activeRoomId={currentUserRoomId}
          locationsByEmployee={locationsRecord}
        />
      ) : null}

      <Stack spacing={2} sx={{ minHeight: 'calc(100vh - 6.5rem)' }}>
        <Card
          elevation={0}
          sx={(theme) => ({
            p: { xs: 2.5, md: 3 },
            backgroundImage: `linear-gradient(140deg, ${alpha(theme.palette.primary.main, 0.18)}, transparent 55%),
              linear-gradient(220deg, ${alpha(theme.palette.secondary.main, 0.16)}, transparent 60%)`,
          })}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                Employee Dashboard
              </Typography>
              <Typography variant="h4" sx={{ mt: 1 }}>Live Office Map</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Active map: {activeMapName ?? "No map saved yet"}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip
                color={socketState === "connected" ? "success" : socketState === "connecting" ? "warning" : "error"}
                label={`Socket: ${socketState}`}
                size="small"
              />
              <Chip
                color={currentUserRoomId ? "success" : "warning"}
                label={currentUserRoomId ? `Room: ${currentUserRoomId}` : "Room: disconnected"}
                size="small"
              />
            </Stack>
          </Box>
        </Card>

        <Grid container spacing={2} sx={{ flexGrow: 1 }}>
        <Grid item xs={12} xl={8} sx={{ flexGrow: 1 }}>
          <Card elevation={0} sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 2, border: 1, borderColor: 'divider' }}>
            {isBootstrapping ? <Typography variant="body2" color="text.secondary">Loading map and employee presence...</Typography> : null}
            {bootstrapError ? <Alert severity="error">{bootstrapError}</Alert> : null}
            {!isBootstrapping && !bootstrapError && mapRooms.length === 0 ? (
              <Alert severity="warning">
                No saved room zones found. Ask an admin to configure room zones in Map Editor.
              </Alert>
            ) : null}

            <Box sx={{ flexGrow: 1, position: 'relative' }}>
              <LiveMap
                rooms={mapRooms}
                locations={visibleLocations}
                mapProps={mapProps}
                background={mapBackground}
                interactive
                mapStorageKey={activeMapId && user ? `${user.orgId}:${activeMapId}:employee:${user.email}` : null}
                currentPlayerId={user?.email ?? null}
                genderByEmployee={userGenderMap}
                onMovePlayer={user ? moveCurrentPlayer : undefined}
                disconnectPings={disconnectPings}
                autoFollowPlayer
              />
            </Box>
          </Card>
        </Grid>

        <Grid item xs={12} xl={4} sx={{ width: { xl: 340 } }}>
          <Card elevation={0} sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, border: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip
                color={socketState === "connected" ? "success" : socketState === "connecting" ? "warning" : "error"}
                label={`Socket: ${socketState}`}
                size="small"
              />
              <Chip
                color={connectedLocations.length > 0 ? "success" : "warning"}
                label={`Employees Online: ${connectedLocations.length}`}
                size="small"
              />
              <Chip
                color={currentUserRoomId ? "success" : "warning"}
                label={`You: ${currentUserRoomId ? `connected (${currentUserRoomId})` : "disconnected"}`}
                size="small"
              />
            </Box>

            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>
                Quick Join
              </Typography>
              <Typography variant="h6" fontWeight="bold" sx={{ mt: 1 }}>
                Room Jump Slider
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Active map: {activeMapName ?? "No map saved yet"}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Use the slider to jump directly to a room for faster meeting joins.
              </Typography>
            </Box>

            {orderedRooms.length > 0 ? (
              <>
                <Box>
                  <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold', display: 'block' }}>
                    Room Selector
                  </Typography>
                  <Slider
                    min={0}
                    max={Math.max(0, orderedRooms.length - 1)}
                    value={selectedRoomIndex}
                    onChange={(_, value) => setSelectedRoomIndex(Number(value))}
                    disabled={orderedRooms.length <= 1}
                    color="primary"
                  />
                </Box>

                <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                  <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold', display: 'block' }}>
                    Selected Room
                  </Typography>
                  <Typography variant="h6" fontWeight="bold" sx={{ mt: 1 }}>
                    {selectedRoom?.label ?? "No room selected"}
                  </Typography>
                  {selectedRoom ? <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>Room ID: {selectedRoom.id}</Typography> : null}
                </Paper>

                <Stack spacing={1}>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => {
                      if (!selectedRoom) return;
                      void jumpToRoom(selectedRoom);
                    }}
                    disabled={!selectedRoom || !user}
                  >
                    Jump To Selected Room
                  </Button>

                  <Button
                    variant="outlined"
                    color="secondary"
                    onClick={() => void disconnectSelf()}
                    disabled={!currentUserRoomId || isDisconnecting}
                  >
                    {isDisconnecting ? "Disconnecting..." : "Disconnect Me"}
                  </Button>
                </Stack>

                <Box sx={{ maxHeight: '42vh', overflow: 'auto', pr: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {orderedRooms.map((room, index) => {
                    const active = selectedRoom?.id === room.id;

                    return (
                      <Paper
                        key={room.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          bgcolor: active ? 'primary.main' : 'background.paper',
                          color: active ? 'primary.contrastText' : 'text.primary',
                          borderColor: active ? 'primary.main' : 'divider',
                          '&:hover': { bgcolor: active ? 'primary.dark' : 'action.hover' }
                        }}
                        onClick={() => setSelectedRoomIndex(index)}
                      >
                        <Typography variant="body2" fontWeight="bold">
                          {room.label}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.8, display: 'block' }}>
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

            {jumpStatus ? <Typography variant="caption" color="text.secondary">{jumpStatus}</Typography> : null}
          </Card>
        </Grid>
        </Grid>
      </Stack>
    </Container>
  );
}
