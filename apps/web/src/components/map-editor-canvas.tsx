"use client";

import type { LastKnownLocation } from "@ignara/sharedtypes";
import type { KonvaEventObject } from "konva/lib/Node";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer, Group } from "react-konva";
import { useMapEditorStore } from "../store/map-editor-store";

type MapEditorCanvasProps = {
  locations: LastKnownLocation[];
};

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 720;
const MIN_STAGE_WIDTH = 320;
const MIN_STAGE_HEIGHT = 220;
const MAX_STAGE_SIDE = 4096;

const TRANSFORMER_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
];

function propFillForType(propType: string | undefined, fallback?: string) {
  if (propType === "player-male") {
    return fallback ?? "rgba(56,189,248,0.35)";
  }
  if (propType === "player-female") {
    return fallback ?? "rgba(244,114,182,0.38)";
  }
  if (propType === "beacon") {
    return fallback ?? "rgba(168,85,247,0.55)";
  }
  return fallback ?? "rgba(244,114,182,0.35)";
}

export function MapEditorCanvas({ locations }: MapEditorCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  const roomNodeRefs = useRef<Record<string, any>>({});
  const propNodeRefs = useRef<Record<string, any>>({});
  const [stageSize, setStageSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);

  const rooms = useMapEditorStore((state) => state.rooms);
  const props = useMapEditorStore((state) => state.props);
  const background = useMapEditorStore((state) => state.background);
  const viewport = useMapEditorStore((state) => state.viewport);
  const setViewport = useMapEditorStore((state) => state.setViewport);
  const canvasSize = useMapEditorStore((state) => state.canvasSize);
  const setCanvasSize = useMapEditorStore((state) => state.setCanvasSize);
  const addRoom = useMapEditorStore((state) => state.addRoom);
  const addProp = useMapEditorStore((state) => state.addProp);
  const updateRoom = useMapEditorStore((state) => state.updateRoom);
  const updateProp = useMapEditorStore((state) => state.updateProp);
  const selectTarget = useMapEditorStore((state) => state.selectTarget);
  const selectedTarget = useMapEditorStore((state) => state.selectedTarget);

  const canvasAspectRatio = useMemo(() => {
    const safeWidth = Number.isFinite(canvasSize.width) && canvasSize.width > 0 ? canvasSize.width : DEFAULT_WIDTH;
    const safeHeight = Number.isFinite(canvasSize.height) && canvasSize.height > 0 ? canvasSize.height : DEFAULT_HEIGHT;
    return safeHeight / safeWidth;
  }, [canvasSize.height, canvasSize.width]);

  useEffect(() => {
    if (!wrapperRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const nextWidth = Math.max(
        MIN_STAGE_WIDTH,
        Math.min(MAX_STAGE_SIDE, Math.floor(entry.contentRect.width)),
      );
      const nextHeight = Math.max(
        MIN_STAGE_HEIGHT,
        Math.min(MAX_STAGE_SIDE, Math.floor(nextWidth * canvasAspectRatio)),
      );

      setStageSize((previous) => {
        if (previous.width === nextWidth && previous.height === nextHeight) {
          return previous;
        }
        return { width: nextWidth, height: nextHeight };
      });
    });

    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [canvasAspectRatio]);

  useEffect(() => {
    if (!background?.dataUrl) {
      setBackgroundImage(null);
      return;
    }

    const image = new window.Image();
    image.onload = () => setBackgroundImage(image);
    image.src = background.dataUrl;
  }, [background?.dataUrl]);

  useEffect(() => {
    const clamped = clampViewport(viewport.x, viewport.y, viewport.scale);
    if (clamped.x !== viewport.x || clamped.y !== viewport.y) {
      setViewport(clamped);
    }
  }, [stageSize, viewport]);

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

  function handleRoomTransformEnd(id: string, event: KonvaEventObject<Event>) {
    const node = event.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    updateRoom(id, {
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      w: Math.max(30, Math.round(node.width() * scaleX)),
      h: Math.max(30, Math.round(node.height() * scaleY)),
      rotation: Math.round(node.rotation()),
    });
  }

  function handlePropTransformEnd(id: string, event: KonvaEventObject<Event>) {
    const node = event.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    updateProp(id, {
      x: Math.round(node.x()),
      y: Math.round(node.y()),
      w: Math.max(20, Math.round(node.width() * scaleX)),
      h: Math.max(20, Math.round(node.height() * scaleY)),
      rotation: Math.round(node.rotation()),
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

    if (
      payload === "prop" ||
      payload === "prop-player-male" ||
      payload === "prop-player-female" ||
      payload === "prop-beacon"
    ) {
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `prop-${Date.now()}`;
      const propType: "generic" | "player-male" | "player-female" | "beacon" =
        payload === "prop-player-male"
          ? "player-male"
          : payload === "prop-player-female"
            ? "player-female"
            : payload === "prop-beacon"
              ? "beacon"
              : "generic";
      const beaconIndex = props.filter((entry) => entry.propType === "beacon").length + 1;
      addProp({
        id,
        label:
          propType === "player-male"
            ? `Male Player ${props.length + 1}`
            : propType === "player-female"
              ? `Female Player ${props.length + 1}`
              : propType === "beacon"
                ? `Beacon ${beaconIndex}`
                : `Prop ${props.length + 1}`,
        propType,
        x: point.x,
        y: point.y,
        w: propType === "beacon" ? 36 : 44,
        h: propType === "beacon" ? 36 : 44,
        rotation: 0,
        fill: propFillForType(propType),
        ...(propType === "beacon"
          ? { beaconDeviceId: `beacon-${id.slice(0, 6)}`, beaconRoomId: "" }
          : {}),
      });
      selectTarget({ type: "prop", id });
    }
  }

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    if (!selectedTarget || selectedTarget.type === "background") {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const selectedNode =
      selectedTarget.type === "room"
        ? roomNodeRefs.current[selectedTarget.id]
        : propNodeRefs.current[selectedTarget.id];

    if (!selectedNode) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    transformer.nodes([selectedNode]);
    transformer.getLayer()?.batchDraw();
  }, [props, rooms, selectedTarget]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer || !selectedTarget || selectedTarget.type === "background") {
      return;
    }

    const selectedNode =
      selectedTarget.type === "room"
        ? roomNodeRefs.current[selectedTarget.id]
        : propNodeRefs.current[selectedTarget.id];

    if (selectedNode) {
      transformer.nodes([selectedNode]);
      transformer.getLayer()?.batchDraw();
    }
  }, [selectedTarget]);

  function clampViewport(x: number, y: number, scale: number) {
    const baseWidth = canvasSize.width;
    const baseHeight = canvasSize.height;
    const minX = Math.min(0, stageSize.width - baseWidth * scale);
    const maxX = Math.max(0, stageSize.width - baseWidth * scale);
    const minY = Math.min(0, stageSize.height - baseHeight * scale);
    const maxY = Math.max(0, stageSize.height - baseHeight * scale);

    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
      scale,
    };
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

    const newX = Math.round(pointer.x - mousePointTo.x * clampedScale);
    const newY = Math.round(pointer.y - mousePointTo.y * clampedScale);
    const clamped = clampViewport(newX, newY, clampedScale);

    setViewport(clamped);
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
        onDragEnd={(event) => {
          const clamped = clampViewport(
            Math.round(event.target.x()),
            Math.round(event.target.y()),
            viewport.scale,
          );
          setViewport(clamped);
        }}
        onWheel={handleWheel}
        onMouseDown={(event) => {
          if (event.target === event.target.getStage()) {
            selectTarget(null);
          }
        }}
        onTap={(event) => {
          if (event.target === event.target.getStage()) {
            selectTarget(null);
          }
        }}
      >
        <Layer>
          <Rect
            x={0}
            y={0}
            width={canvasSize.width}
            height={canvasSize.height}
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
              onTap={() => selectTarget({ type: "background" })}
            />
          ) : null}

          {rooms.map((room) => {
            const selected = selectedTarget?.type === "room" && selectedTarget.id === room.id;
            return (
              <Rect
                key={room.id}
                ref={(node) => {
                  if (node) {
                    roomNodeRefs.current[room.id] = node;
                  } else {
                    delete roomNodeRefs.current[room.id];
                  }
                }}
                x={room.x}
                y={room.y}
                width={room.w}
                height={room.h}
                rotation={room.rotation ?? 0}
                fill="rgba(56,189,248,0.18)"
                stroke={selected ? "rgba(250,204,21,0.98)" : "rgba(56,189,248,0.95)"}
                strokeWidth={selected ? 3 : 2}
                cornerRadius={10}
                draggable
                onDragEnd={(event) => updateDraggedPosition(room.id, event)}
                onTransformEnd={(event) => handleRoomTransformEnd(room.id, event)}
                onClick={() => selectTarget({ type: "room", id: room.id })}
                onTap={() => selectTarget({ type: "room", id: room.id })}
              />
            );
          })}

          {props.map((prop) => {
            const selected = selectedTarget?.type === "prop" && selectedTarget.id === prop.id;
            return (
              <Rect
                key={prop.id}
                ref={(node) => {
                  if (node) {
                    propNodeRefs.current[prop.id] = node;
                  } else {
                    delete propNodeRefs.current[prop.id];
                  }
                }}
                x={prop.x}
                y={prop.y}
                width={prop.w}
                height={prop.h}
                rotation={prop.rotation ?? 0}
                fill={propFillForType(prop.propType, prop.fill)}
                stroke={selected ? "rgba(250,204,21,0.98)" : "rgba(244,114,182,0.95)"}
                strokeWidth={selected ? 3 : 2}
                cornerRadius={8}
                draggable
                onDragEnd={(event) => updateDraggedPropPosition(prop.id, event)}
                onTransformEnd={(event) => handlePropTransformEnd(prop.id, event)}
                onClick={() => selectTarget({ type: "prop", id: prop.id })}
                onTap={() => selectTarget({ type: "prop", id: prop.id })}
              />
            );
          })}

          {rooms.map((room) => (
            <Fragment key={`${room.id}-label`}>
              <Text
                x={room.x + 8}
                y={room.y + 8}
                text={room.label}
                fontSize={14}
                fill="rgba(227,241,255,0.98)"
              />
              {(room.beaconIds && room.beaconIds.length > 0) || room.beaconId ? (
                <Group x={room.x + room.w - 32} y={room.y + 8}>
                  <Circle radius={10} fill="rgba(168,85,247,0.9)" />
                  <Text
                    x={-6}
                    y={-7}
                    text="📶"
                    fontSize={14}
                  />
                  <Text
                    x={-20}
                    y={14}
                    text={(room.beaconId || room.beaconIds?.[0] || "").slice(0, 12)}
                    fontSize={8}
                    fill="rgba(216,180,254,0.95)"
                    width={40}
                    align="center"
                  />
                </Group>
              ) : null}
            </Fragment>
          ))}

          {props.map((prop) => (
            <Fragment key={`${prop.id}-label`}>
              <Text
                x={prop.x + 6}
                y={prop.y + Math.max(3, prop.h - 18)}
                text={
                  prop.propType === "player-male"
                    ? `${prop.label} (M)`
                    : prop.propType === "player-female"
                      ? `${prop.label} (F)`
                      : prop.propType === "beacon"
                        ? `📡 ${prop.label}`
                        : prop.label
                }
                fontSize={11}
                fill="rgba(248,250,252,0.95)"
              />
              {prop.propType === "beacon" && prop.beaconDeviceId ? (
                <Text
                  x={prop.x + 6}
                  y={prop.y + 6}
                  text={prop.beaconDeviceId.slice(0, 12)}
                  fontSize={9}
                  fill="rgba(216,180,254,0.9)"
                />
              ) : null}
            </Fragment>
          ))}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            enabledAnchors={TRANSFORMER_ANCHORS}
            boundBoxFunc={(_oldBox, newBox) => {
              const minSize = 18;
              if (Math.abs(newBox.width) < minSize || Math.abs(newBox.height) < minSize) {
                return _oldBox;
              }
              return newBox;
            }}
          />

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
        Tap or click shapes to select, then drag, resize, or rotate with handles. Drag empty map to pan and use mouse wheel to zoom.
      </p>
    </div>
  );
}
