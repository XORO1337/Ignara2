"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { EmployeePresenceEvent, LastKnownLocation, RoomZone, TagDeviceSummary, UserGender } from "@ignara/sharedtypes";
import type { Socket } from "socket.io-client";
import { apiRequest } from "../../lib/api";
import { parseMapEditorData, pickActiveMap, type MapBackgroundConfig, type MapPropElement } from "../../lib/map-config";
import { createLocationSocket } from "../../lib/socket";
import { useAuthStore, type SessionUser } from "../../store/auth-store";
import { useLocationStore } from "../../store/location-store";
import { useToastStore } from "../../store/toast-store";
import { alpha } from "@mui/material/styles";
import { Container, Card, Typography, Box, Stack, Button, TextField, Chip, Grid, Paper, Alert } from "@mui/material";

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
  tagDeviceId?: string | null;
  status?: string;
  restrictions?: Record<string, boolean>;
};

type DisconnectPing = {
  employeeId: string;
  roomId: string;
  x?: number;
  y?: number;
  startedAt: number;
};

const DISCONNECT_PING_DURATION_MS = 900;

export default function DashboardPage() {
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
  const [mapCanvasSize, setMapCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [userGenderMap, setUserGenderMap] = useState<Record<string, UserGender>>({});
  const [disconnectPings, setDisconnectPings] = useState<DisconnectPing[]>([]);
  const spawnedPlayerRef = useRef<Record<string, boolean>>({});
  const employeeEmailSetRef = useRef<Set<string>>(new Set());

  const [tags, setTags] = useState<TagDeviceSummary[]>([]);
  const [tagStatus, setTagStatus] = useState<string | null>(null);

  const [newTagDeviceId, setNewTagDeviceId] = useState("");
  const [newTagRoomId, setNewTagRoomId] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isRefreshingTags, setIsRefreshingTags] = useState(false);
  const [disconnectingEmployeeId, setDisconnectingEmployeeId] = useState<string | null>(null);
  const [presenceActionStatus, setPresenceActionStatus] = useState<string | null>(null);

  const roomLabelById = useMemo(
    () => new Map(mapRooms.map((room) => [room.id, room.label])),
    [mapRooms],
  );

  function formatRoomLabel(roomId?: string | null) {
    if (!roomId) {
      return "unassigned";
    }

    return roomLabelById.get(roomId) ?? roomId;
  }

  const locations = Object.values(locationsRecord).filter((location) => employeeEmailSetRef.current.has(location.employeeId));
  const connectedLocations = locations.filter((location) => location.connected);
  const disconnectedLocations = locations.filter((location) => !location.connected);
  const activeRoomCount = new Set(connectedLocations.map((location) => location.roomId)).size;
  const unmappedConnectedCount = connectedLocations.filter((location) => !mapRooms.some((room) => room.id === location.roomId)).length;

  const canManageLiveMap = user?.role === "employee";
  const canManageTags = user?.role === "admin" || user?.role === "manager";

  function initializeTagForms(tagDevices: TagDeviceSummary[]) {
    setTags(tagDevices);
  }

  async function loadTags() {
    const tagDevices = await apiRequest<TagDeviceSummary[]>("/devices/tags");
    initializeTagForms(tagDevices);
  }

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

    if (user.role === "employee") {
      router.replace("/employee-dashboard");
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

        if (sessionUser.role === "employee") {
          router.replace("/employee-dashboard");
          return;
        }

        orgId = sessionUser.orgId;
        const viewerEmployeeId = sessionUser.email;
        const managerView = sessionUser.role === "admin" || sessionUser.role === "manager";

        const [current, tagDevices, maps, users] = await Promise.all([
          apiRequest<LastKnownLocation[]>("/locations/current"),
          managerView ? apiRequest<TagDeviceSummary[]>("/devices/tags") : Promise.resolve([]),
          apiRequest<PersistedMap[]>("/maps"),
          apiRequest<OrgUser[]>("/users"),
        ]);

        const employeeEmails = new Set(users.filter((entry) => entry.role === "employee").map((entry) => entry.email));

        if (active) {
          employeeEmailSetRef.current = employeeEmails;
          setLocations(current.filter((location) => employeeEmails.has(location.employeeId)));
          setDisconnectPings([]);
          initializeTagForms(tagDevices);
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
          setBootstrapError(`Could not load dashboard data. ${message}`);
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

  async function registerTag() {
    if (!newTagDeviceId.trim()) {
      setTagStatus("Device ID is required to register a tag.");
      return;
    }

    try {
      setIsAddingTag(true);
      const created = await apiRequest<TagDeviceSummary>("/devices/tags", {
        method: "POST",
        body: JSON.stringify({
          deviceId: newTagDeviceId.trim(),
          roomId: newTagRoomId.trim() || undefined,
        }),
      });

      setTags((prev) => [...prev, created].sort((a, b) => a.id.localeCompare(b.id)));
      setNewTagDeviceId("");
      setNewTagRoomId("");
      setTagStatus(`Registered ${created.id}.`);
    } catch {
      setTagStatus("Failed to register tag. Ensure deviceId is unique and you are logged in as manager/admin.");
    } finally {
      setIsAddingTag(false);
    }
  }

  async function refreshTags() {
    try {
      setIsRefreshingTags(true);
      await loadTags();
      setTagStatus("Tag list refreshed.");
    } catch {
      setTagStatus("Could not refresh tags from API.");
    } finally {
      setIsRefreshingTags(false);
    }
  }

  async function disconnectEmployeeAsManager(employeeId: string) {
    const trimmed = employeeId.trim();
    if (!trimmed) {
      return;
    }

    try {
      setDisconnectingEmployeeId(trimmed);
      const updated = await apiRequest<LastKnownLocation>(`/locations/disconnect/${encodeURIComponent(trimmed)}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      upsertLocation(updated);
      setPresenceActionStatus(`Disconnected ${trimmed}.`);
    } catch {
      setPresenceActionStatus(`Could not disconnect ${trimmed}.`);
    } finally {
      setDisconnectingEmployeeId(null);
    }
  }

  if (user && user.role === "employee") {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Card sx={{ p: 4, borderRadius: 3, mb: 2 }}>
          <Typography variant="body2" color="text.secondary">Redirecting to the employee dashboard...</Typography>
        </Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 } }}>
      <Stack spacing={4}>
        <Card
          elevation={0}
          sx={(theme) => ({
            p: { xs: 2.5, md: 3.5 },
            borderRadius: 4,
            mb: 2,
            backgroundImage: `linear-gradient(140deg, ${alpha(theme.palette.primary.main, 0.18)}, transparent 55%),
              linear-gradient(220deg, ${alpha(theme.palette.secondary.main, 0.14)}, transparent 60%)`,
          })}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 3 }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Manager Dashboard</Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ mt: 1 }}>Live Workplace Operations</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Active map: {activeMapName ?? "No map saved yet"}</Typography>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <Chip color={socketState === "connected" ? "success" : socketState === "connecting" ? "warning" : "error"} label={`Socket: ${socketState}`} />
            <Chip color={mapRooms.length > 0 ? "success" : "warning"} label={`Rooms: ${mapRooms.length}`} />
          </Box>
          </Box>
        </Card>

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} xl={3}>
          <Paper sx={{ p: 3, borderLeft: 4, borderColor: 'success.main', height: '100%' }} elevation={1}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Connected Staff</Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ mt: 1 }}>{connectedLocations.length}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{`${disconnectedLocations.length} disconnected`}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} xl={3}>
          <Paper sx={{ p: 3, borderLeft: 4, borderColor: mapRooms.length ? 'text.secondary' : 'warning.main', height: '100%' }} elevation={1}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Rooms In Use</Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ mt: 1 }}>{activeRoomCount}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{`${mapRooms.length} total rooms`}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} xl={3}>
          <Paper sx={{ p: 3, borderLeft: 4, borderColor: 'text.secondary', height: '100%' }} elevation={1}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Mapped Props</Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ mt: 1 }}>{mapProps.length}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{mapBackground ? "Background active" : "No background"}</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} xl={3}>
          <Paper sx={{ p: 3, borderLeft: 4, borderColor: unmappedConnectedCount ? 'warning.main' : 'success.main', height: '100%' }} elevation={1}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Unmapped Users</Typography>
            <Typography variant="h4" fontWeight="bold" sx={{ mt: 1 }}>{unmappedConnectedCount}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{unmappedConnectedCount ? "Assign room mapping in editor" : "All users mapped"}</Typography>
          </Paper>
        </Grid>
      </Grid>

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xl: 'minmax(0, 1fr) minmax(360px, 430px)', xs: '1fr' } }}>
        <Stack spacing={3}>
          <Card elevation={0} sx={{ p: 3, border: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Occupancy View</Typography>
                <Typography variant="h6" fontWeight="bold" sx={{ mt: 0.5 }}>Live Office Map</Typography>
              </Box>
              <Chip size="small" color={connectedLocations.length > 0 ? "success" : "default"} label={`${connectedLocations.length} online`} />
            </Box>

            {isBootstrapping ? <Typography variant="body2" color="text.secondary">Loading locations, tags, and map configuration...</Typography> : null}
            {bootstrapError ? <Alert severity="error">{bootstrapError}</Alert> : null}
            {!isBootstrapping && !bootstrapError && mapRooms.length === 0 ? (
              <Alert severity="warning">
                No saved room zones found. Create zones in Map Editor to enable room-based live placement.
              </Alert>
            ) : null}
            <Box sx={{ minHeight: 400, position: 'relative' }}>
              <LiveMap
                rooms={mapRooms}
                locations={locations}
                mapProps={mapProps}
                background={mapBackground}
                canvasSize={mapCanvasSize}
                interactive={Boolean(canManageLiveMap)}
                mapStorageKey={activeMapId && user ? `${user.orgId}:${activeMapId}` : null}
                currentPlayerId={canManageLiveMap && user ? user.email : null}
                genderByEmployee={userGenderMap}
                onMovePlayer={canManageLiveMap && user ? moveCurrentPlayer : undefined}
                disconnectPings={disconnectPings}
              />
            </Box>
          </Card>

          {canManageTags ? (
            <Card elevation={0} sx={{ p: 3, border: 1, borderColor: 'divider' }}>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Connected Employees</Typography>
              {connectedLocations.length > 0 ? (
                <Stack spacing={2} sx={{ mt: 2 }}>
                  {connectedLocations.map((location) => (
                    <Paper key={location.employeeId} variant="outlined" sx={{ p: 2 }}>
                      <Typography variant="subtitle2" fontWeight="bold">{location.employeeId}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Room: {formatRoomLabel(location.roomId)}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Updated: {new Date(location.ts).toLocaleString()}</Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        color="secondary"
                        sx={{ mt: 1 }}
                        onClick={() => void disconnectEmployeeAsManager(location.employeeId)}
                        disabled={disconnectingEmployeeId === location.employeeId}
                      >
                        {disconnectingEmployeeId === location.employeeId ? "Removing..." : "Remove From Presence"}
                      </Button>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No connected employees.</Typography>
              )}
              {presenceActionStatus ? <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{presenceActionStatus}</Typography> : null}
            </Card>
          ) : null}

          {disconnectedLocations.length > 0 ? (
            <Card elevation={0} sx={{ p: 3, border: 1, borderColor: 'divider' }}>
              <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Outdoor / Disconnected</Typography>
              <Stack spacing={2} sx={{ mt: 2 }}>
                {disconnectedLocations.map((location) => (
                  <Paper key={location.employeeId} variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold">{location.employeeId}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Last known room: {formatRoomLabel(location.roomId)}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Last seen: {new Date(location.ts).toLocaleString()}</Typography>
                  </Paper>
                ))}
              </Stack>
            </Card>
          ) : null}
        </Stack>
        <Card elevation={0} sx={{ p: 3, border: 1, borderColor: 'divider', height: 'fit-content' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Operations</Typography>
            <Typography variant="h6" fontWeight="bold" sx={{ mt: 1 }}>Device BLE Operations</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Use the notifications page for targeted and broadcast messages.</Typography>
          </Box>

          {canManageTags ? (
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 3, mt: 3 }}>
              <Typography variant="subtitle1" fontWeight="bold">Tag Management</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Register tags and review BLE provisioning state.</Typography>

              <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => void refreshTags()}
                  disabled={isRefreshingTags}
                >
                  Refresh
                </Button>
              </Box>

              <Paper variant="outlined" sx={{ mt: 3, p: 2, bgcolor: 'background.default' }}>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 'bold' }}>Register New Tag</Typography>
                
                <TextField
                  fullWidth
                  size="small"
                  label="Device ID"
                  margin="dense"
                  placeholder="tag-003"
                  value={newTagDeviceId}
                  onChange={(event) => setNewTagDeviceId(event.target.value)}
                />

                <TextField
                  fullWidth
                  size="small"
                  label="Room ID (optional)"
                  margin="dense"
                  placeholder="room-C2"
                  value={newTagRoomId}
                  onChange={(event) => setNewTagRoomId(event.target.value)}
                  sx={{ mt: 2 }}
                />

                <Button
                  variant="outlined"
                  color="secondary"
                  size="small"
                  sx={{ mt: 2 }}
                  onClick={() => void registerTag()}
                  disabled={isAddingTag}
                >
                  {isAddingTag ? "Registering..." : "Register Tag"}
                </Button>
              </Paper>

              <Box sx={{ mt: 3, maxHeight: '32rem', overflow: 'auto', pr: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {tags.map((tag) => (
                  <Paper key={tag.id} variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="body2" fontWeight="bold">{tag.id}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Room: {formatRoomLabel(tag.roomId)}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Last BLE provisioning: {tag.bleProvisionedAt ?? "never"}</Typography>
                  </Paper>
                ))}
                {tags.length === 0 ? <Typography variant="caption" color="text.secondary">No tags registered yet.</Typography> : null}
              </Box>

              {tagStatus ? <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>{tagStatus}</Typography> : null}
            </Box>
          ) : (
            <Alert severity="info" variant="outlined" sx={{ mt: 3 }}>
              Tag management controls are available to admin and manager roles.
            </Alert>
          )}
        </Card>
      </Box>
      </Stack>
    </Container>
  );
}
