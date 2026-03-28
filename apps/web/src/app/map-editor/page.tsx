"use client";

import dynamic from "next/dynamic";
import type { LastKnownLocation } from "@ignara/sharedtypes";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import { locationSocket } from "../../lib/socket";
import { parseMapEditorData, pickActiveMap } from "../../lib/map-config";
import { AppButton, AppContainer, AppInput, GlassCard, StatusPill } from "../../components/ui";
import { useAuthStore } from "../../store/auth-store";
import { useMapEditorStore } from "../../store/map-editor-store";

const MapEditorCanvas = dynamic(
  () => import("../../components/map-editor-canvas").then((module) => module.MapEditorCanvas),
  { ssr: false },
);

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

type SessionUser = {
  sub: string;
  email: string;
  role: "admin" | "manager" | "employee";
  orgId: string;
};

function parseDevAllowlist() {
  const raw = process.env.NEXT_PUBLIC_DEV_USER_EMAILS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export default function MapEditorPage() {
  const rooms = useMapEditorStore((state) => state.rooms);
  const props = useMapEditorStore((state) => state.props);
  const background = useMapEditorStore((state) => state.background);
  const selectedTarget = useMapEditorStore((state) => state.selectedTarget);
  const setProps = useMapEditorStore((state) => state.setProps);
  const setBackground = useMapEditorStore((state) => state.setBackground);
  const updateBackground = useMapEditorStore((state) => state.updateBackground);
  const updateRoom = useMapEditorStore((state) => state.updateRoom);
  const updateProp = useMapEditorStore((state) => state.updateProp);
  const removeRoom = useMapEditorStore((state) => state.removeRoom);
  const removeProp = useMapEditorStore((state) => state.removeProp);
  const selectTarget = useMapEditorStore((state) => state.selectTarget);
  const setRooms = useMapEditorStore((state) => state.setRooms);

  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const devAllowlist = useMemo(parseDevAllowlist, []);

  const [mapId, setMapId] = useState<string | null>(null);
  const [mapName, setMapName] = useState("HQ Floor 1");
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [locations, setLocations] = useState<LastKnownLocation[]>([]);
  const [socketState, setSocketState] = useState<"disconnected" | "connecting" | "connected">("disconnected");

  const selectedRoom = selectedTarget?.type === "room" ? rooms.find((room) => room.id === selectedTarget.id) : null;
  const selectedProp = selectedTarget?.type === "prop" ? props.find((prop) => prop.id === selectedTarget.id) : null;

  useEffect(() => {
    let active = true;
    let orgId = "";

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

        const isDevUser = devAllowlist.includes(sessionUser.email.toLowerCase());
        const canEditMap = sessionUser.role === "admin" || isDevUser;
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
        setLocations(currentLocations);

        if (active) {
          setSocketState("connecting");
          locationSocket.on("connect", () => {
            locationSocket.emit("join", { room: `org:${orgId}:locations` });
            setSocketState("connected");
          });
          locationSocket.on("disconnect", () => {
            setSocketState("disconnected");
          });
          locationSocket.on("location:update", (location: LastKnownLocation) => {
            setLocations((prev) => {
              const rest = prev.filter((entry) => entry.employeeId !== location.employeeId);
              return [location, ...rest];
            });
          });
          locationSocket.connect();
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
      locationSocket.off("connect");
      locationSocket.off("disconnect");
      locationSocket.off("location:update");
      locationSocket.disconnect();
    };
  }, [devAllowlist, setBackground, setProps, setRooms, setUser, user]);

  async function saveMap() {
    try {
      setIsSaving(true);
      const saved = await apiRequest<PersistedMap>("/maps", {
        method: "POST",
        body: JSON.stringify({
          id: mapId ?? makeId(),
          name: mapName.trim() || "HQ Floor 1",
          jsonConfig: {
            schemaVersion: 2,
            rooms,
            props,
            background,
          },
        }),
      });

      setMapId(saved.id);
      setMapName(saved.name);
      setStatus(`Saved ${saved.name} with ${rooms.length} room zone(s) and ${props.length} prop element(s).`);
    } catch {
      setStatus("Failed to save map. Verify API connectivity and permissions.");
    } finally {
      setIsSaving(false);
    }
  }

  async function importSvg(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.includes("svg")) {
      setStatus("Only SVG files are supported for floor-plan background.");
      return;
    }

    const dataUrl = await file.text().then((text) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`);
    setBackground({
      dataUrl,
      x: 0,
      y: 0,
      w: 1200,
      h: 720,
      opacity: 0.9,
    });
    selectTarget({ type: "background" });
    setStatus(`Imported SVG floor-plan background: ${file.name}`);
  }

  return (
    <AppContainer className="space-y-4">
      <GlassCard variant="elevated">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.22em] text-text-dim">Map Editor</p>
            <h1 className="mt-1 text-3xl font-semibold text-balance">Interactive Floor Planner</h1>
            <p className="mt-1 text-sm text-text-dim">Three-panel editor with drag-and-drop, live employee props, and SVG floor-plan support.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={socketState === "connected" ? "success" : socketState === "connecting" ? "warning" : "neutral"} pulse>
              Socket: {socketState}
            </StatusPill>
            <StatusPill tone={hasAccess ? "success" : "error"}>{hasAccess ? "Access: allowed" : "Access: denied"}</StatusPill>
          </div>
        </div>
      </GlassCard>

      <GlassCard variant="soft">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
          <label className="text-sm text-text-dim">
            Map Name
            <AppInput className="mt-1" value={mapName} onChange={(event) => setMapName(event.target.value)} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={isLoading ? "warning" : "success"}>{isLoading ? "Loading map" : "Map loaded"}</StatusPill>
            <StatusPill tone="neutral">Rooms: {rooms.length}</StatusPill>
            <StatusPill tone="neutral">Props: {props.length}</StatusPill>
          </div>
          <AppButton type="button" onClick={() => void saveMap()} loading={isSaving} disabled={isSaving || !hasAccess}>
            Save Map JSON
          </AppButton>
        </div>
      </GlassCard>

      {!hasAccess && !isLoading ? (
        <GlassCard variant="soft">
          <p className="text-sm text-error">Map Editor is restricted to admins and dev allowlisted users only.</p>
        </GlassCard>
      ) : null}

      {hasAccess ? (
        <section className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <GlassCard className="space-y-3" variant="soft">
            <h2 className="text-lg font-semibold">Components</h2>
            <p className="text-xs text-text-dim">Drag these elements into the map canvas.</p>

            <button
              type="button"
              draggable
              onDragStart={(event) => event.dataTransfer.setData("application/x-ignara-palette", "room")}
              className="w-full rounded-xl border border-outline bg-panel-strong px-3 py-2 text-left text-sm hover:bg-panel"
            >
              Room Zone
            </button>

            <button
              type="button"
              draggable
              onDragStart={(event) => event.dataTransfer.setData("application/x-ignara-palette", "prop")}
              className="w-full rounded-xl border border-outline bg-panel-strong px-3 py-2 text-left text-sm hover:bg-panel"
            >
              Prop Element
            </button>

            <label className="block text-sm text-text-dim">
              Upload SVG Floor Plan
              <input className="mt-1 block w-full text-xs" type="file" accept=".svg,image/svg+xml" onChange={(event) => void importSvg(event)} />
            </label>

            {background ? (
              <AppButton type="button" variant="secondary" size="sm" onClick={() => selectTarget({ type: "background" })}>
                Select Background
              </AppButton>
            ) : null}
          </GlassCard>

          <MapEditorCanvas locations={locations} />

          <GlassCard className="space-y-3" variant="soft">
            <h2 className="text-lg font-semibold">Properties</h2>

            {selectedRoom ? (
              <>
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Selected Room</p>
                <label className="block text-sm text-text-dim">
                  Label
                  <AppInput value={selectedRoom.label} onChange={(event) => updateRoom(selectedRoom.id, { label: event.target.value })} />
                </label>
                <label className="block text-sm text-text-dim">
                  Scanner Device ID
                  <AppInput
                    value={selectedRoom.scannerDeviceId ?? ""}
                    onChange={(event) => updateRoom(selectedRoom.id, { scannerDeviceId: event.target.value || undefined })}
                    placeholder="scanner-01"
                  />
                </label>
                <label className="block text-sm text-text-dim">
                  X
                  <AppInput
                    type="number"
                    value={selectedRoom.x}
                    onChange={(event) => updateRoom(selectedRoom.id, { x: Number(event.target.value) })}
                  />
                </label>
                <label className="block text-sm text-text-dim">
                  Y
                  <AppInput
                    type="number"
                    value={selectedRoom.y}
                    onChange={(event) => updateRoom(selectedRoom.id, { y: Number(event.target.value) })}
                  />
                </label>
                <label className="block text-sm text-text-dim">
                  Width
                  <AppInput
                    type="number"
                    value={selectedRoom.w}
                    onChange={(event) => updateRoom(selectedRoom.id, { w: Number(event.target.value) })}
                  />
                </label>
                <label className="block text-sm text-text-dim">
                  Height
                  <AppInput
                    type="number"
                    value={selectedRoom.h}
                    onChange={(event) => updateRoom(selectedRoom.id, { h: Number(event.target.value) })}
                  />
                </label>
                <AppButton type="button" variant="danger" onClick={() => removeRoom(selectedRoom.id)}>
                  Delete Room
                </AppButton>
              </>
            ) : null}

            {selectedProp ? (
              <>
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Selected Prop</p>
                <label className="block text-sm text-text-dim">
                  Label
                  <AppInput value={selectedProp.label} onChange={(event) => updateProp(selectedProp.id, { label: event.target.value })} />
                </label>
                <label className="block text-sm text-text-dim">
                  Fill
                  <AppInput value={selectedProp.fill ?? ""} onChange={(event) => updateProp(selectedProp.id, { fill: event.target.value })} />
                </label>
                <label className="block text-sm text-text-dim">
                  X
                  <AppInput
                    type="number"
                    value={selectedProp.x}
                    onChange={(event) => updateProp(selectedProp.id, { x: Number(event.target.value) })}
                  />
                </label>
                <label className="block text-sm text-text-dim">
                  Y
                  <AppInput
                    type="number"
                    value={selectedProp.y}
                    onChange={(event) => updateProp(selectedProp.id, { y: Number(event.target.value) })}
                  />
                </label>
                <label className="block text-sm text-text-dim">
                  Width
                  <AppInput
                    type="number"
                    value={selectedProp.w}
                    onChange={(event) => updateProp(selectedProp.id, { w: Number(event.target.value) })}
                  />
                </label>
                <label className="block text-sm text-text-dim">
                  Height
                  <AppInput
                    type="number"
                    value={selectedProp.h}
                    onChange={(event) => updateProp(selectedProp.id, { h: Number(event.target.value) })}
                  />
                </label>
                <AppButton type="button" variant="danger" onClick={() => removeProp(selectedProp.id)}>
                  Delete Prop
                </AppButton>
              </>
            ) : null}

            {selectedTarget?.type === "background" && background ? (
              <>
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">SVG Background</p>
                <label className="block text-sm text-text-dim">
                  X
                  <AppInput type="number" value={background.x} onChange={(event) => updateBackground({ x: Number(event.target.value) })} />
                </label>
                <label className="block text-sm text-text-dim">
                  Y
                  <AppInput type="number" value={background.y} onChange={(event) => updateBackground({ y: Number(event.target.value) })} />
                </label>
                <label className="block text-sm text-text-dim">
                  Width
                  <AppInput type="number" value={background.w} onChange={(event) => updateBackground({ w: Number(event.target.value) })} />
                </label>
                <label className="block text-sm text-text-dim">
                  Height
                  <AppInput type="number" value={background.h} onChange={(event) => updateBackground({ h: Number(event.target.value) })} />
                </label>
                <label className="block text-sm text-text-dim">
                  Opacity
                  <AppInput
                    type="number"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={background.opacity}
                    onChange={(event) => updateBackground({ opacity: Number(event.target.value) })}
                  />
                </label>
                <AppButton type="button" variant="danger" onClick={() => setBackground(null)}>
                  Remove SVG Background
                </AppButton>
              </>
            ) : null}

            {!selectedRoom && !selectedProp && selectedTarget?.type !== "background" ? (
              <p className="text-sm text-text-dim">Select a room, prop, or background to edit properties.</p>
            ) : null}
          </GlassCard>
        </section>
      ) : null}

      {status ? (
        <GlassCard variant="soft">
          <p className="text-sm text-text-dim">{status}</p>
        </GlassCard>
      ) : null}
    </AppContainer>
  );
}
