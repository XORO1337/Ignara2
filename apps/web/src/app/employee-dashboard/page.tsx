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
import { QuickJoinDock } from "../../components/quick-join-dock";
import { alpha } from "@mui/material/styles";
import { Container, Card, Typography, Box, Stack, Button, Alert, Chip, Grid, Divider } from "@mui/material";
import { useMediaQuery, useTheme } from "@mui/material";

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
  const theme = useTheme();
  const isSmallViewport = useMediaQuery(theme.breakpoints.down("sm"));
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
  const [mapCanvasSize, setMapCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [userGenderMap, setUserGenderMap] = useState<Record<string, UserGender>>({});
  const [disconnectPings, setDisconnectPings] = useState<DisconnectPing[]>([]);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState(0);
  const [jumpStatus, setJumpStatus] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isQuickJoinVisible, setIsQuickJoinVisible] = useState(true);
  const [isChatVisible, setIsChatVisible] = useState(true);

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
      setMapCanvasSize(null);
      return;
    }

    const parsedMap = parseMapEditorData(activeMap.jsonConfig ?? {});
    setActiveMapId(activeMap.id);
    setActiveMapName(activeMap.name);
    setMapRooms(parsedMap.rooms);
    setMapProps(parsedMap.props);
    setMapBackground(parsedMap.background);
    setMapCanvasSize(parsedMap.canvasSize ?? null);
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

  useEffect(() => {
    if (!isSmallViewport) {
      return;
    }
    if (isChatVisible && isQuickJoinVisible) {
      setIsQuickJoinVisible(false);
    }
  }, [isChatVisible, isQuickJoinVisible, isSmallViewport]);

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
      <Stack spacing={2} sx={{ minHeight: "calc(100vh - 6.5rem)" }}>
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

        {isSmallViewport ? (
          <Stack spacing={2} sx={{ flexGrow: 1 }}>
            <Card
              elevation={0}
              sx={{
                p: 1.5,
                border: 1,
                borderColor: "divider",
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                <Button
                  size="small"
                  variant={isQuickJoinVisible ? "contained" : "outlined"}
                  onClick={() => setIsQuickJoinVisible((previous) => !previous)}
                >
                  {isQuickJoinVisible ? "Hide Quick Join" : "Open Quick Join"}
                </Button>
                <Button
                  size="small"
                  variant={isChatVisible ? "contained" : "outlined"}
                  onClick={() => setIsChatVisible((previous) => !previous)}
                  disabled={!user}
                >
                  {isChatVisible ? "Hide Chat" : "Open Chat"}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                On small screens, only one panel stays open at a time.
              </Typography>
            </Card>

            {isQuickJoinVisible ? (
              <QuickJoinDock
                open={isQuickJoinVisible}
                onOpenChange={(next) => {
                  setIsQuickJoinVisible(next);
                  if (next) setIsChatVisible(false);
                }}
                socketState={socketState}
                activeMapName={activeMapName}
                employeesOnlineCount={connectedLocations.length}
                currentUserRoomId={currentUserRoomId}
                orderedRooms={orderedRooms}
                selectedRoomIndex={selectedRoomIndex}
                onSelectedRoomIndexChange={setSelectedRoomIndex}
                onJumpToRoom={(room) => void jumpToRoom(room)}
                onDisconnectSelf={() => void disconnectSelf()}
                isDisconnecting={isDisconnecting}
                jumpStatus={jumpStatus}
                canAct={Boolean(user)}
              />
            ) : null}

            {user && isChatVisible ? (
              <EmployeeCollabDock
                orgId={user.orgId}
                employeeId={user.email}
                activeRoomId={currentUserRoomId}
                locationsByEmployee={locationsRecord}
                open={isChatVisible}
                onOpenChange={(next) => {
                  setIsChatVisible(next);
                  if (next) setIsQuickJoinVisible(false);
                }}
              />
            ) : null}

            <Divider />

            <Card
              elevation={0}
              sx={{
                p: 2,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                border: 1,
                borderColor: "divider",
                minHeight: 520,
              }}
            >
              {isBootstrapping ? <Typography variant="body2" color="text.secondary">Loading map and employee presence...</Typography> : null}
              {bootstrapError ? <Alert severity="error">{bootstrapError}</Alert> : null}
              {!isBootstrapping && !bootstrapError && mapRooms.length === 0 ? (
                <Alert severity="warning">
                  No saved room zones found. Ask an admin to configure room zones in Map Editor.
                </Alert>
              ) : null}

              <Box sx={{ flexGrow: 1, position: "relative" }}>
                <LiveMap
                  rooms={mapRooms}
                  locations={visibleLocations}
                  mapProps={mapProps}
                  background={mapBackground}
                  canvasSize={mapCanvasSize}
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
          </Stack>
        ) : (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              flexGrow: 1,
              gridTemplateColumns: `${isQuickJoinVisible ? "420px" : "56px"} 1fr ${isChatVisible ? "420px" : "56px"}`,
              alignItems: "start",
            }}
          >
            <QuickJoinDock
              open={isQuickJoinVisible}
              onOpenChange={(next) => setIsQuickJoinVisible(next)}
              socketState={socketState}
              activeMapName={activeMapName}
              employeesOnlineCount={connectedLocations.length}
              currentUserRoomId={currentUserRoomId}
              orderedRooms={orderedRooms}
              selectedRoomIndex={selectedRoomIndex}
              onSelectedRoomIndexChange={setSelectedRoomIndex}
              onJumpToRoom={(room) => void jumpToRoom(room)}
              onDisconnectSelf={() => void disconnectSelf()}
              isDisconnecting={isDisconnecting}
              jumpStatus={jumpStatus}
              canAct={Boolean(user)}
            />

            <Card
              elevation={0}
              sx={{
                p: 2,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                border: 1,
                borderColor: "divider",
                minHeight: 520,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Live map view with presence tracking and navigation controls.
                </Typography>
              </Box>
              {isBootstrapping ? <Typography variant="body2" color="text.secondary">Loading map and employee presence...</Typography> : null}
              {bootstrapError ? <Alert severity="error">{bootstrapError}</Alert> : null}
              {!isBootstrapping && !bootstrapError && mapRooms.length === 0 ? (
                <Alert severity="warning">
                  No saved room zones found. Ask an admin to configure room zones in Map Editor.
                </Alert>
              ) : null}

              <Box sx={{ flexGrow: 1, position: "relative" }}>
                <LiveMap
                  rooms={mapRooms}
                  locations={visibleLocations}
                  mapProps={mapProps}
                  background={mapBackground}
                  canvasSize={mapCanvasSize}
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

            {user ? (
              <EmployeeCollabDock
                orgId={user.orgId}
                employeeId={user.email}
                activeRoomId={currentUserRoomId}
                locationsByEmployee={locationsRecord}
                open={isChatVisible}
                onOpenChange={(next) => setIsChatVisible(next)}
              />
            ) : (
              <Box />
            )}
          </Box>
        )}
      </Stack>
    </Container>
  );
}
