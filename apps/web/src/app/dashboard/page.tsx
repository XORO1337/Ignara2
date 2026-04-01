"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { LastKnownLocation, RoomZone, TagDeviceSummary } from "@ignara/sharedtypes";
import { apiRequest } from "../../lib/api";
import { parseMapEditorData, pickActiveMap, type MapBackgroundConfig, type MapPropElement } from "../../lib/map-config";
import { locationSocket } from "../../lib/socket";
import { useAuthStore } from "../../store/auth-store";
import { useLocationStore } from "../../store/location-store";
import { AppButton, AppContainer, AppInput, GlassCard, MetricCard, StatusPill } from "../../components/ui";

const LiveMap = dynamic(
  () => import("../../components/live-map").then((module) => module.LiveMap),
  { ssr: false },
);

type SessionUser = {
  sub: string;
  email: string;
  role: "admin" | "manager" | "employee";
  orgId: string;
  isDevAllowlisted?: boolean;
};
type PersistedMap = { id: string; orgId: string; name: string; jsonConfig?: Record<string, unknown> | null };

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const locationsRecord = useLocationStore((state) => state.locations);
  const setLocations = useLocationStore((state) => state.setLocations);
  const upsertLocation = useLocationStore((state) => state.upsertLocation);

  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<"disconnected" | "connecting" | "connected">("disconnected");

  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [activeMapName, setActiveMapName] = useState<string | null>(null);
  const [mapRooms, setMapRooms] = useState<RoomZone[]>([]);
  const [mapProps, setMapProps] = useState<MapPropElement[]>([]);
  const [mapBackground, setMapBackground] = useState<MapBackgroundConfig | null>(null);

  const [tags, setTags] = useState<TagDeviceSummary[]>([]);
  const [wifiForms, setWifiForms] = useState<Record<string, { ssid: string; password: string }>>({});

  const [newTagDeviceId, setNewTagDeviceId] = useState("");
  const [newTagRoomId, setNewTagRoomId] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isRefreshingTags, setIsRefreshingTags] = useState(false);

  const [filterQuery, setFilterQuery] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Record<string, boolean>>({});
  const [bulkSsid, setBulkSsid] = useState("");
  const [bulkPassword, setBulkPassword] = useState("");
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [wifiStatus, setWifiStatus] = useState<string | null>(null);

  const locations = Object.values(locationsRecord);
  const connectedLocations = locations.filter((location) => location.connected);
  const disconnectedLocations = locations.filter((location) => !location.connected);
  const activeRoomCount = new Set(connectedLocations.map((location) => location.roomId)).size;
  const unmappedConnectedCount = connectedLocations.filter((location) => !mapRooms.some((room) => room.id === location.roomId)).length;

  const canManageLiveMap = user?.role === "admin" || user?.role === "manager";
  const canManageWifi = user?.role === "admin" || user?.role === "manager";

  const selectedIds = Object.entries(selectedTagIds)
    .filter(([, selected]) => selected)
    .map(([id]) => id);

  const filteredTags = tags.filter((tag) => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return tag.id.toLowerCase().includes(query) || (tag.roomId ?? "").toLowerCase().includes(query);
  });

  function initializeTagForms(tagDevices: TagDeviceSummary[]) {
    setTags(tagDevices);
    setWifiForms(
      tagDevices.reduce<Record<string, { ssid: string; password: string }>>((acc, device) => {
        acc[device.id] = {
          ssid: device.wifiSsid ?? "",
          password: "",
        };
        return acc;
      }, {}),
    );
    setSelectedTagIds(
      tagDevices.reduce<Record<string, boolean>>((acc, device) => {
        acc[device.id] = false;
        return acc;
      }, {}),
    );
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
    let active = true;
    let orgId = "";

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

        orgId = sessionUser.orgId;
        const managerView = sessionUser.role === "admin" || sessionUser.role === "manager";

        const [current, tagDevices, maps] = await Promise.all([
          apiRequest<LastKnownLocation[]>("/locations/current"),
          managerView ? apiRequest<TagDeviceSummary[]>("/devices/tags") : Promise.resolve([]),
          managerView ? apiRequest<PersistedMap[]>("/maps") : Promise.resolve([]),
        ]);

        if (active) {
          setLocations(current);
          initializeTagForms(tagDevices);
          hydrateMapFromList(maps);
          setBootstrapError(null);

          setSocketState("connecting");
          locationSocket.on("connect", () => {
            locationSocket.emit("join", { room: `org:${orgId}:locations` });
            setSocketState("connected");
          });
          locationSocket.on("disconnect", () => {
            setSocketState("disconnected");
          });
          locationSocket.connect();
          locationSocket.on("location:update", upsertLocation);
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
      locationSocket.off("connect");
      locationSocket.off("disconnect");
      locationSocket.off("location:update", upsertLocation);
      locationSocket.disconnect();
    };
  }, [setLocations, setUser, upsertLocation, user]);

  async function registerTag() {
    if (!newTagDeviceId.trim()) {
      setWifiStatus("Device ID is required to register a tag.");
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
      setWifiForms((prev) => ({
        ...prev,
        [created.id]: {
          ssid: "",
          password: "",
        },
      }));
      setSelectedTagIds((prev) => ({ ...prev, [created.id]: false }));
      setNewTagDeviceId("");
      setNewTagRoomId("");
      setWifiStatus(`Registered ${created.id}. You can now assign WiFi credentials.`);
    } catch {
      setWifiStatus("Failed to register tag. Ensure deviceId is unique and you are logged in as manager/admin.");
    } finally {
      setIsAddingTag(false);
    }
  }

  async function refreshTags() {
    try {
      setIsRefreshingTags(true);
      await loadTags();
      setWifiStatus("Tag list refreshed.");
    } catch {
      setWifiStatus("Could not refresh tags from API.");
    } finally {
      setIsRefreshingTags(false);
    }
  }

  async function applyBulkWifi() {
    const ssid = bulkSsid.trim();
    const password = bulkPassword.trim();

    if (!ssid || !password) {
      setWifiStatus("Bulk assignment requires SSID and password.");
      return;
    }

    if (selectedIds.length === 0) {
      setWifiStatus("Select at least one tag for bulk assignment.");
      return;
    }

    try {
      setIsBulkAssigning(true);
      const results = await Promise.all(
        selectedIds.map((deviceId) =>
          apiRequest<TagDeviceSummary>(`/devices/tags/${deviceId}/wifi`, {
            method: "PUT",
            body: JSON.stringify({ ssid, password }),
          }),
        ),
      );

      const updatedById = new Map(results.map((entry) => [entry.id, entry]));
      setTags((prev) => prev.map((entry) => updatedById.get(entry.id) ?? entry));
      setWifiForms((prev) => {
        const next = { ...prev };
        for (const deviceId of selectedIds) {
          next[deviceId] = {
            ssid,
            password: "",
          };
        }
        return next;
      });
      setBulkPassword("");
      setWifiStatus(`Bulk WiFi assignment sent to ${selectedIds.length} tag(s).`);
    } catch {
      setWifiStatus("Bulk assignment failed. Verify API and MQTT connectivity.");
    } finally {
      setIsBulkAssigning(false);
    }
  }

  async function saveTagWifi(deviceId: string) {
    const form = wifiForms[deviceId];
    if (!form?.ssid?.trim() || !form?.password?.trim()) {
      setWifiStatus("SSID and password are required for assignment.");
      return;
    }

    try {
      setSavingDeviceId(deviceId);
      const updated = await apiRequest<TagDeviceSummary>(`/devices/tags/${deviceId}/wifi`, {
        method: "PUT",
        body: JSON.stringify({ ssid: form.ssid, password: form.password }),
      });

      setTags((prev) => prev.map((entry) => (entry.id === deviceId ? updated : entry)));
      setWifiForms((prev) => ({
        ...prev,
        [deviceId]: {
          ssid: updated.wifiSsid ?? form.ssid,
          password: "",
        },
      }));
      setWifiStatus(`WiFi assigned for ${deviceId}. Configuration command published.`);
    } catch {
      setWifiStatus("Failed to assign WiFi credentials. Check API and MQTT connectivity.");
    } finally {
      setSavingDeviceId(null);
    }
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
              locations={connectedLocations}
              mapProps={mapProps}
              background={mapBackground}
              interactive={canManageLiveMap}
              mapStorageKey={activeMapId && user ? `${user.orgId}:${activeMapId}` : null}
            />
          </GlassCard>

          {disconnectedLocations.length > 0 ? (
            <GlassCard className="space-y-3" variant="soft">
              <p className="font-data text-xs uppercase tracking-[0.2em] text-text-dim">Outdoor / Disconnected</p>
              <div className="space-y-2">
                {disconnectedLocations.map((location) => (
                  <div key={location.employeeId} className="rounded-xl border border-outline/60 bg-panel-strong/50 p-3 text-sm">
                    <p className="font-semibold">{location.employeeId}</p>
                    <p className="mt-1 text-xs text-text-dim">Last known room: {location.roomId}</p>
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
            <h2 className="mt-1 text-xl font-semibold">Device Network Operations</h2>
            <p className="mt-1 text-sm text-text-dim">Use the notifications page for targeted and broadcast messages.</p>
          </div>

          {canManageWifi ? (
            <div className="border-t border-outline/70 pt-4">
              <h3 className="text-base font-semibold">Tag WiFi Assignment</h3>
              <p className="mt-1 text-xs text-text-dim">Assign SSID/password per tag. Device receives config over MQTT.</p>

              <div className="mt-3 flex gap-2">
                <AppInput
                  className="py-1.5"
                  placeholder="Search tag id or room"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                />
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
                <p className="font-data text-xs font-semibold uppercase tracking-[0.12em] text-text-dim">Bulk WiFi Assignment</p>
                <p className="mt-1 text-xs text-text-dim">Selected tags: {selectedIds.length}</p>

                <label className="mt-2 block text-xs text-text-dim">SSID</label>
                <AppInput
                  className="mt-1 py-1.5"
                  value={bulkSsid}
                  onChange={(event) => setBulkSsid(event.target.value)}
                />

                <label className="mt-2 block text-xs text-text-dim">Password</label>
                <AppInput
                  type="password"
                  className="mt-1 py-1.5"
                  value={bulkPassword}
                  onChange={(event) => setBulkPassword(event.target.value)}
                />

                <AppButton
                  type="button"
                  className="mt-3"
                  size="sm"
                  onClick={() => void applyBulkWifi()}
                  loading={isBulkAssigning}
                  disabled={isBulkAssigning}
                >
                  Apply To Selected
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
                {filteredTags.map((tag) => (
                  <div key={tag.id} className="rounded-xl border border-outline/70 bg-panel-strong/50 p-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-outline bg-panel-strong text-accent"
                        checked={selectedTagIds[tag.id] ?? false}
                        onChange={(event) =>
                          setSelectedTagIds((prev) => ({
                            ...prev,
                            [tag.id]: event.target.checked,
                          }))
                        }
                      />
                      <p className="font-data text-sm font-semibold">{tag.id}</p>
                    </label>
                    <p className="mt-1 text-xs text-text-dim">Room: {tag.roomId ?? "unassigned"}</p>
                    <p className="mt-1 text-xs text-text-dim">Last WiFi update: {tag.wifiUpdatedAt ?? "never"}</p>

                    <label className="mt-2 block text-xs text-text-dim">SSID</label>
                    <AppInput
                      className="mt-1 py-1.5"
                      value={wifiForms[tag.id]?.ssid ?? ""}
                      onChange={(event) =>
                        setWifiForms((prev) => ({
                          ...prev,
                          [tag.id]: {
                            ...(prev[tag.id] ?? { ssid: "", password: "" }),
                            ssid: event.target.value,
                          },
                        }))
                      }
                    />

                    <label className="mt-2 block text-xs text-text-dim">Password</label>
                    <AppInput
                      type="password"
                      className="mt-1 py-1.5"
                      value={wifiForms[tag.id]?.password ?? ""}
                      onChange={(event) =>
                        setWifiForms((prev) => ({
                          ...prev,
                          [tag.id]: {
                            ...(prev[tag.id] ?? { ssid: "", password: "" }),
                            password: event.target.value,
                          },
                        }))
                      }
                    />

                    <AppButton
                      type="button"
                      className="mt-3"
                      size="sm"
                      onClick={() => void saveTagWifi(tag.id)}
                      loading={savingDeviceId === tag.id}
                      disabled={savingDeviceId === tag.id}
                    >
                      Assign WiFi
                    </AppButton>
                  </div>
                ))}
                {filteredTags.length === 0 ? <p className="text-xs text-text-dim">No tags match your search.</p> : null}
              </div>

              {wifiStatus ? <p className="mt-3 text-xs text-text-dim">{wifiStatus}</p> : null}
            </div>
          ) : (
            <div className="rounded-xl border border-outline/70 bg-panel-strong/45 p-3 text-sm text-text-dim">
              WiFi assignment controls are available to admin and manager roles.
            </div>
          )}
        </GlassCard>
      </section>
    </AppContainer>
  );
}
