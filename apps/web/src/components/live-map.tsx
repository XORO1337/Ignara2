"use client";

import type { LastKnownLocation, RoomZone } from "@ignara/sharedtypes";
import type { MapBackgroundConfig, MapPropElement } from "../lib/map-config";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";

type LiveMapProps = {
  rooms: RoomZone[];
  locations: LastKnownLocation[];
  mapProps?: MapPropElement[];
  background?: MapBackgroundConfig | null;
};

const BASE_WIDTH = 960;
const BASE_HEIGHT = 560;

export function LiveMap({ rooms, locations, mapProps = [], background = null }: LiveMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(BASE_WIDTH);
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);

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

  const stageHeight = Math.max(280, Math.floor(stageWidth * (BASE_HEIGHT / BASE_WIDTH)));
  const scaleX = stageWidth / BASE_WIDTH;
  const scaleY = stageHeight / BASE_HEIGHT;

  const locationsByRoom = useMemo(() => {
    const grouped = new Map<string, LastKnownLocation[]>();
    for (const location of locations) {
      const current = grouped.get(location.roomId) ?? [];
      current.push(location);
      grouped.set(location.roomId, current);
    }
    return grouped;
  }, [locations]);

  const unplacedCount = locations.filter((location) => !rooms.some((room) => room.id === location.roomId)).length;

  return (
    <div ref={wrapperRef} className="rounded-2xl border border-outline/60 bg-panel/72 p-3 shadow-card backdrop-blur-sm">
      <Stage width={stageWidth} height={stageHeight}>
        <Layer>
          {background && backgroundImage ? (
            <KonvaImage
              x={background.x * scaleX}
              y={background.y * scaleY}
              width={background.w * scaleX}
              height={background.h * scaleY}
              image={backgroundImage}
              opacity={background.opacity}
            />
          ) : null}

          <Rect
            x={16 * scaleX}
            y={16 * scaleY}
            width={BASE_WIDTH * scaleX - 32 * scaleX}
            height={BASE_HEIGHT * scaleY - 32 * scaleY}
            cornerRadius={20}
            fill="rgba(255,255,255,0.06)"
            stroke="rgba(140,180,210,0.45)"
            strokeWidth={1.8}
          />

          {mapProps.map((entry) => (
            <Rect
              key={entry.id}
              x={entry.x * scaleX}
              y={entry.y * scaleY}
              width={entry.w * scaleX}
              height={entry.h * scaleY}
              cornerRadius={8}
              fill={entry.fill ?? "rgba(244,114,182,0.35)"}
              stroke="rgba(244,114,182,0.92)"
              strokeWidth={1.4}
            />
          ))}

          {mapProps.map((entry) => (
            <Text
              key={`${entry.id}-label`}
              x={(entry.x + 6) * scaleX}
              y={(entry.y + Math.max(3, entry.h - 16)) * scaleY}
              text={entry.label}
              fontSize={Math.max(9, 10 * Math.min(scaleX, scaleY))}
              fill="rgba(248,250,252,0.95)"
            />
          ))}

          {rooms.map((room) => {
            const roomLocations = locationsByRoom.get(room.id) ?? [];

            return (
              <Rect
                key={room.id}
                x={room.x * scaleX}
                y={room.y * scaleY}
                width={room.w * scaleX}
                height={room.h * scaleY}
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
              x={(room.x + 8) * scaleX}
              y={(room.y + 8) * scaleY}
              text={room.label}
              fontSize={Math.max(10, 13 * Math.min(scaleX, scaleY))}
              fill="rgba(221,237,250,0.95)"
            />
          ))}

          {rooms.flatMap((room) => {
            const roomLocations = locationsByRoom.get(room.id) ?? [];
            return roomLocations.flatMap((entry, index) => {
              const markerX = (room.x + 12 + (index % 4) * 16) * scaleX;
              const markerY = (room.y + room.h - 14 - Math.floor(index / 4) * 16) * scaleY;

              return [
                <Circle key={`${room.id}-${entry.employeeId}-marker`} x={markerX} y={markerY} radius={4.5} fill="rgba(16,185,129,0.95)" />,
                <Text
                  key={`${room.id}-${entry.employeeId}-label`}
                  x={markerX + 7}
                  y={markerY - 5}
                  text={entry.employeeId}
                  fontSize={Math.max(10, 11 * Math.min(scaleX, scaleY))}
                  fill="rgba(231,241,255,0.95)"
                />,
              ];
            });
          })}
        </Layer>
      </Stage>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-dim">
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Rooms: {rooms.length}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Props: {mapProps.length}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Connected users: {locations.length}</span>
        <span className="rounded-full border border-outline/70 bg-panel-strong px-3 py-1">Unmapped users: {unplacedCount}</span>
      </div>

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
