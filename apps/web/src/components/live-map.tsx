"use client";

import type { LastKnownLocation, LocationMoveRequest, RoomZone, UserGender } from "@ignara/sharedtypes";
import type { KonvaEventObject } from "konva/lib/Node";
import type { MapBackgroundConfig, MapPropElement } from "../lib/map-config";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";

type LiveMapProps = {
  rooms: RoomZone[];
  locations: LastKnownLocation[];
  mapProps?: MapPropElement[];
  background?: MapBackgroundConfig | null;
  interactive?: boolean;
  mapStorageKey?: string | null;
  currentPlayerId?: string | null;
  genderByEmployee?: Record<string, UserGender>;
  onMovePlayer?: (payload: LocationMoveRequest) => Promise<void> | void;
  disconnectPings?: DisconnectPing[];
  autoFollowPlayer?: boolean;
};

type DisconnectPing = {
  employeeId: string;
  roomId: string;
  x?: number;
  y?: number;
  startedAt: number;
};

const BASE_WIDTH = 960;
const BASE_HEIGHT = 560;
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.8;
const ZOOM_STEP = 1.06;
const BLIP_RADIUS = 6;
const MOVE_SPEED_PX_PER_SEC = 130;
const MOVE_SYNC_INTERVAL_MS = 120;
const DISCONNECT_PING_DURATION_MS = 900;
// Idle wander animation parameters — applied only to BLE-tracked employees so
// the dashboard doesn't look frozen between beacon updates. The wander stays
// inside the employee's current room and avoids props.
const WANDER_MOVE_DURATION_MS = 2_000;
const WANDER_IDLE_DURATION_MS = 10_000;
const WANDER_MIN_DISTANCE_PX = 20;
const WANDER_MAX_DISTANCE_PX = 30;
const WANDER_MAX_OFFSET_PX = 60;
const WANDER_PROP_PADDING_PX = 4;
const WANDER_RETRY_DELAY_MS = 600;

type LiveMapViewport = {
  x: number;
  y: number;
  scale: number;
};

type BlipOverride = {
  roomId: string;
  x: number;
  y: number;
};

type WanderState = {
  phase: "idle" | "moving";
  phaseStartedAt: number;
  fromOffsetX: number;
  fromOffsetY: number;
  toOffsetX: number;
  toOffsetY: number;
};

type WanderOffset = { x: number; y: number };

