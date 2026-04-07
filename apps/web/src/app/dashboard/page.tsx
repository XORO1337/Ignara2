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
import { AppButton, AppContainer, AppInput, GlassCard, MetricCard, StatusPill } from "../../components/ui";

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
  const removeLocation = useLocationStore((state) => state.removeLocation);
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
  const spawnedPlayerRef = useRef<Record<string, boolean>>({});
  const employeeEmailSetRef = useRef<Set<string>>(new Set());
  const disconnectRemovalTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [tags, setTags] = useState<TagDeviceSummary[]>([]);
  const [tagStatus, setTagStatus] = useState<string | null>(null);

  const [newTagDeviceId, setNewTagDeviceId] = useState("");
  const [newTagRoomId, setNewTagRoomId] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isRefreshingTags, setIsRefreshingTags] = useState(false);

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

  function clearDisconnectRemovalTimer(employeeId: string) {
    const timer = disconnectRemovalTimersRef.current[employeeId];
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    delete disconnectRemovalTimersRef.current[employeeId];
  }

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
          setLocations(current.filter((location) => employeeEmails.has(location.employeeId) && location.connected));
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
            setSocketState("connected");
          });
          socket.on("disconnect", () => {
            setSocketState("disconnected");
          });
          socket.on("location:update", (location: LastKnownLocation) => {
            if (!employeeEmailSetRef.current.has(location.employeeId)) {
              return;
            }

            if (location.connected) {
              clearDisconnectRemovalTimer(location.employeeId);
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

            clearDisconnectRemovalTimer(location.employeeId);
            disconnectRemovalTimersRef.current[location.employeeId] = setTimeout(() => {
              removeLocation(location.employeeId);
              setDisconnectPings((prev) => prev.filter((ping) => ping.employeeId !== location.employeeId));
              delete disconnectRemovalTimersRef.current[location.employeeId];
            }, DISCONNECT_PING_DURATION_MS);
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
        locationSocket.off("disconnect");
        locationSocket.off("location:update");
        locationSocket.off("presence:joined");
        locationSocket.off("presence:left");
        locationSocket.disconnect();
      }

      Object.values(disconnectRemovalTimersRef.current).forEach((timer) => clearTimeout(timer));
      disconnectRemovalTimersRef.current = {};
    };
  }, [addToast, removeLocation, router, setLocations, setUser, upsertLocation, user]);

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

  if (user && user.role === "employee") {
    return (
      <AppContainer>
        <GlassCard>
          <p className="text-sm text-text-dim">Redirecting to the employee dashboard...</p>
        </GlassCard>
      </AppContainer>
    );
  }

  return (
    <AppContainer className="space-y-5">
      <GlassCard variant="elevated">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.24em] text-text-dim">Manager Dashboard</p>
            <h1 className="mt-1 text-3xl font-semibold text-balance">Live Workplace Operations</h1>
            <p className="mt-1 text-sm text-text-dim">Active map: {activeMapName ?? "No map saved yet"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={socketState === "connected" ? "success" : socketState === "connecting" ? "warning" : "error"} pulse>
              Socket: {socketState}
            </StatusPill>
            <StatusPill tone={mapRooms.length > 0 ? "success" : "warning"}>Rooms: {mapRooms.length}</StatusPill>
          </div>
        </div>
      </GlassCard>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Connected Staff" value={connectedLocations.length} hint={`${disconnectedLocations.length} disconnected`} tone="success" />
        <MetricCard label="Rooms In Use" value={activeRoomCount} hint={`${mapRooms.length} total rooms`} tone={mapRooms.length ? "neutral" : "warning"} />
        <MetricCard label="Mapped Props" value={mapProps.length} hint={mapBackground ? "Background active" : "No background"} />
        <MetricCard
          label="Unmapped Users"
          value={unmappedConnectedCount}
          hint={unmappedConnectedCount ? "Assign room mapping in editor" : "All users mapped"}
          tone={unmappedConnectedCount ? "warning" : "success"}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,430px)]">
        <div className="space-y-3">
          <GlassCard className="space-y-3" variant="soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-data text-xs uppercase tracking-[0.18em] text-text-dim">Occupancy View</p>
                <h2 className="mt-1 text-xl font-semibold">Live Office Map</h2>
              </div>
              <StatusPill tone={connectedLocations.length > 0 ? "success" : "neutral"}>{connectedLocations.length} online</StatusPill>
            </div>

            {isBootstrapping ? <p className="text-sm text-text-dim">Loading locations, tags, and map configuration...</p> : null}
            {bootstrapError ? <p className="rounded-xl border border-error/35 bg-error/10 px-3 py-2 text-sm text-error">{bootstrapError}</p> : null}
            {!isBootstrapping && !bootstrapError && mapRooms.length === 0 ? (
              <p className="rounded-xl border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-warning">
                No saved room zones found. Create zones in Map Editor to enable room-based live placement.
              </p>
            ) : null}
            <LiveMap
              rooms={mapRooms}
              locations={locations}
              mapProps={mapProps}
              background={mapBackground}
              interactive={Boolean(canManageLiveMap)}
              mapStorageKey={activeMapId && user ? `${user.orgId}:${activeMapId}` : null}
              currentPlayerId={canManageLiveMap && user ? user.email : null}
              genderByEmployee={userGenderMap}
              onMovePlayer={canManageLiveMap && user ? moveCurrentPlayer : undefined}
              disconnectPings={disconnectPings}
            />
          </GlassCard>

          {disconnectedLocations.length > 0 ? (
            <GlassCard className="space-y-3" variant="soft">
              <p className="font-data text-xs uppercase tracking-[0.2em] text-text-dim">Outdoor / Disconnected</p>
              <div className="space-y-2">
                {disconnectedLocations.map((location) => (
                  <div key={location.employeeId} className="rounded-xl border border-outline/60 bg-panel-strong/50 p-3 text-sm">
                    <p className="font-semibold">{location.employeeId}</p>
                    <p className="mt-1 text-xs text-text-dim">Last known room: {formatRoomLabel(location.roomId)}</p>
                    <p className="mt-1 text-xs text-text-dim">Last seen: {new Date(location.ts).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          ) : null}
        </div>
        <GlassCard className="space-y-4" variant="soft">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.18em] text-text-dim">Operations</p>
            <h2 className="mt-1 text-xl font-semibold">Device BLE Operations</h2>
            <p className="mt-1 text-sm text-text-dim">Use the notifications page for targeted and broadcast messages.</p>
          </div>

          {canManageTags ? (
            <div className="border-t border-outline/70 pt-4">
              <h3 className="text-base font-semibold">Tag Management</h3>
              <p className="mt-1 text-xs text-text-dim">Register tags and review BLE provisioning state.</p>

              <div className="mt-3 flex gap-2">
                <AppButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void refreshTags()}
                  loading={isRefreshingTags}
                  disabled={isRefreshingTags}
                >
                  Refresh
                </AppButton>
              </div>

              <div className="mt-3 rounded-xl border border-outline/70 bg-panel-strong/60 p-3">
                <p className="font-data text-xs font-semibold uppercase tracking-[0.12em] text-text-dim">Register New Tag</p>
                <label className="mt-2 block text-xs text-text-dim">Device ID</label>
                <AppInput
                  className="mt-1 py-1.5"
                  placeholder="tag-003"
                  value={newTagDeviceId}
                  onChange={(event) => setNewTagDeviceId(event.target.value)}
                />

                <label className="mt-2 block text-xs text-text-dim">Room ID (optional)</label>
                <AppInput
                  className="mt-1 py-1.5"
                  placeholder="room-C2"
                  value={newTagRoomId}
                  onChange={(event) => setNewTagRoomId(event.target.value)}
                />

                <AppButton
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  size="sm"
                  onClick={() => void registerTag()}
                  loading={isAddingTag}
                  disabled={isAddingTag}
                >
                  Register Tag
                </AppButton>
              </div>

              <div className="mt-3 max-h-[32rem] space-y-3 overflow-auto pr-1">
                {tags.map((tag) => (
                  <div key={tag.id} className="rounded-xl border border-outline/70 bg-panel-strong/50 p-3">
                    <p className="font-data text-sm font-semibold">{tag.id}</p>
                    <p className="mt-1 text-xs text-text-dim">Room: {formatRoomLabel(tag.roomId)}</p>
                    <p className="mt-1 text-xs text-text-dim">Last BLE provisioning: {tag.bleProvisionedAt ?? "never"}</p>
                  </div>
                ))}
                {tags.length === 0 ? <p className="text-xs text-text-dim">No tags registered yet.</p> : null}
              </div>

              {tagStatus ? <p className="mt-3 text-xs text-text-dim">{tagStatus}</p> : null}
            </div>
          ) : (
            <div className="rounded-xl border border-outline/70 bg-panel-strong/45 p-3 text-sm text-text-dim">
              Tag management controls are available to admin and manager roles.
            </div>
          )}
        </GlassCard>
      </section>
    </AppContainer>
  );
}
