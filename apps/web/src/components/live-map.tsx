"use client";

import type { LastKnownLocation, RoomZone } from "@ignara/sharedtypes";
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
};

const BASE_WIDTH = 960;
const BASE_HEIGHT = 560;
const MIN_ZOOM = 1;
const MAX_ZOOM = 2.8;
const ZOOM_STEP = 1.06;
const BLIP_RADIUS = 6;

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

type PersistedLiveMapState = {
  viewport?: LiveMapViewport;
  blips?: Record<string, BlipOverride>;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

export function LiveMap({
  rooms,
  locations,
  mapProps = [],
  background = null,
  interactive = false,
  mapStorageKey = null,
}: LiveMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<any>(null);
  const [stageWidth, setStageWidth] = useState(BASE_WIDTH);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
  const [viewport, setViewport] = useState<LiveMapViewport>({ x: 0, y: 0, scale: 1 });
  const [blipOverrides, setBlipOverrides] = useState<Record<string, BlipOverride>>({});

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
  const connectedLocations = useMemo(() => locations.filter((location) => location.connected), [locations]);

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
      const connectedById = new Map(connectedLocations.map((location) => [location.employeeId, location]));
      let changed = false;
      const next: Record<string, BlipOverride> = {};

      Object.entries(prev).forEach(([employeeId, value]) => {
        const location = connectedById.get(employeeId);
        if (!location) {
          changed = true;
          return;
        }
        if (location.roomId !== value.roomId || !roomLookup.has(value.roomId)) {
          changed = true;
          return;
        }

        next[employeeId] = value;
      });

      return changed ? next : prev;
    });
  }, [connectedLocations, roomLookup]);

  const locationsByRoom = useMemo(() => {
    const grouped = new Map<string, LastKnownLocation[]>();
    for (const location of connectedLocations) {
      const current = grouped.get(location.roomId) ?? [];
      current.push(location);
      grouped.set(location.roomId, current);
    }
    return grouped;
  }, [connectedLocations]);

  const defaultBlipPositions = useMemo(() => {
    const positions = new Map<string, { roomId: string; x: number; y: number }>();

    rooms.forEach((room) => {
      const roomLocations = locationsByRoom.get(room.id) ?? [];
      const bounds = getRoomBlipBounds(room);

      roomLocations.forEach((location, index) => {
        const x = clamp(room.x + 14 + (index % 4) * 18, bounds.minX, bounds.maxX);
        const y = clamp(room.y + room.h - 16 - Math.floor(index / 4) * 18, bounds.minY, bounds.maxY);

        positions.set(location.employeeId, {
          roomId: room.id,
          x,
          y,
        });
      });
    });

    return positions;
  }, [locationsByRoom, rooms]);

  const unplacedCount = connectedLocations.filter((location) => !roomLookup.has(location.roomId)).length;
  const stageScale = fitScale * viewport.scale;

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
              cornerRadius={8}
              fill={entry.fill ?? "rgba(244,114,182,0.35)"}
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

          {connectedLocations.map((location) => {
            const room = roomLookup.get(location.roomId);
            if (!room) {
              return null;
            }

            const bounds = getRoomBlipBounds(room);
            const defaultPoint = defaultBlipPositions.get(location.employeeId) ?? {
              roomId: room.id,
              x: clamp(room.x + room.w / 2, bounds.minX, bounds.maxX),
              y: clamp(room.y + room.h / 2, bounds.minY, bounds.maxY),
            };

            const overridden = blipOverrides[location.employeeId];
            const activePoint =
              overridden && overridden.roomId === location.roomId
                ? {
                    roomId: overridden.roomId,
                    x: clamp(overridden.x, bounds.minX, bounds.maxX),
                    y: clamp(overridden.y, bounds.minY, bounds.maxY),
                  }
                : defaultPoint;

            return (
              <Fragment key={`${location.employeeId}-marker`}>
                <Circle
                  x={activePoint.x}
                  y={activePoint.y}
                  radius={BLIP_RADIUS}
                  fill="rgba(16,185,129,0.95)"
                  stroke="rgba(15,118,110,0.95)"
                  strokeWidth={1.4}
                  draggable={interactive}
                  dragBoundFunc={(position) => ({
                    x: clamp(position.x, bounds.minX, bounds.maxX),
                    y: clamp(position.y, bounds.minY, bounds.maxY),
                  })}
                  onDragEnd={(event) => {
                    if (!interactive) {
                      return;
                    }

                    const nextX = clamp(event.target.x(), bounds.minX, bounds.maxX);
                    const nextY = clamp(event.target.y(), bounds.minY, bounds.maxY);
                    event.target.position({ x: nextX, y: nextY });

                    setBlipOverrides((prev) => ({
                      ...prev,
                      [location.employeeId]: {
                        roomId: location.roomId,
                        x: Math.round(nextX),
                        y: Math.round(nextY),
                      },
                    }));
                  }}
                  onDblClick={() => {
                    if (!interactive) {
                      return;
                    }

                    setBlipOverrides((prev) => {
                      const next = { ...prev };
                      delete next[location.employeeId];
                      return next;
                    });
                  }}
                />
                <Text
                  x={activePoint.x + 8}
                  y={activePoint.y - 6}
                  text={location.employeeId}
                  fontSize={11}
                  fill="rgba(231,241,255,0.95)"
                />
              </Fragment>
            );
          })}
        </Layer>
      </Stage>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-dim">
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Rooms: {rooms.length}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Props: {mapProps.length}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Connected users: {connectedLocations.length}</span>
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
          <span>Drag map to pan, scroll to zoom, drag blips to reposition inside room zones.</span>
        </div>
      ) : (
        <p className="mt-3 text-xs text-text-dim">Read-only map mode.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-text-dim">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-success" />
          Employee marker
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
