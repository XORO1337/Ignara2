import type { RoomZone } from "@ignara/sharedtypes";

export type MapPropType = "generic" | "player-male" | "player-female";

export type MapPropElement = {
  id: string;
  label: string;
  propType: MapPropType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  fill?: string;
};

export type MapBackgroundConfig = {
  dataUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
};

type PersistedMap = {
  id: string;
  orgId: string;
  name: string;
  jsonConfig?: Record<string, unknown> | null;
};

function toNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePropType(value: unknown): MapPropType {
  if (value === "player-male" || value === "player-female") {
    return value;
  }
  return "generic";
}

export function parseRoomsFromMapConfig(jsonConfig: Record<string, unknown> | null | undefined): RoomZone[] {
  const roomsValue = jsonConfig?.rooms;
  if (!Array.isArray(roomsValue)) {
    return [];
  }

  const parsedRooms: RoomZone[] = [];

  roomsValue.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : `room-${index + 1}`;
    const label = typeof candidate.label === "string" ? candidate.label : id;

    parsedRooms.push({
      id,
      label,
      scannerDeviceId: typeof candidate.scannerDeviceId === "string" ? candidate.scannerDeviceId : undefined,
      beaconId: typeof candidate.beaconId === "string" ? candidate.beaconId : undefined,
      beaconIds: parseStringArray(candidate.beaconIds),
      x: toNumber(candidate.x, 60 + index * 18),
      y: toNumber(candidate.y, 60 + index * 14),
      w: toNumber(candidate.w, 140),
      h: toNumber(candidate.h, 90),
      rotation: toNumber(candidate.rotation, 0),
    });
  });

  return parsedRooms;
}

function parsePropsFromMapConfig(jsonConfig: Record<string, unknown> | null | undefined): MapPropElement[] {
  const propsValue = jsonConfig?.props;
  if (!Array.isArray(propsValue)) {
    return [];
  }

  const parsedProps: MapPropElement[] = [];

  propsValue.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id : `prop-${index + 1}`;
    const label = typeof candidate.label === "string" ? candidate.label : `Prop ${index + 1}`;

    parsedProps.push({
      id,
      label,
      propType: parsePropType(candidate.propType),
      x: toNumber(candidate.x, 120 + index * 16),
      y: toNumber(candidate.y, 120 + index * 16),
      w: toNumber(candidate.w, 42),
      h: toNumber(candidate.h, 42),
      rotation: toNumber(candidate.rotation, 0),
      fill: typeof candidate.fill === "string" ? candidate.fill : "rgba(244,114,182,0.35)",
    });
  });

  return parsedProps;
}

export function parseBackgroundFromMapConfig(
  jsonConfig: Record<string, unknown> | null | undefined,
): MapBackgroundConfig | null {
  const value = jsonConfig?.background;
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.dataUrl !== "string" || !candidate.dataUrl) {
    return null;
  }

  return {
    dataUrl: candidate.dataUrl,
    x: toNumber(candidate.x, 0),
    y: toNumber(candidate.y, 0),
    w: toNumber(candidate.w, 960),
    h: toNumber(candidate.h, 560),
    opacity: Math.max(0.1, Math.min(1, toNumber(candidate.opacity, 0.9))),
  };
}

export function parseMapEditorData(jsonConfig: Record<string, unknown> | null | undefined) {
  return {
    rooms: parseRoomsFromMapConfig(jsonConfig),
    props: parsePropsFromMapConfig(jsonConfig),
    background: parseBackgroundFromMapConfig(jsonConfig),
  };
}

export function pickActiveMap(maps: PersistedMap[]): PersistedMap | null {
  if (maps.length === 0) {
    return null;
  }

  return maps[0];
}
