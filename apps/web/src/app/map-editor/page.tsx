"use client";

import dynamic from "next/dynamic";
import type { LastKnownLocation } from "@ignara/sharedtypes";
import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiRequest } from "../../lib/api";
import { createLocationSocket } from "../../lib/socket";
import { parseMapEditorData, pickActiveMap } from "../../lib/map-config";
import { alpha } from "@mui/material/styles";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Container,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useAuthStore, type SessionUser } from "../../store/auth-store";
import { useMapEditorStore } from "../../store/map-editor-store";

const MapEditorCanvas = dynamic(
  () => import("../../components/map-editor-canvas").then((module) => module.MapEditorCanvas),
  { ssr: false },
);

const MAX_MAP_PAYLOAD_BYTES = 5 * 1024 * 1024;
const utf8Encoder = new TextEncoder();

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `map-${Date.now()}`;
}

type PersistedMap = {
  id: string;
  orgId: string;
  name: string;
  jsonConfig?: Record<string, unknown> | null;
};

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Invalid file payload"));
    };

    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function bytesToMegabytes(bytes: number) {
  return bytes / (1024 * 1024);
}

export default function MapEditorPage() {
  const rooms = useMapEditorStore((state) => state.rooms);
  const props = useMapEditorStore((state) => state.props);
  const background = useMapEditorStore((state) => state.background);
  const selectedTarget = useMapEditorStore((state) => state.selectedTarget);
  const canvasSize = useMapEditorStore((state) => state.canvasSize);
  const setProps = useMapEditorStore((state) => state.setProps);
  const setBackground = useMapEditorStore((state) => state.setBackground);
  const updateBackground = useMapEditorStore((state) => state.updateBackground);
  const updateRoom = useMapEditorStore((state) => state.updateRoom);
  const updateProp = useMapEditorStore((state) => state.updateProp);
  const removeRoom = useMapEditorStore((state) => state.removeRoom);
  const removeProp = useMapEditorStore((state) => state.removeProp);
  const selectTarget = useMapEditorStore((state) => state.selectTarget);
  const setRooms = useMapEditorStore((state) => state.setRooms);
  const setCanvasSize = useMapEditorStore((state) => state.setCanvasSize);

  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [mapId, setMapId] = useState<string | null>(null);
  const [mapName, setMapName] = useState("HQ Floor 1");
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [locations, setLocations] = useState<LastKnownLocation[]>([]);
  const [socketState, setSocketState] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [beaconMessage, setBeaconMessage] = useState("Meeting starting in 5 minutes");
  const [beaconPriority, setBeaconPriority] = useState<"low" | "normal" | "high">("normal");
  const [beaconTargetRoomId, setBeaconTargetRoomId] = useState("");
  const [beaconTtlSeconds, setBeaconTtlSeconds] = useState(60);
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  const selectedRoom = selectedTarget?.type === "room" ? rooms.find((room) => room.id === selectedTarget.id) : null;
  const selectedProp = selectedTarget?.type === "prop" ? props.find((prop) => prop.id === selectedTarget.id) : null;

  useEffect(() => {
    let active = true;
    let orgId = "";
    let locationSocket: Socket | null = null;

    async function hydrateMap() {
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

        const canEditMap = sessionUser.role === "admin" || sessionUser.isDevAllowlisted === true;
        if (!canEditMap) {
          if (active) {
            setHasAccess(false);
            setStatus("Map Editor is restricted to admins and dev allowlisted users.");
          }
          return;
        }

        orgId = sessionUser.orgId;
        if (active) {
          setHasAccess(true);
        }

        const maps = await apiRequest<PersistedMap[]>("/maps");
        const activeMap = pickActiveMap(maps);

        const currentLocations = await apiRequest<LastKnownLocation[]>("/locations/current").catch(() => []);

        if (!active || !activeMap) {
          if (active) {
            setLocations(currentLocations);
          }
          return;
        }

        const parsed = parseMapEditorData(activeMap.jsonConfig ?? {});

        setMapId(activeMap.id);
        setMapName(activeMap.name || "HQ Floor 1");
        setRooms(parsed.rooms);
        setProps(parsed.props);
        setBackground(parsed.background);
        if (parsed.canvasSize) {
          setCanvasSize(parsed.canvasSize);
        }
        setLocations(currentLocations);

        if (active) {
          setSocketState("connecting");
          const socket = await createLocationSocket();
          if (!active) {
            socket.disconnect();
            return;
          }

          locationSocket = socket;
          socket.on("connect", () => {
            socket.emit("join", { room: `org:${orgId}:locations` });
            setSocketState("connected");
          });
          socket.on("disconnect", () => {
            setSocketState("disconnected");
          });
          socket.on("location:update", (location: LastKnownLocation) => {
            setLocations((prev) => {
              const rest = prev.filter((entry) => entry.employeeId !== location.employeeId);
              return [location, ...rest];
            });
          });
          socket.connect();
        }
      } catch {
        if (active) {
          setStatus("Could not load maps. You can still create a new map and save it.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void hydrateMap();
    return () => {
      active = false;
      if (locationSocket) {
        locationSocket.off("connect");
        locationSocket.off("disconnect");
        locationSocket.off("location:update");
        locationSocket.disconnect();
      }
    };
  }, [setBackground, setProps, setRooms, setUser, user]);

  async function saveMap() {
    try {
      setIsSaving(true);

      const currentState = useMapEditorStore.getState();
      const payload = {
        id: mapId ?? makeId(),
        name: mapName.trim() || "HQ Floor 1",
        jsonConfig: {
          schemaVersion: 2,
          rooms: currentState.rooms,
          props: currentState.props,
          background: currentState.background,
          canvasSize: currentState.canvasSize,
        },
      };

      const serializedPayload = JSON.stringify(payload);
      const payloadBytes = utf8Encoder.encode(serializedPayload).length;
      if (payloadBytes > MAX_MAP_PAYLOAD_BYTES) {
        const sizeInMb = bytesToMegabytes(payloadBytes).toFixed(2);
        const limitInMb = bytesToMegabytes(MAX_MAP_PAYLOAD_BYTES).toFixed(0);
        setStatus(`Map payload is ${sizeInMb}MB, which exceeds the ${limitInMb}MB limit. Reduce SVG complexity or file size and try again.`);
        return;
      }

      const saved = await apiRequest<PersistedMap>("/maps", {
        method: "POST",
        body: serializedPayload,
      });

      setMapId(saved.id);
      setMapName(saved.name);
      setStatus(`Saved ${saved.name} with ${currentState.rooms.length} room zone(s) and ${currentState.props.length} prop element(s).`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("413")) {
        setStatus("Map payload exceeded the API 5MB limit. Reduce SVG complexity or file size and try again.");
        return;
      }

      setStatus("Failed to save map. Verify API connectivity and permissions.");
    } finally {
      setIsSaving(false);
    }
  }

  async function broadcastBeaconNotification() {
    const trimmed = beaconMessage.trim();
    if (!trimmed) {
      setStatus("Enter a notification message before broadcasting.");
      return;
    }

    try {
      setIsBroadcasting(true);
      const response = await apiRequest<{ id: string; message: string }>("/ble-beacon/notifications/broadcast", {
        method: "POST",
        body: JSON.stringify({
          message: trimmed,
          priority: beaconPriority,
          targetRoomId: beaconTargetRoomId.trim() || undefined,
          ttlSeconds: Math.max(5, Math.min(3600, Number(beaconTtlSeconds) || 60)),
        }),
      });
      setStatus(
        `Broadcast queued (id ${response.id.slice(0, 8)}): "${response.message}"` +
          (beaconTargetRoomId.trim() ? ` → room ${beaconTargetRoomId.trim()}` : " → all rooms"),
      );
    } catch {
      setStatus("Broadcast failed. Verify API access and that you are admin/manager.");
    } finally {
      setIsBroadcasting(false);
    }
  }

  async function importSvg(event: React.ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (!file) {
      inputElement.value = "";
      return;
    }

    if (!file.type.includes("svg")) {
      setStatus("Only SVG files are supported for floor-plan background.");
      inputElement.value = "";
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      
      const svgDimensions = await detectSvgDimensions(file);
      const svgWidth = svgDimensions?.width ?? 1200;
      const svgHeight = svgDimensions?.height ?? 720;
      
      setCanvasSize({ width: svgWidth, height: svgHeight });
      setBackground({
        dataUrl,
        x: 0,
        y: 0,
        w: svgWidth,
        h: svgHeight,
        opacity: 0.9,
      });
      selectTarget({ type: "background" });
      setStatus(`Imported SVG (${svgWidth}x${svgHeight}): ${file.name}. Canvas auto-adjusted to SVG dimensions.`);
    } catch {
      setStatus("Could not read SVG file. Try another file and re-import.");
    } finally {
      inputElement.value = "";
    }
  }

  async function detectSvgDimensions(file: File): Promise<{ width: number; height: number } | null> {
    try {
      const text = await file.text();
      
      const widthMatch = text.match(/width=["']([^"']+)["']/i);
      const heightMatch = text.match(/height=["']([^"']+)["']/i);
      const viewBoxMatch = text.match(/viewBox=["']([^"']+)["']/i);
      
      let width = 0;
      let height = 0;
      
      if (widthMatch) {
        const parsed = parseFloat(widthMatch[1]);
        if (!isNaN(parsed) && parsed > 0) width = parsed;
      }
      if (heightMatch) {
        const parsed = parseFloat(heightMatch[1]);
        if (!isNaN(parsed) && parsed > 0) height = parsed;
      }
      
      if ((!width || !height) && viewBoxMatch) {
        const parts = viewBoxMatch[1].split(/[\s,]+/).map(Number);
        if (parts.length >= 4) {
          const vbWidth = parts[2];
          const vbHeight = parts[3];
          if (!width && vbWidth > 0) width = vbWidth;
          if (!height && vbHeight > 0) height = vbHeight;
        }
      }
      
      if (width > 0 && height > 0) {
        return { width: Math.round(width), height: Math.round(height) };
      }
      
      return null;
    } catch {
      return null;
    }
  }

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card
        elevation={0}
        sx={(theme) => ({
          p: { xs: 2.5, md: 3.5 },
          backgroundImage: `linear-gradient(140deg, ${alpha(theme.palette.primary.main, 0.18)}, transparent 55%),
            linear-gradient(220deg, ${alpha(theme.palette.secondary.main, 0.16)}, transparent 60%)`,
        })}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2, fontWeight: 700 }}>
              Map Editor
            </Typography>
            <Typography variant="h3" sx={{ mt: 1 }}>Interactive Floor Planner</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Three-panel editor with drag-and-drop, live employee props, and SVG floor-plan support.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Chip
              size="small"
              color={socketState === "connected" ? "success" : socketState === "connecting" ? "warning" : "default"}
              label={`Socket: ${socketState}`}
            />
            <Chip size="small" color={hasAccess ? "success" : "error"} label={hasAccess ? "Access: allowed" : "Access: denied"} />
          </Stack>
        </Box>
      </Card>

      <Card elevation={0} sx={{ p: { xs: 2.5, md: 3 } }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={5}>
            <TextField
              fullWidth
              label="Map Name"
              value={mapName}
              onChange={(event) => setMapName(event.target.value)}
            />
          </Grid>
          <Grid item xs={12} md={5}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" color={isLoading ? "warning" : "success"} label={isLoading ? "Loading map" : "Map loaded"} />
              <Chip size="small" variant="outlined" label={`Rooms: ${rooms.length}`} />
              <Chip size="small" variant="outlined" label={`Props: ${props.length}`} />
            </Stack>
          </Grid>
          <Grid item xs={12} md={2}>
            <Button
              fullWidth
              variant="contained"
              onClick={() => void saveMap()}
              disabled={isSaving || !hasAccess}
            >
              {isSaving ? "Saving..." : "Save Map JSON"}
            </Button>
          </Grid>
        </Grid>
      </Card>

      {!hasAccess && !isLoading ? (
        <Alert severity="warning">Map Editor is restricted to admins and dev allowlisted users only.</Alert>
      ) : null}

      {hasAccess ? (
        <Grid container spacing={3}>
          <Grid item xs={12} lg={3}>
            <Card elevation={0} sx={{ p: 2.5, height: '100%' }}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                    Components
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Drag these elements into the map canvas.
                  </Typography>
                </Box>

                <Stack spacing={1}>
                  <Button
                    type="button"
                    variant="outlined"
                    fullWidth
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("application/x-ignara-palette", "room")}
                    sx={{ justifyContent: 'flex-start' }}
                  >
                    Room Zone
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    fullWidth
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("application/x-ignara-palette", "prop")}
                    sx={{ justifyContent: 'flex-start' }}
                  >
                    Prop Element
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    fullWidth
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("application/x-ignara-palette", "prop-player-male")}
                    sx={{ justifyContent: 'flex-start' }}
                  >
                    Player Prop (Male)
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    fullWidth
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("application/x-ignara-palette", "prop-player-female")}
                    sx={{ justifyContent: 'flex-start' }}
                  >
                    Player Prop (Female)
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    fullWidth
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("application/x-ignara-palette", "prop-beacon")}
                    sx={{ justifyContent: 'flex-start' }}
                  >
                    Beacon (Room ESP32)
                  </Button>
                </Stack>

                <Divider />

                <Button component="label" variant="outlined">
                  Upload SVG Floor Plan
                  <input hidden type="file" accept=".svg,image/svg+xml" onChange={(event) => void importSvg(event)} />
                </Button>

                <Box>
                  <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2, fontWeight: 700 }}>
                    Canvas Size (px)
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <TextField
                      label="Width"
                      type="number"
                      size="small"
                      value={canvasSize.width}
                      onChange={(event) => setCanvasSize({ width: Number(event.target.value) })}
                    />
                    <TextField
                      label="Height"
                      type="number"
                      size="small"
                      value={canvasSize.height}
                      onChange={(event) => setCanvasSize({ height: Number(event.target.value) })}
                    />
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => setCanvasSize({ width: 1200, height: 720 })}>
                      Small
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => setCanvasSize({ width: 1920, height: 1080 })}>
                      HD
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => setCanvasSize({ width: 2560, height: 1440 })}>
                      2K
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => setCanvasSize({ width: 3840, height: 2160 })}>
                      4K
                    </Button>
                  </Stack>
                </Box>

                {background ? (
                  <Button variant="outlined" onClick={() => selectTarget({ type: "background" })}>
                    Select Background
                  </Button>
                ) : null}

                <Divider />

                <Box>
                  <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2, fontWeight: 700 }}>
                    Broadcast to Room Beacons
                  </Typography>
                  <Stack spacing={1.5} sx={{ mt: 1 }}>
                    <TextField
                      label="Message"
                      value={beaconMessage}
                      onChange={(event) => setBeaconMessage(event.target.value)}
                      placeholder="Meeting starting in 5 minutes"
                      multiline
                      minRows={2}
                    />
                    <Stack direction="row" spacing={1}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Priority</InputLabel>
                        <Select
                          label="Priority"
                          value={beaconPriority}
                          onChange={(event) => setBeaconPriority(event.target.value as "low" | "normal" | "high")}
                        >
                          <MenuItem value="low">Low</MenuItem>
                          <MenuItem value="normal">Normal</MenuItem>
                          <MenuItem value="high">High</MenuItem>
                        </Select>
                      </FormControl>
                      <TextField
                        label="TTL (s)"
                        type="number"
                        size="small"
                        value={beaconTtlSeconds}
                        onChange={(event) => setBeaconTtlSeconds(Number(event.target.value) || 60)}
                      />
                    </Stack>
                    <TextField
                      label="Target Room ID (blank = all rooms)"
                      value={beaconTargetRoomId}
                      onChange={(event) => setBeaconTargetRoomId(event.target.value)}
                      placeholder="room-a"
                    />
                    <Button
                      variant="contained"
                      onClick={() => void broadcastBeaconNotification()}
                      disabled={isBroadcasting || !hasAccess}
                    >
                      {isBroadcasting ? "Broadcasting..." : "Push to Beacons"}
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </Card>
          </Grid>

          <Grid item xs={12} lg={6}>
            <Card elevation={0} sx={{ p: 2, height: '100%', minHeight: 520 }}>
              <MapEditorCanvas locations={locations} />
            </Card>
          </Grid>

          <Grid item xs={12} lg={3}>
            <Card elevation={0} sx={{ p: 2.5, height: '100%' }}>
              <Stack spacing={2}>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                  Properties
                </Typography>

                {selectedRoom ? (
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" color="text.secondary">Selected Room</Typography>
                    <TextField
                      label="Label"
                      value={selectedRoom.label}
                      onChange={(event) => updateRoom(selectedRoom.id, { label: event.target.value })}
                    />
                    <TextField
                      label="Scanner Device ID"
                      value={selectedRoom.scannerDeviceId ?? ""}
                      onChange={(event) => updateRoom(selectedRoom.id, { scannerDeviceId: event.target.value || undefined })}
                      placeholder="scanner-01"
                    />
                    <TextField
                      label="Beacon IDs (comma separated)"
                      value={(selectedRoom.beaconIds ?? []).join(", ")}
                      onChange={(event) => {
                        const beaconIds = event.target.value
                          .split(",")
                          .map((entry) => entry.trim())
                          .filter(Boolean);
                        updateRoom(selectedRoom.id, {
                          beaconIds,
                          beaconId: beaconIds[0],
                        });
                      }}
                      placeholder="beacon-room-a, beacon-room-a-2"
                    />
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="X"
                        type="number"
                        value={selectedRoom.x}
                        onChange={(event) => updateRoom(selectedRoom.id, { x: Number(event.target.value) })}
                      />
                      <TextField
                        label="Y"
                        type="number"
                        value={selectedRoom.y}
                        onChange={(event) => updateRoom(selectedRoom.id, { y: Number(event.target.value) })}
                      />
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="Width"
                        type="number"
                        value={selectedRoom.w}
                        onChange={(event) => updateRoom(selectedRoom.id, { w: Number(event.target.value) })}
                      />
                      <TextField
                        label="Height"
                        type="number"
                        value={selectedRoom.h}
                        onChange={(event) => updateRoom(selectedRoom.id, { h: Number(event.target.value) })}
                      />
                    </Stack>
                    <TextField
                      label="Rotation"
                      type="number"
                      value={selectedRoom.rotation ?? 0}
                      onChange={(event) => updateRoom(selectedRoom.id, { rotation: Number(event.target.value) })}
                    />
                    <Button variant="outlined" color="error" onClick={() => removeRoom(selectedRoom.id)}>
                      Delete Room
                    </Button>
                  </Stack>
                ) : null}

                {selectedProp ? (
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" color="text.secondary">Selected Prop</Typography>
                    <TextField
                      label="Label"
                      value={selectedProp.label}
                      onChange={(event) => updateProp(selectedProp.id, { label: event.target.value })}
                    />
                    <TextField
                      label="Fill"
                      value={selectedProp.fill ?? ""}
                      onChange={(event) => updateProp(selectedProp.id, { fill: event.target.value })}
                    />
                    <FormControl fullWidth size="small">
                      <InputLabel>Prop Type</InputLabel>
                      <Select
                        label="Prop Type"
                        value={selectedProp.propType}
                        onChange={(event) =>
                          updateProp(selectedProp.id, {
                            propType: event.target.value as "generic" | "player-male" | "player-female" | "beacon",
                          })
                        }
                      >
                        <MenuItem value="generic">Generic</MenuItem>
                        <MenuItem value="player-male">Player Male</MenuItem>
                        <MenuItem value="player-female">Player Female</MenuItem>
                        <MenuItem value="beacon">Beacon (Room ESP32)</MenuItem>
                      </Select>
                    </FormControl>

                    {selectedProp.propType === "beacon" ? (
                      <Stack spacing={1.5}>
                        <TextField
                          label="Beacon Device ID"
                          value={selectedProp.beaconDeviceId ?? ""}
                          onChange={(event) =>
                            updateProp(selectedProp.id, { beaconDeviceId: event.target.value || undefined })
                          }
                          placeholder="beacon-room-a"
                        />
                        <TextField
                          label="Covers Room ID"
                          value={selectedProp.beaconRoomId ?? ""}
                          onChange={(event) =>
                            updateProp(selectedProp.id, { beaconRoomId: event.target.value || undefined })
                          }
                          placeholder="room-a"
                        />
                      </Stack>
                    ) : null}
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="X"
                        type="number"
                        value={selectedProp.x}
                        onChange={(event) => updateProp(selectedProp.id, { x: Number(event.target.value) })}
                      />
                      <TextField
                        label="Y"
                        type="number"
                        value={selectedProp.y}
                        onChange={(event) => updateProp(selectedProp.id, { y: Number(event.target.value) })}
                      />
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="Width"
                        type="number"
                        value={selectedProp.w}
                        onChange={(event) => updateProp(selectedProp.id, { w: Number(event.target.value) })}
                      />
                      <TextField
                        label="Height"
                        type="number"
                        value={selectedProp.h}
                        onChange={(event) => updateProp(selectedProp.id, { h: Number(event.target.value) })}
                      />
                    </Stack>
                    <TextField
                      label="Rotation"
                      type="number"
                      value={selectedProp.rotation}
                      onChange={(event) => updateProp(selectedProp.id, { rotation: Number(event.target.value) })}
                    />
                    <Button variant="outlined" color="error" onClick={() => removeProp(selectedProp.id)}>
                      Delete Prop
                    </Button>
                  </Stack>
                ) : null}

                {selectedTarget?.type === "background" && background ? (
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2" color="text.secondary">SVG Background</Typography>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="X"
                        type="number"
                        value={background.x}
                        onChange={(event) => updateBackground({ x: Number(event.target.value) })}
                      />
                      <TextField
                        label="Y"
                        type="number"
                        value={background.y}
                        onChange={(event) => updateBackground({ y: Number(event.target.value) })}
                      />
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="Width"
                        type="number"
                        value={background.w}
                        onChange={(event) => updateBackground({ w: Number(event.target.value) })}
                      />
                      <TextField
                        label="Height"
                        type="number"
                        value={background.h}
                        onChange={(event) => updateBackground({ h: Number(event.target.value) })}
                      />
                    </Stack>
                    <TextField
                      label="Opacity"
                      type="number"
                      value={background.opacity}
                      onChange={(event) => updateBackground({ opacity: Number(event.target.value) })}
                    />
                    <Button variant="outlined" color="error" onClick={() => setBackground(null)}>
                      Remove SVG Background
                    </Button>
                  </Stack>
                ) : null}

                {!selectedRoom && !selectedProp && selectedTarget?.type !== "background" ? (
                  <Typography variant="body2" color="text.secondary">
                    Select a room, prop, or background to edit properties.
                  </Typography>
                ) : null}
              </Stack>
            </Card>
          </Grid>
        </Grid>
      ) : null}

      {status ? (
        <Alert severity={status.includes("Failed") || status.includes("Could not") ? "error" : "info"}>{status}</Alert>
      ) : null}
    </Container>
  );
}
