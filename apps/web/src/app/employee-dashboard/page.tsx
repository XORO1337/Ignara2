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
import { AppButton, AppContainer, GlassCard, StatusPill } from "../../components/ui";

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
      <AppContainer>
        <GlassCard>
          <p className="text-sm text-text-dim">Redirecting to the manager dashboard...</p>
        </GlassCard>
      </AppContainer>
    );
  }

  return (
    <AppContainer className="max-w-none px-3 py-3 md:px-4 md:py-4 lg:px-5">
      {user ? (
        <EmployeeCollabDock
          orgId={user.orgId}
          employeeId={user.email}
          activeRoomId={currentUserRoomId}
          locationsByEmployee={locationsRecord}
        />
      ) : null}

      <section className="grid min-h-[calc(100vh-6.5rem)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <GlassCard className="space-y-3" variant="soft">
          {isBootstrapping ? <p className="text-sm text-text-dim">Loading map and employee presence...</p> : null}
          {bootstrapError ? <p className="rounded-xl border border-error/35 bg-error/10 px-3 py-2 text-sm text-error">{bootstrapError}</p> : null}
          {!isBootstrapping && !bootstrapError && mapRooms.length === 0 ? (
            <p className="rounded-xl border border-warning/35 bg-warning/10 px-3 py-2 text-sm text-warning">
              No saved room zones found. Ask an admin to configure room zones in Map Editor.
            </p>
          ) : null}

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
          />
        </GlassCard>

        <GlassCard className="space-y-4" variant="soft">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={socketState === "connected" ? "success" : socketState === "connecting" ? "warning" : "error"} pulse>
              Socket: {socketState}
            </StatusPill>
            <StatusPill tone={connectedLocations.length > 0 ? "success" : "warning"}>
              Employees Online: {connectedLocations.length}
            </StatusPill>
            <StatusPill tone={currentUserRoomId ? "success" : "warning"}>
              You: {currentUserRoomId ? `connected (${currentUserRoomId})` : "disconnected"}
            </StatusPill>
          </div>

          <div>
            <p className="font-data text-xs uppercase tracking-[0.18em] text-text-dim">Quick Join</p>
            <h2 className="mt-1 text-xl font-semibold">Room Jump Slider</h2>
            <p className="mt-1 text-sm text-text-dim">Active map: {activeMapName ?? "No map saved yet"}</p>
            <p className="mt-1 text-sm text-text-dim">Use the slider to jump directly to a room for faster meeting joins.</p>
          </div>

          {orderedRooms.length > 0 ? (
            <>
              <label className="block text-xs font-medium uppercase tracking-[0.14em] text-text-dim" htmlFor="room-jump-slider">
                Room Selector
              </label>
              <input
                id="room-jump-slider"
                type="range"
                min={0}
                max={Math.max(0, orderedRooms.length - 1)}
                value={selectedRoomIndex}
                onChange={(event) => setSelectedRoomIndex(Number(event.target.value))}
                className="w-full accent-accent"
                disabled={orderedRooms.length <= 1}
              />

              <div className="rounded-xl border border-outline/70 bg-panel-strong/55 p-3">
                <p className="font-data text-xs uppercase tracking-[0.12em] text-text-dim">Selected Room</p>
                <p className="mt-1 text-lg font-semibold">{selectedRoom?.label ?? "No room selected"}</p>
                {selectedRoom ? <p className="mt-1 text-xs text-text-dim">Room ID: {selectedRoom.id}</p> : null}
              </div>

              <AppButton
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!selectedRoom) {
                    return;
                  }
                  void jumpToRoom(selectedRoom);
                }}
                disabled={!selectedRoom || !user}
              >
                Jump To Selected Room
              </AppButton>

              <AppButton
                type="button"
                variant="ghost"
                onClick={() => void disconnectSelf()}
                disabled={!currentUserRoomId || isDisconnecting}
                loading={isDisconnecting}
              >
                Disconnect Me
              </AppButton>

              <div className="max-h-[42vh] space-y-2 overflow-auto pr-1">
                {orderedRooms.map((room, index) => {
                  const active = selectedRoom?.id === room.id;

                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => setSelectedRoomIndex(index)}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                        active
                          ? "border-accent/70 bg-accent/10 text-text"
                          : "border-outline/70 bg-panel-strong/45 text-text-dim hover:bg-panel-strong"
                      }`}
                    >
                      <p className="font-semibold">{room.label}</p>
                      <p className="mt-1 text-xs opacity-80">{room.id}</p>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-outline/70 bg-panel-strong/45 p-3 text-sm text-text-dim">
              No rooms available yet. Ask an admin to save room zones in Map Editor.
            </p>
          )}

          {jumpStatus ? <p className="text-xs text-text-dim">{jumpStatus}</p> : null}
        </GlassCard>
      </section>
    </AppContainer>
  );
}