type PersistedLiveMapState = {
  viewport?: LiveMapViewport;
  blips?: Record<string, BlipOverride>;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampToMapX(value: number) {
  return clamp(value, BLIP_RADIUS, BASE_WIDTH - BLIP_RADIUS);
}

function clampToMapY(value: number) {
  return clamp(value, BLIP_RADIUS, BASE_HEIGHT - BLIP_RADIUS);
}

function getStorageKey(mapStorageKey: string | null | undefined) {
  if (!mapStorageKey) {
    return null;
  }
  return `ignara.live-map.${mapStorageKey}`;
}

function parsePersistedState(raw: string | null): PersistedLiveMapState | null {
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as PersistedLiveMapState;
    if (!value || typeof value !== "object") {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function getRoomBlipBounds(room: RoomZone) {
  const rawMinX = room.x + 8;
  const rawMaxX = room.x + room.w - 8;
  const rawMinY = room.y + 24;
  const rawMaxY = room.y + room.h - 8;

  return {
    minX: Math.min(rawMinX, rawMaxX),
    maxX: Math.max(rawMinX, rawMaxX),
    minY: Math.min(rawMinY, rawMaxY),
    maxY: Math.max(rawMinY, rawMaxY),
  };
}

function getStoredLocationPoint(
  location: LastKnownLocation,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { x: number; y: number } | null {
  if (typeof location.x !== "number" || !Number.isFinite(location.x)) {
    return null;
  }

  if (typeof location.y !== "number" || !Number.isFinite(location.y)) {
    return null;
  }

  return {
    x: clamp(location.x, bounds.minX, bounds.maxX),
    y: clamp(location.y, bounds.minY, bounds.maxY),
  };
}

function propFillForType(propType: string, fallback?: string) {
  if (propType === "player-male") {
    return fallback ?? "rgba(56,189,248,0.35)";
  }
  if (propType === "player-female") {
    return fallback ?? "rgba(244,114,182,0.38)";
  }
  return fallback ?? "rgba(244,114,182,0.35)";
}

function getMarkerStyle(gender: UserGender | undefined, connected: boolean) {
  if (!connected) {
    return {
      fill: "rgba(148,163,184,0.82)",
      stroke: "rgba(71,85,105,0.95)",
      text: "rgba(241,245,249,0.92)",
    };
  }

  if (gender === "male") {
    return {
      fill: "rgba(56,189,248,0.95)",
      stroke: "rgba(14,116,144,0.96)",
      text: "rgba(224,242,254,0.96)",
    };
  }

  if (gender === "female") {
    return {
      fill: "rgba(244,114,182,0.96)",
      stroke: "rgba(157,23,77,0.95)",
      text: "rgba(252,231,243,0.96)",
    };
  }

  return {
    fill: "rgba(250,204,21,0.95)",
    stroke: "rgba(161,98,7,0.95)",
    text: "rgba(254,249,195,0.98)",
  };
}

function findRoomContainingPoint(rooms: RoomZone[], x: number, y: number): RoomZone | null {
  for (const room of rooms) {
    const minX = Math.min(room.x, room.x + room.w);
    const maxX = Math.max(room.x, room.x + room.w);
    const minY = Math.min(room.y, room.y + room.h);
    const maxY = Math.max(room.y, room.y + room.h);

    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      return room;
    }
  }

  return null;
}

// Decorative props that mark where avatars stand should not block movement;
// only solid items (generic furniture/walls and beacon markers) are obstacles.
function isBlockingProp(prop: MapPropElement): boolean {
  return prop.propType === "generic" || prop.propType === "beacon";
}

// Treat props as axis-aligned for collision: rotation is purely cosmetic on
// the live map today and the rectangles tend to be square-ish, so the AABB
// approximation is good enough to keep avatars off them.
function isPointInsideAnyProp(propsList: MapPropElement[], x: number, y: number, padding = 0): boolean {
  for (const prop of propsList) {
    if (!isBlockingProp(prop)) {
      continue;
    }

    const minX = Math.min(prop.x, prop.x + prop.w) - padding;
    const maxX = Math.max(prop.x, prop.x + prop.w) + padding;
    const minY = Math.min(prop.y, prop.y + prop.h) - padding;
    const maxY = Math.max(prop.y, prop.y + prop.h) + padding;

    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      return true;
    }
  }

  return false;
}

function findWalkableRoom(
  rooms: RoomZone[],
  propsList: MapPropElement[],
  x: number,
  y: number,
): RoomZone | null {
  const room = findRoomContainingPoint(rooms, x, y);
  if (!room) {
    return null;
  }
  if (isPointInsideAnyProp(propsList, x, y)) {
    return null;
  }
  return room;
}

// Slide along walls: try the full move first, then X-only and Y-only, so the
// player can hug walls and pass through narrow openings between rooms whose
// rectangles overlap or share a border. Returns the resolved point and the
// room that contains it (if any).
function applyMovementWithBoundaries(
  rooms: RoomZone[],
  propsList: MapPropElement[],
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
): { x: number; y: number; roomId: string | null } {
  const candidates: Array<{ x: number; y: number }> = [];
  if (dx !== 0 || dy !== 0) {
    candidates.push({ x: fromX + dx, y: fromY + dy });
  }
  if (dx !== 0) {
    candidates.push({ x: fromX + dx, y: fromY });
  }
  if (dy !== 0) {
    candidates.push({ x: fromX, y: fromY + dy });
  }

  for (const candidate of candidates) {
    const room = findWalkableRoom(rooms, propsList, candidate.x, candidate.y);
    if (room) {
      return { x: candidate.x, y: candidate.y, roomId: room.id };
    }
  }

  const currentRoom = findRoomContainingPoint(rooms, fromX, fromY);
  return { x: fromX, y: fromY, roomId: currentRoom?.id ?? null };
}

export function LiveMap({
  rooms,
  locations,
  mapProps = [],
  background = null,
  interactive = false,
  mapStorageKey = null,
  currentPlayerId = null,
  genderByEmployee = {},
  onMovePlayer,
  disconnectPings = [],
  autoFollowPlayer = false,
}: LiveMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<any>(null);
  const pressedKeysRef = useRef<Record<string, boolean>>({});
  const animationRef = useRef<number | null>(null);
  const lastMoveSentAtRef = useRef(0);
  const locationsRef = useRef<LastKnownLocation[]>(locations);
  const blipOverridesRef = useRef<Record<string, BlipOverride>>({});
  const roomsRef = useRef<RoomZone[]>(rooms);
  const roomLookupRef = useRef<Map<string, RoomZone>>(new Map());
  const defaultBlipPositionsRef = useRef<Map<string, { roomId: string; x: number; y: number }>>(new Map());
  const onMovePlayerRef = useRef<LiveMapProps["onMovePlayer"]>(onMovePlayer);
  const mapPropsRef = useRef<MapPropElement[]>(mapProps);
  const wanderStateRef = useRef<Record<string, WanderState>>({});
  const [stageWidth, setStageWidth] = useState(BASE_WIDTH);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [viewport, setViewport] = useState<LiveMapViewport>({ x: 0, y: 0, scale: 1 });
  const [blipOverrides, setBlipOverrides] = useState<Record<string, BlipOverride>>({});
  const [wanderOffsets, setWanderOffsets] = useState<Record<string, WanderOffset>>({});
  const [animationNow, setAnimationNow] = useState(() => Date.now());
  const [isAutoFollowing, setIsAutoFollowing] = useState(autoFollowPlayer);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width || Number.isNaN(width)) {
        return;
      }

      setStageWidth(Math.max(320, Math.floor(width)));
    });

    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    let active = true;

    if (!background?.dataUrl) {
      setBackgroundImage(null);
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      if (active) {
        setBackgroundImage(image);
      }
    };
    image.onerror = () => {
      if (active) {
        setBackgroundImage(null);
      }
    };
    image.src = background.dataUrl;

    return () => {
      active = false;
    };
  }, [background?.dataUrl]);

  const storageKey = useMemo(() => getStorageKey(mapStorageKey), [mapStorageKey]);
  const stageHeight = Math.max(280, Math.floor(stageWidth * (BASE_HEIGHT / BASE_WIDTH)));
  const fitScale = stageWidth / BASE_WIDTH;

  const roomLookup = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const mappedLocations = useMemo(
    () => locations.filter((location) => roomLookup.has(location.roomId)),
    [locations, roomLookup],
  );
  const connectedCount = useMemo(() => locations.filter((location) => location.connected).length, [locations]);

  function clampViewport(next: LiveMapViewport) {
    const zoom = clamp(next.scale, MIN_ZOOM, MAX_ZOOM);
    const scaledWidth = BASE_WIDTH * fitScale * zoom;
    const scaledHeight = BASE_HEIGHT * fitScale * zoom;
    const minX = Math.min(0, stageWidth - scaledWidth);
    const minY = Math.min(0, stageHeight - scaledHeight);

    return {
      scale: zoom,
      x: clamp(next.x, minX, 0),
      y: clamp(next.y, minY, 0),
    };
  }

  useEffect(() => {
    setViewport((prev) => {
      const clamped = clampViewport(prev);
      if (clamped.x === prev.x && clamped.y === prev.y && clamped.scale === prev.scale) {
        return prev;
      }
      return clamped;
    });
  }, [fitScale, stageHeight, stageWidth]);

  useEffect(() => {
    if (!interactive || !storageKey) {
      setViewport({ x: 0, y: 0, scale: 1 });
      setBlipOverrides({});
      return;
    }

    const persisted = parsePersistedState(window.localStorage.getItem(storageKey));
    if (!persisted) {
      setViewport({ x: 0, y: 0, scale: 1 });
      setBlipOverrides({});
      return;
    }

    const nextViewport = persisted.viewport
      ? clampViewport({
          x: Number.isFinite(persisted.viewport.x) ? persisted.viewport.x : 0,
          y: Number.isFinite(persisted.viewport.y) ? persisted.viewport.y : 0,
          scale: Number.isFinite(persisted.viewport.scale) ? persisted.viewport.scale : 1,
        })
      : { x: 0, y: 0, scale: 1 };

    const nextBlips: Record<string, BlipOverride> = {};
    const savedBlips = persisted.blips ?? {};
    Object.entries(savedBlips).forEach(([employeeId, value]) => {
      if (
        value &&
        typeof value.roomId === "string" &&
        Number.isFinite(value.x) &&
        Number.isFinite(value.y)
      ) {
        nextBlips[employeeId] = {
          roomId: value.roomId,
          x: value.x,
          y: value.y,
        };
      }
    });

    setViewport(nextViewport);
    setBlipOverrides(nextBlips);
  }, [interactive, storageKey]);

  useEffect(() => {
    if (!interactive || !storageKey) {
      return;
    }

    const payload: PersistedLiveMapState = {
      viewport,
      blips: blipOverrides,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [blipOverrides, interactive, storageKey, viewport]);

  useEffect(() => {
    setBlipOverrides((prev) => {
      const mappedById = new Map(mappedLocations.map((location) => [location.employeeId, location]));
      let changed = false;
      const next: Record<string, BlipOverride> = {};

      Object.entries(prev).forEach(([employeeId, value]) => {
        const location = mappedById.get(employeeId);

        if (employeeId === currentPlayerId) {
          if (!roomLookup.has(value.roomId)) {
            changed = true;
            return;
          }

          if (location && location.roomId !== value.roomId) {
            changed = true;
            return;
          }

          next[employeeId] = value;
          return;
        }

        changed = true;
      });

      return changed ? next : prev;
    });
  }, [currentPlayerId, mappedLocations, roomLookup]);

  const locationsByRoom = useMemo(() => {
    const grouped = new Map<string, LastKnownLocation[]>();
    for (const location of mappedLocations) {
      const current = grouped.get(location.roomId) ?? [];
      current.push(location);
      grouped.set(location.roomId, current);
    }
    return grouped;
  }, [mappedLocations]);

  const defaultBlipPositions = useMemo(() => {
    const positions = new Map<string, { roomId: string; x: number; y: number }>();

    rooms.forEach((room) => {
      const roomLocations = locationsByRoom.get(room.id) ?? [];
      const bounds = getRoomBlipBounds(room);

      roomLocations.forEach((location, index) => {
        const fallbackX = clamp(room.x + 14 + (index % 4) * 18, bounds.minX, bounds.maxX);
        const fallbackY = clamp(room.y + room.h - 16 - Math.floor(index / 4) * 18, bounds.minY, bounds.maxY);
        const storedPoint = getStoredLocationPoint(location, bounds);

        positions.set(location.employeeId, {
          roomId: room.id,
          x: storedPoint ? storedPoint.x : fallbackX,
          y: storedPoint ? storedPoint.y : fallbackY,
        });
      });
    });

    return positions;
  }, [locationsByRoom, rooms]);

  useEffect(() => {
    locationsRef.current = locations;
  }, [locations]);

  useEffect(() => {
    blipOverridesRef.current = blipOverrides;
  }, [blipOverrides]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    roomLookupRef.current = roomLookup;
  }, [roomLookup]);

  useEffect(() => {
    defaultBlipPositionsRef.current = defaultBlipPositions;
  }, [defaultBlipPositions]);

  useEffect(() => {
    onMovePlayerRef.current = onMovePlayer;
  }, [onMovePlayer]);

  useEffect(() => {
    mapPropsRef.current = mapProps;
  }, [mapProps]);

  const unplacedCount = locations.filter((location) => !roomLookup.has(location.roomId)).length;
  const stageScale = fitScale * viewport.scale;

  useEffect(() => {
    if (disconnectPings.length === 0) {
      return;
    }

    let animationFrame = 0;
    const update = () => {
      setAnimationNow(Date.now());
      animationFrame = requestAnimationFrame(update);
    };

    animationFrame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [disconnectPings.length]);

  const activeDisconnectPings = useMemo(() => {
    if (disconnectPings.length === 0) {
      return [];
    }

    const locationByEmployee = new Map(mappedLocations.map((location) => [location.employeeId, location]));
    const resolved: Array<{ employeeId: string; x: number; y: number; progress: number }> = [];

    disconnectPings.forEach((ping) => {
      const progress = clamp((animationNow - ping.startedAt) / DISCONNECT_PING_DURATION_MS, 0, 1);
      if (progress >= 1) {
        return;
      }

      const location = locationByEmployee.get(ping.employeeId);
      const room = roomLookup.get(ping.roomId) ?? (location ? roomLookup.get(location.roomId) : null);
      if (!room) {
        return;
      }

      const bounds = getRoomBlipBounds(room);
      const fallback = defaultBlipPositions.get(ping.employeeId) ?? {
        roomId: room.id,
        x: clamp(room.x + room.w / 2, bounds.minX, bounds.maxX),
        y: clamp(room.y + room.h / 2, bounds.minY, bounds.maxY),
      };

      resolved.push({
        employeeId: ping.employeeId,
        x: typeof ping.x === "number" && Number.isFinite(ping.x) ? clampToMapX(ping.x) : fallback.x,
        y: typeof ping.y === "number" && Number.isFinite(ping.y) ? clampToMapY(ping.y) : fallback.y,
        progress,
      });
    });

    return resolved;
  }, [animationNow, defaultBlipPositions, disconnectPings, mappedLocations, roomLookup]);

  function setClampedViewport(next: LiveMapViewport) {
    setViewport((prev) => {
      const clamped = clampViewport(next);
      if (clamped.x === prev.x && clamped.y === prev.y && clamped.scale === prev.scale) {
        return prev;
      }
      return clamped;
    });
  }

  function handleWheel(event: KonvaEventObject<WheelEvent>) {
    if (!interactive) {
      return;
    }

    event.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const oldZoom = viewport.scale;
    const nextZoom = event.evt.deltaY > 0 ? oldZoom / ZOOM_STEP : oldZoom * ZOOM_STEP;
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);

    const oldScale = fitScale * oldZoom;
    const nextScale = fitScale * clampedZoom;
    const worldPoint = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    };

    setClampedViewport({
      scale: clampedZoom,
      x: Math.round(pointer.x - worldPoint.x * nextScale),
      y: Math.round(pointer.y - worldPoint.y * nextScale),
    });
  }

  useEffect(() => {
    if (!interactive || !currentPlayerId) {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    function toMoveKey(key: string): "w" | "a" | "s" | "d" | null {
      if (key === "w" || key === "arrowup") {
        return "w";
      }
      if (key === "a" || key === "arrowleft") {
        return "a";
      }
      if (key === "s" || key === "arrowdown") {
        return "s";
      }
      if (key === "d" || key === "arrowright") {
        return "d";
      }
      return null;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = toMoveKey(event.key.toLowerCase());
      if (!key) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }

      pressedKeysRef.current[key] = true;
      event.preventDefault();
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = toMoveKey(event.key.toLowerCase());
      if (!key) {
        return;
      }

      pressedKeysRef.current[key] = false;
      event.preventDefault();
    };

    let previousFrameAt = performance.now();

    const tick = (frameAt: number) => {
      const deltaSec = Math.max(0.001, (frameAt - previousFrameAt) / 1000);
      previousFrameAt = frameAt;

      const keyState = pressedKeysRef.current;
      const horizontal = (keyState.d ? 1 : 0) - (keyState.a ? 1 : 0);
      const vertical = (keyState.s ? 1 : 0) - (keyState.w ? 1 : 0);

      if (horizontal !== 0 || vertical !== 0) {
        const override = blipOverridesRef.current[currentPlayerId];
        const currentLocation = locationsRef.current.find((entry) => entry.employeeId === currentPlayerId);
        const activeRoomId = override?.roomId ?? currentLocation?.roomId ?? roomsRef.current[0]?.id;
        const activeRoom = activeRoomId ? roomLookupRef.current.get(activeRoomId) : null;

        if (activeRoom) {
          const activeBounds = getRoomBlipBounds(activeRoom);
          const defaultPoint = defaultBlipPositionsRef.current.get(currentPlayerId) ?? {
            roomId: activeRoom.id,
            x: clamp(activeRoom.x + activeRoom.w / 2, activeBounds.minX, activeBounds.maxX),
            y: clamp(activeRoom.y + activeRoom.h / 2, activeBounds.minY, activeBounds.maxY),
          };

          const activePoint =
            override
              ? {
                  roomId: override.roomId,
                  x: clampToMapX(override.x),
                  y: clampToMapY(override.y),
                }
              : defaultPoint;

          const length = Math.hypot(horizontal, vertical) || 1;
          const normalizedX = horizontal / length;
          const normalizedY = vertical / length;

          const dx = normalizedX * MOVE_SPEED_PX_PER_SEC * deltaSec;
          const dy = normalizedY * MOVE_SPEED_PX_PER_SEC * deltaSec;

          // Constrain movement to the union of room rectangles minus blocking
          // props. Wall sliding lets the player hug edges and pass through
          // shared/overlapping room borders without escaping into the white
          // background.
          const moved = applyMovementWithBoundaries(
            roomsRef.current,
            mapPropsRef.current,
            activePoint.x,
            activePoint.y,
            dx,
            dy,
          );

          const nextX = clampToMapX(moved.x);
          const nextY = clampToMapY(moved.y);
          const nextRoomId = moved.roomId ?? activePoint.roomId;

          setBlipOverrides((prev) => {
            const next = {
              ...prev,
              [currentPlayerId]: {
                roomId: nextRoomId,
                x: Math.round(nextX),
                y: Math.round(nextY),
              },
            };
            blipOverridesRef.current = next;
            return next;
          });

          const moveHandler = onMovePlayerRef.current;
          if (moveHandler && frameAt - lastMoveSentAtRef.current >= MOVE_SYNC_INTERVAL_MS) {
            lastMoveSentAtRef.current = frameAt;
            void moveHandler({
              roomId: nextRoomId,
              x: Math.round(nextX),
              y: Math.round(nextY),
            });
          }
        }
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      pressedKeysRef.current = {};
    };
  }, [currentPlayerId, interactive]);

  useEffect(() => {
    setIsAutoFollowing(autoFollowPlayer);
  }, [autoFollowPlayer]);

  // ---- Idle wander animation for BLE-tracked employees ----------------------
  // Beacon updates are bursty (every several seconds at best) so without this
  // the dashboard looks frozen between reports. We add a small local-only
  // jitter: 2 s gentle move, 10 s still, repeat. The wander is constrained to
  // the employee's current room rectangle and avoids blocking props.
  const wanderCandidateIds = useMemo(() => {
    const ids: string[] = [];
    for (const location of mappedLocations) {
      if (!location.connected) {
        continue;
      }
      if (location.signalSource !== "ble") {
        continue;
      }
      if (location.employeeId === currentPlayerId) {
        continue;
      }
      ids.push(location.employeeId);
    }
    return ids.join("|");
  }, [mappedLocations, currentPlayerId]);

  useEffect(() => {
    if (wanderCandidateIds.length === 0) {
      if (Object.keys(wanderStateRef.current).length > 0) {
        wanderStateRef.current = {};
      }
      setWanderOffsets((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    let frame = 0;

    const tick = () => {
      const now = performance.now();
      const nextOffsets: Record<string, WanderOffset> = {};
      const eligibleIds = new Set<string>();

      for (const location of locationsRef.current) {
        if (!location.connected) continue;
        if (location.signalSource !== "ble") continue;
        if (location.employeeId === currentPlayerId) continue;
        if (blipOverridesRef.current[location.employeeId]) continue;

        const room = roomLookupRef.current.get(location.roomId);
        if (!room) continue;

        const defaultPoint = defaultBlipPositionsRef.current.get(location.employeeId);
        if (!defaultPoint) continue;

        eligibleIds.add(location.employeeId);

        let state = wanderStateRef.current[location.employeeId];
        if (!state) {
          state = {
            phase: "idle",
            phaseStartedAt: now,
            fromOffsetX: 0,
            fromOffsetY: 0,
            toOffsetX: 0,
            toOffsetY: 0,
          };
          wanderStateRef.current[location.employeeId] = state;
        }

        if (state.phase === "moving" && now - state.phaseStartedAt >= WANDER_MOVE_DURATION_MS) {
          state.phase = "idle";
          state.phaseStartedAt = now;
          state.fromOffsetX = state.toOffsetX;
          state.fromOffsetY = state.toOffsetY;
        } else if (state.phase === "idle" && now - state.phaseStartedAt >= WANDER_IDLE_DURATION_MS) {
          const angle = Math.random() * Math.PI * 2;
          const distance =
            WANDER_MIN_DISTANCE_PX + Math.random() * (WANDER_MAX_DISTANCE_PX - WANDER_MIN_DISTANCE_PX);
          let candidateX = state.fromOffsetX + Math.cos(angle) * distance;
          let candidateY = state.fromOffsetY + Math.sin(angle) * distance;

          // Don't drift arbitrarily far from the seed position over many cycles.
          const radial = Math.hypot(candidateX, candidateY);
          if (radial > WANDER_MAX_OFFSET_PX) {
            const scale = WANDER_MAX_OFFSET_PX / radial;
            candidateX *= scale;
            candidateY *= scale;
          }

          const targetX = defaultPoint.x + candidateX;
          const targetY = defaultPoint.y + candidateY;

          const targetRoom = findRoomContainingPoint(roomsRef.current, targetX, targetY);
          const blocked = isPointInsideAnyProp(mapPropsRef.current, targetX, targetY, WANDER_PROP_PADDING_PX);

          if (targetRoom && targetRoom.id === room.id && !blocked) {
            state.phase = "moving";
            state.phaseStartedAt = now;
            state.toOffsetX = candidateX;
            state.toOffsetY = candidateY;
          } else {
            // Re-roll soon; don't wait another full idle window.
            state.phaseStartedAt = now - WANDER_IDLE_DURATION_MS + WANDER_RETRY_DELAY_MS;
          }
        }

        let offsetX = state.fromOffsetX;
        let offsetY = state.fromOffsetY;
        if (state.phase === "moving") {
          const t = Math.min(1, (now - state.phaseStartedAt) / WANDER_MOVE_DURATION_MS);
          const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);
          offsetX = state.fromOffsetX + (state.toOffsetX - state.fromOffsetX) * eased;
          offsetY = state.fromOffsetY + (state.toOffsetY - state.fromOffsetY) * eased;
        }

        nextOffsets[location.employeeId] = { x: offsetX, y: offsetY };
      }

      // Drop wander state for employees that are no longer eligible.
      for (const key of Object.keys(wanderStateRef.current)) {
        if (!eligibleIds.has(key)) {
          delete wanderStateRef.current[key];
        }
      }

      setWanderOffsets((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(nextOffsets);
        if (prevKeys.length !== nextKeys.length) {
          return nextOffsets;
        }
        for (const key of nextKeys) {
          const a = prev[key];
          const b = nextOffsets[key];
          if (!a || Math.abs(a.x - b.x) > 0.05 || Math.abs(a.y - b.y) > 0.05) {
            return nextOffsets;
          }
        }
        return prev;
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [wanderCandidateIds, currentPlayerId]);

  useEffect(() => {
    if (!isAutoFollowing || !currentPlayerId || !interactive) {
      return;
    }

    const override = blipOverrides[currentPlayerId];
    const currentLocation = locations.find((entry) => entry.employeeId === currentPlayerId);
    const activeRoomId = override?.roomId ?? currentLocation?.roomId ?? rooms[0]?.id;
    const activeRoom = activeRoomId ? roomLookup.get(activeRoomId) : null;

    if (!activeRoom) {
      return;
    }

    const activeBounds = getRoomBlipBounds(activeRoom);
    const defaultPoint = defaultBlipPositions.get(currentPlayerId) ?? {
      roomId: activeRoom.id,
      x: clamp(activeRoom.x + activeRoom.w / 2, activeBounds.minX, activeBounds.maxX),
      y: clamp(activeRoom.y + activeRoom.h / 2, activeBounds.minY, activeBounds.maxY),
    };

    const activePoint = override
      ? {
          roomId: override.roomId,
          x: clampToMapX(override.x),
          y: clampToMapY(override.y),
        }
      : defaultPoint;

    const targetZoom = 1.5;
    const scaledWidth = BASE_WIDTH * fitScale * targetZoom;
    const scaledHeight = BASE_HEIGHT * fitScale * targetZoom;
    const targetX = stageWidth / 2 - activePoint.x * fitScale * targetZoom;
    const targetY = stageHeight / 2 - activePoint.y * fitScale * targetZoom;

    setViewport((prev) => {
      const lerpFactor = 0.1;
      const nextX = prev.x + (targetX - prev.x) * lerpFactor;
      const nextY = prev.y + (targetY - prev.y) * lerpFactor;
      const nextScale = prev.scale + (targetZoom - prev.scale) * lerpFactor;
      return clampViewport({ x: nextX, y: nextY, scale: nextScale });
    });
  }, [isAutoFollowing, currentPlayerId, interactive, blipOverrides, locations, rooms, roomLookup, defaultBlipPositions, fitScale, stageWidth, stageHeight]);

  return (
    <div ref={wrapperRef} className="rounded-2xl border border-outline/60 bg-panel/72 p-3 shadow-card backdrop-blur-sm">
      <Stage
        ref={stageRef}
        width={stageWidth}
        height={stageHeight}
        x={viewport.x}
        y={viewport.y}
        scaleX={stageScale}
        scaleY={stageScale}
        draggable={interactive}
        onDragEnd={(event) => {
          if (!interactive) {
            return;
          }
          if (event.target !== event.target.getStage()) {
            return;
          }
          setIsAutoFollowing(false);
          setClampedViewport({
            x: Math.round(event.target.x()),
            y: Math.round(event.target.y()),
            scale: viewport.scale,
          });
        }}
        onWheel={handleWheel}
      >
        <Layer>
          {background && backgroundImage ? (
            <KonvaImage
              x={background.x}
              y={background.y}
              width={background.w}
              height={background.h}
              image={backgroundImage}
              opacity={background.opacity}
            />
          ) : null}

          <Rect
            x={16}
            y={16}
            width={BASE_WIDTH - 32}
            height={BASE_HEIGHT - 32}
            cornerRadius={20}
            fill="rgba(255,255,255,0.06)"
            stroke="rgba(140,180,210,0.45)"
            strokeWidth={1.8}
          />

          {mapProps.map((entry) => (
            <Rect
              key={entry.id}
              x={entry.x}
              y={entry.y}
              width={entry.w}
              height={entry.h}
              rotation={entry.rotation ?? 0}
              cornerRadius={8}
              fill={propFillForType(entry.propType, entry.fill)}
              stroke="rgba(244,114,182,0.92)"
              strokeWidth={1.4}
            />
          ))}

          {mapProps.map((entry) => (
            <Text
              key={`${entry.id}-label`}
              x={entry.x + 6}
              y={entry.y + Math.max(3, entry.h - 16)}
              text={entry.label}
              fontSize={10}
              fill="rgba(248,250,252,0.95)"
            />
          ))}

          {rooms.map((room) => {
            const roomLocations = locationsByRoom.get(room.id) ?? [];

            return (
              <Rect
                key={room.id}
                x={room.x}
                y={room.y}
                width={room.w}
                height={room.h}
                rotation={room.rotation ?? 0}
                cornerRadius={12}
                fill={roomLocations.length > 0 ? "rgba(56,189,248,0.27)" : "rgba(160,190,210,0.14)"}
                stroke={roomLocations.length > 0 ? "rgba(56,189,248,0.95)" : "rgba(140,170,190,0.65)"}
                strokeWidth={1.7}
              />
            );
          })}

          {rooms.map((room) => (
            <Text
              key={`${room.id}-label`}
              x={room.x + 8}
              y={room.y + 8}
              text={room.label}
              fontSize={13}
              fill="rgba(221,237,250,0.95)"
            />
          ))}

          {mappedLocations.map((location) => {
            const overridden = blipOverrides[location.employeeId];
            const effectiveRoomId = overridden?.roomId ?? location.roomId;
            const room = roomLookup.get(effectiveRoomId) ?? roomLookup.get(location.roomId);
            if (!room) {
              return null;
            }

            const bounds = getRoomBlipBounds(room);
            const defaultPoint = defaultBlipPositions.get(location.employeeId) ?? {
              roomId: room.id,
              x: clamp(room.x + room.w / 2, bounds.minX, bounds.maxX),
              y: clamp(room.y + room.h / 2, bounds.minY, bounds.maxY),
            };

            const basePoint = overridden
              ? {
                  roomId: overridden.roomId,
                  x: clampToMapX(overridden.x),
                  y: clampToMapY(overridden.y),
                }
              : defaultPoint;

            const wander = !overridden && location.employeeId !== currentPlayerId
              ? wanderOffsets[location.employeeId]
              : undefined;
            const activePoint = wander
              ? {
                  roomId: basePoint.roomId,
                  x: clamp(basePoint.x + wander.x, bounds.minX, bounds.maxX),
                  y: clamp(basePoint.y + wander.y, bounds.minY, bounds.maxY),
                }
              : basePoint;

            const style = getMarkerStyle(genderByEmployee[location.employeeId], location.connected);
            const canDragMarker = interactive && currentPlayerId === location.employeeId;

            return (
              <Fragment key={`${location.employeeId}-marker`}>
                <Circle
                  x={activePoint.x}
                  y={activePoint.y}
                  radius={BLIP_RADIUS}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={1.4}
                  draggable={canDragMarker}
                  dragBoundFunc={(position) => ({
                    x: clampToMapX(position.x),
                    y: clampToMapY(position.y),
                  })}
                  onDragEnd={(event) => {
                    if (!canDragMarker) {
                      return;
                    }

                    const rawX = clampToMapX(event.target.x());
                    const rawY = clampToMapY(event.target.y());
                    const droppedRoom = findRoomContainingPoint(roomsRef.current, rawX, rawY);
                    const fallbackRoomId = blipOverridesRef.current[location.employeeId]?.roomId ?? location.roomId;
                    const fallbackRoom = roomLookupRef.current.get(fallbackRoomId);
                    const resolvedRoom = droppedRoom ?? fallbackRoom;
                    const resolvedBounds = resolvedRoom ? getRoomBlipBounds(resolvedRoom) : null;
                    const nextX = droppedRoom && resolvedBounds ? clamp(rawX, resolvedBounds.minX, resolvedBounds.maxX) : rawX;
                    const nextY = droppedRoom && resolvedBounds ? clamp(rawY, resolvedBounds.minY, resolvedBounds.maxY) : rawY;
                    const nextRoomId = droppedRoom?.id ?? fallbackRoomId;

                    if (!nextRoomId) {
                      return;
                    }

                    event.target.position({ x: nextX, y: nextY });

                    setBlipOverrides((prev) => {
                      const next = {
                        ...prev,
                        [location.employeeId]: {
                          roomId: nextRoomId,
                          x: Math.round(nextX),
                          y: Math.round(nextY),
                        },
                      };
                      blipOverridesRef.current = next;
                      return next;
                    });

                    const moveHandler = onMovePlayerRef.current;
                    if (moveHandler) {
                      void moveHandler({
                        roomId: nextRoomId,
                        x: Math.round(nextX),
                        y: Math.round(nextY),
                      });
                    }
                  }}
                  onDblClick={() => {
                    if (!canDragMarker) {
                      return;
                    }

                    setBlipOverrides((prev) => {
                      const next = { ...prev };
                      delete next[location.employeeId];
                      blipOverridesRef.current = next;
                      return next;
                    });
                  }}
                />
                <Text
                  x={activePoint.x + 8}
                  y={activePoint.y - 6}
                  text={location.employeeId}
                  fontSize={11}
                  fill={style.text}
                />
              </Fragment>
            );
          })}

          {activeDisconnectPings.map((ping) => {
            const outerOpacity = Math.max(0, 0.85 * (1 - ping.progress));
            const innerOpacity = Math.max(0, 0.68 * (1 - ping.progress));

            return (
              <Fragment key={`${ping.employeeId}-disconnect-ping`}>
                <Circle
                  x={ping.x}
                  y={ping.y}
                  radius={BLIP_RADIUS + 8 + ping.progress * 24}
                  fill="rgba(248,113,113,0.03)"
                  stroke={`rgba(248,113,113,${outerOpacity.toFixed(3)})`}
                  strokeWidth={2}
                  listening={false}
                />
                <Circle
                  x={ping.x}
                  y={ping.y}
                  radius={BLIP_RADIUS + 3 + ping.progress * 12}
                  fill="rgba(248,113,113,0.02)"
                  stroke={`rgba(254,202,202,${innerOpacity.toFixed(3)})`}
                  strokeWidth={1.4}
                  listening={false}
                />
              </Fragment>
            );
          })}
        </Layer>
      </Stage>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-dim">
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Rooms: {rooms.length}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Props: {mapProps.length}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Connected users: {connectedCount}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Mapped users: {mappedLocations.length}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Unmapped users: {unplacedCount}</span>
        {interactive ? (
          <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Zoom: {Math.round(viewport.scale * 100)}%</span>
        ) : null}
      </div>

      {interactive ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-dim">
          <button
            type="button"
            className="rounded-lg border border-outline/70 bg-panel-strong px-2.5 py-1 font-medium text-text hover:bg-panel"
            onClick={() => setClampedViewport({ x: 0, y: 0, scale: 1 })}
          >
            Reset View
          </button>
          <button
            type="button"
            className="rounded-lg border border-outline/70 bg-panel-strong px-2.5 py-1 font-medium text-text hover:bg-panel"
            onClick={() => setBlipOverrides({})}
          >
            Reset Blips
          </button>
          <span>Drag map to pan, scroll to zoom, use WASD or arrow keys to move your marker, and drag your own marker for fine adjustment.</span>
        </div>
      ) : (
        <p className="mt-3 text-xs text-text-dim">Read-only map mode.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-text-dim">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-success" />
          Connected marker
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
          Disconnected marker
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent/85" />
          Active room zone
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-panel-strong ring-1 ring-outline" />
          Idle room zone
        </span>
      </div>
    </div>
  );
}
