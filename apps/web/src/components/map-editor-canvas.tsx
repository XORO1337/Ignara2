"use client";

import type { LastKnownLocation } from "@ignara/sharedtypes";
import type { KonvaEventObject } from "konva/lib/Node";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";
import { useMapEditorStore } from "../store/map-editor-store";

type MapEditorCanvasProps = {
  locations: LastKnownLocation[];
};

const BASE_WIDTH = 1200;
const BASE_HEIGHT = 720;

export function MapEditorCanvas({ locations }: MapEditorCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<any>(null);
  const [stageSize, setStageSize] = useState({ width: BASE_WIDTH, height: BASE_HEIGHT });
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);

  const rooms = useMapEditorStore((state) => state.rooms);
  const props = useMapEditorStore((state) => state.props);
  const background = useMapEditorStore((state) => state.background);
  const viewport = useMapEditorStore((state) => state.viewport);
  const setViewport = useMapEditorStore((state) => state.setViewport);
  const addRoom = useMapEditorStore((state) => state.addRoom);
  const addProp = useMapEditorStore((state) => state.addProp);
  const updateRoom = useMapEditorStore((state) => state.updateRoom);
  const updateProp = useMapEditorStore((state) => state.updateProp);
  const selectTarget = useMapEditorStore((state) => state.selectTarget);
  const selectedTarget = useMapEditorStore((state) => state.selectedTarget);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? BASE_WIDTH);
      if (!width || Number.isNaN(width)) {
        return;
      }
      const nextWidth = Math.max(1, width);
      setStageSize({ width: nextWidth, height: Math.max(220, Math.floor(nextWidth * 0.62)) });
    });

    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!background?.dataUrl) {
      setBackgroundImage(null);
      return;
    }

    const image = new window.Image();
    image.onload = () => setBackgroundImage(image);
    image.src = background.dataUrl;
  }, [background?.dataUrl]);

  function updateDraggedPosition(id: string, event: KonvaEventObject<DragEvent>) {
    updateRoom(id, {
      x: Math.round(event.target.x()),
      y: Math.round(event.target.y()),
    });
  }

  function updateDraggedPropPosition(id: string, event: KonvaEventObject<DragEvent>) {
    updateProp(id, {
      x: Math.round(event.target.x()),
      y: Math.round(event.target.y()),
    });
  }

  function toWorldPoint(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) {
      return { x: 100, y: 100 };
    }

    const rect = stage.container().getBoundingClientRect();
    return {
      x: Math.round((clientX - rect.left - viewport.x) / viewport.scale),
      y: Math.round((clientY - rect.top - viewport.y) / viewport.scale),
    };
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/x-ignara-palette");
    if (!payload) {
      return;
    }

    const point = toWorldPoint(event.clientX, event.clientY);
    if (payload === "room") {
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `room-${Date.now()}`;
      addRoom({
        id,
        label: `Zone ${rooms.length + 1}`,
        x: point.x,
        y: point.y,
        w: 180,
        h: 120,
      });
      selectTarget({ type: "room", id });
      return;
    }

    if (payload === "prop") {
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `prop-${Date.now()}`;
      addProp({
        id,
        label: `Prop ${props.length + 1}`,
        x: point.x,
        y: point.y,
        w: 44,
        h: 44,
        fill: "rgba(244,114,182,0.35)",
      });
      selectTarget({ type: "prop", id });
    }
  }

  function handleWheel(event: KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const oldScale = viewport.scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const scaleBy = 1.06;
    const nextScale = event.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    const clampedScale = Math.max(0.5, Math.min(2.6, nextScale));

    const mousePointTo = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    };

    setViewport({
      scale: clampedScale,
      x: Math.round(pointer.x - mousePointTo.x * clampedScale),
      y: Math.round(pointer.y - mousePointTo.y * clampedScale),
    });
  }

  const connectedLocations = useMemo(
    () => locations.filter((location) => location.connected),
    [locations],
  );

  return (
    <div
      ref={wrapperRef}
      className="overflow-hidden rounded-2xl border border-outline/60 bg-panel/70 p-3 shadow-glass backdrop-blur-sm"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        draggable
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onDragEnd={(event) => setViewport({ x: Math.round(event.target.x()), y: Math.round(event.target.y()) })}
        onWheel={handleWheel}
        onMouseDown={(event) => {
          if (event.target === event.target.getStage()) {
            selectTarget(null);
          }
        }}
      >
        <Layer>
          <Rect
            x={0}
            y={0}
            width={BASE_WIDTH}
            height={BASE_HEIGHT}
            cornerRadius={16}
            fill="rgba(255,255,255,0.05)"
            stroke="rgba(140,180,210,0.35)"
            strokeWidth={2}
            onClick={() => selectTarget(null)}
          />

          {background && backgroundImage ? (
            <KonvaImage
              x={background.x}
              y={background.y}
              width={background.w}
              height={background.h}
              image={backgroundImage}
              opacity={background.opacity}
              onClick={() => selectTarget({ type: "background" })}
            />
          ) : null}

          {rooms.map((room) => {
            const selected = selectedTarget?.type === "room" && selectedTarget.id === room.id;
            return (
              <Rect
                key={room.id}
                x={room.x}
                y={room.y}
                width={room.w}
                height={room.h}
                fill="rgba(56,189,248,0.18)"
                stroke={selected ? "rgba(250,204,21,0.98)" : "rgba(56,189,248,0.95)"}
                strokeWidth={selected ? 3 : 2}
                cornerRadius={10}
                draggable
                onDragEnd={(event) => updateDraggedPosition(room.id, event)}
                onClick={() => selectTarget({ type: "room", id: room.id })}
              />
            );
          })}

          {props.map((prop) => {
            const selected = selectedTarget?.type === "prop" && selectedTarget.id === prop.id;
            return (
              <Rect
                key={prop.id}
                x={prop.x}
                y={prop.y}
                width={prop.w}
                height={prop.h}
                fill={prop.fill ?? "rgba(244,114,182,0.35)"}
                stroke={selected ? "rgba(250,204,21,0.98)" : "rgba(244,114,182,0.95)"}
                strokeWidth={selected ? 3 : 2}
                cornerRadius={8}
                draggable
                onDragEnd={(event) => updateDraggedPropPosition(prop.id, event)}
                onClick={() => selectTarget({ type: "prop", id: prop.id })}
              />
            );
          })}

          {rooms.map((room) => (
            <Text
              key={`${room.id}-label`}
              x={room.x + 8}
              y={room.y + 8}
              text={room.label}
              fontSize={14}
              fill="rgba(227,241,255,0.98)"
            />
          ))}

          {props.map((prop) => (
            <Text
              key={`${prop.id}-label`}
              x={prop.x + 6}
              y={prop.y + Math.max(3, prop.h - 18)}
              text={prop.label}
              fontSize={11}
              fill="rgba(248,250,252,0.95)"
            />
          ))}

          {connectedLocations.map((location, index) => {
            const room = rooms.find((entry) => entry.id === location.roomId);
            if (!room) {
              return null;
            }

            const markerX = room.x + 14 + (index % 4) * 18;
            const markerY = room.y + room.h - 16 - Math.floor(index / 4) * 16;

            return (
              <Fragment key={`${location.employeeId}-live`}>
                <Circle x={markerX} y={markerY} radius={6} fill="rgba(16,185,129,0.95)" />
                <Text
                  x={markerX + 9}
                  y={markerY - 6}
                  text={location.employeeId}
                  fontSize={10}
                  fill="rgba(209,250,229,0.95)"
                />
              </Fragment>
            );
          })}
        </Layer>
      </Stage>

      <p className="mt-2 text-xs text-text-dim">
        Drag Room Zone or Prop from the left panel into the canvas. Drag empty map to pan. Use mouse wheel to zoom.
      </p>
    </div>
  );
}
