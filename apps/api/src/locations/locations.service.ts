import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { EmployeePresenceEvent, LastKnownLocation, ScannerLocationEvent } from "@ignara/sharedtypes";
import Redis from "ioredis";
import mqtt, { MqttClient } from "mqtt";
import { Repository } from "typeorm";
import { MapEntity } from "../entities/map.entity";
import { UserEntity } from "../entities/user.entity";
import { LocationsGateway } from "./locations.gateway";

const DEFAULT_BEACON_CACHE_TTL_MS = 10_000;
const DEFAULT_EMPLOYEE_ROLE_CACHE_TTL_MS = 10_000;

type BeaconCacheValue = {
  updatedAt: number;
  roomByBeaconId: Record<string, string>;
};

type EmployeeRoleCacheValue = {
  updatedAt: number;
  employeeIds: Set<string>;
};

type RoomIdCacheValue = {
  updatedAt: number;
  roomIds: Set<string>;
};

@Injectable()
export class LocationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LocationsService.name);
  private readonly redis: Redis;
  private readonly mqttClient: MqttClient;
  private readonly beaconCache = new Map<string, BeaconCacheValue>();
  private readonly employeeRoleCache = new Map<string, EmployeeRoleCacheValue>();
  private readonly roomIdCache = new Map<string, RoomIdCacheValue>();
  private readonly beaconCacheTtlMs = Number(process.env.LOCATION_BEACON_CACHE_TTL_MS ?? DEFAULT_BEACON_CACHE_TTL_MS);
  private readonly employeeRoleCacheTtlMs = Number(
    process.env.LOCATION_EMPLOYEE_ROLE_CACHE_TTL_MS ?? DEFAULT_EMPLOYEE_ROLE_CACHE_TTL_MS,
  );

  constructor(
    private readonly gateway: LocationsGateway,
    @InjectRepository(MapEntity)
    private readonly mapsRepository: Repository<MapEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {
    this.redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    this.mqttClient = mqtt.connect(process.env.MQTT_URL ?? "mqtt://localhost:1883");
  }

  onModuleInit() {
    this.mqttClient.on("connect", () => {
      this.logger.log("Connected to MQTT broker");
      this.mqttClient.subscribe("ignara/location/+", (error) => {
        if (error) {
          this.logger.error("MQTT subscribe failed", error.message);
        }
      });
    });

    this.mqttClient.on("message", async (_topic, payloadBuffer) => {
      try {
        const payload = JSON.parse(payloadBuffer.toString()) as Partial<ScannerLocationEvent>;
        await this.ingestScannerEvent(payload);
      } catch (error) {
        this.logger.error("Failed to process location payload", String(error));
      }
    });
  }

  async onModuleDestroy() {
    this.mqttClient.end(true);
    await this.redis.quit();
  }

  async getCurrentByOrg(orgId: string): Promise<LastKnownLocation[]> {
    const pattern = `ignara:loc:${orgId}:*`;
    const keys: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    if (keys.length === 0) {
      return [];
    }

    const values = await this.redis.mget(keys);
    const parsed: LastKnownLocation[] = [];
    for (const entry of values) {
      if (!entry) {
        continue;
      }

      try {
        const location = this.parseStoredLocation(entry);
        if (location) {
          parsed.push(location);
        }
      } catch {
        this.logger.warn("Skipped malformed location value in Redis");
      }
    }

    const employeeIds = await this.getEmployeeEmailSet(orgId);
    return parsed
      .filter((location) => employeeIds.has(location.employeeId))
      .sort((a, b) => b.ts - a.ts);
  }

  async movePlayer(input: {
    orgId: string;
    employeeId: string;
    roomId?: string;
    x: number;
    y: number;
  }): Promise<LastKnownLocation> {
    const key = this.locationKey(input.orgId, input.employeeId);
    const previous = await this.getLocationByKey(key);
    const roomId = input.roomId ?? previous?.roomId;

    if (!roomId) {
      throw new BadRequestException("roomId is required before player movement can be persisted");
    }

    await this.assertValidRoomId(input.orgId, roomId);

    const ts = Date.now();
    const location: LastKnownLocation = {
      orgId: input.orgId,
      employeeId: input.employeeId,
      roomId,
      scannerId: previous?.scannerId ?? "manual-input",
      connected: true,
      lastEvent: "enter",
      x: Math.round(input.x),
      y: Math.round(input.y),
      movementSource: "wasd",
      signalSource: "manual",
      beaconId: previous?.beaconId,
      beaconRssi: previous?.beaconRssi,
      proximityScore: previous?.proximityScore,
      signalLostAt: undefined,
      disconnectedAt: undefined,
      ts,
    };

    await this.redis.set(key, JSON.stringify(location));
    await this.emitLocationIfEmployee(location, previous, "manual");
    return location;
  }

  async ingestScannerEvent(event: Partial<ScannerLocationEvent>) {
    if (!this.isValidEvent(event)) {
      throw new BadRequestException("Invalid scanner location payload");
    }

    await this.handleEvent({
      ...event,
      sourceType: "ble",
    });
  }

  private async handleEvent(event: ScannerLocationEvent) {
    const orgId = event.orgId ?? "default-org";
    const ts = event.ts ?? Date.now();
    const key = this.locationKey(orgId, event.employeeId);
    const previous = await this.getLocationByKey(key);

    // Explicit disconnections are authoritative and must not be overturned by scanner telemetry.
    if (previous && !previous.connected) {
      return;
    }

    const inferredRoomId = await this.resolveRoomFromBeacon(orgId, event.beaconId, event.roomId);
    const lastKnownRoom = previous?.roomId ?? inferredRoomId;
    let resolvedRoomId = event.event === "enter" ? inferredRoomId : lastKnownRoom;
    const roomIds = await this.getRoomIdSet(orgId);

    if (roomIds.size > 0 && !roomIds.has(resolvedRoomId)) {
      const fallbackRoomId =
        previous?.roomId && roomIds.has(previous.roomId)
          ? previous.roomId
          : null;

      if (!fallbackRoomId) {
        this.logger.warn(
          `Ignored scanner event with unknown roomId "${resolvedRoomId}" for ${event.employeeId}`,
        );
        return;
      }

      resolvedRoomId = fallbackRoomId;
    }

    const location: LastKnownLocation = {
      orgId,
      employeeId: event.employeeId,
      roomId: resolvedRoomId,
      scannerId: event.scannerId,
      connected: true,
      lastEvent: event.event,
      x: previous?.x,
      y: previous?.y,
      movementSource: previous?.movementSource,
      signalSource: event.sourceType ?? "ble",
      beaconId: event.beaconId,
      beaconRssi: event.beaconRssi,
      proximityScore: event.proximityScore,
      signalLostAt: undefined,
      disconnectedAt: undefined,
      ts,
    };

    await this.redis.set(key, JSON.stringify(location));
    await this.emitLocationIfEmployee(location, previous, "scanner");
  }

  async disconnectEmployee(input: {
    orgId: string;
    employeeId: string;
    reason?: EmployeePresenceEvent["reason"];
  }): Promise<LastKnownLocation> {
    const key = this.locationKey(input.orgId, input.employeeId);
    const previous = await this.getLocationByKey(key);
    if (!previous) {
      throw new BadRequestException("No known location found for this employee.");
    }

    if (!previous.connected) {
      this.gateway.emitOrgLocation(previous.orgId, previous);
      return previous;
    }

    const now = Date.now();
    const disconnectedLocation: LastKnownLocation = {
      ...previous,
      connected: false,
      lastEvent: "exit",
      signalSource: "manual",
      signalLostAt: now,
      disconnectedAt: now,
      ts: now,
    };

    await this.redis.set(key, JSON.stringify(disconnectedLocation));
    await this.emitLocationIfEmployee(disconnectedLocation, previous, input.reason ?? "manual");
    return disconnectedLocation;
  }

  private async emitLocationIfEmployee(
    location: LastKnownLocation,
    previous: LastKnownLocation | null = null,
    reason: EmployeePresenceEvent["reason"] = "scanner",
  ) {
    const employeeIds = await this.getEmployeeEmailSet(location.orgId);
    if (!employeeIds.has(location.employeeId)) {
      return;
    }

    this.gateway.emitOrgLocation(location.orgId, location);

    const wasConnected = previous?.connected ?? false;
    if (location.connected === wasConnected) {
      return;
    }

    this.gateway.emitOrgPresence(location.orgId, {
      orgId: location.orgId,
      employeeId: location.employeeId,
      roomId: location.roomId,
      action: location.connected ? "joined" : "left",
      ts: location.ts,
      reason,
    });
  }

  private async getEmployeeEmailSet(orgId: string): Promise<Set<string>> {
    const now = Date.now();
    const cached = this.employeeRoleCache.get(orgId);
    if (cached && now - cached.updatedAt < this.employeeRoleCacheTtlMs) {
      return cached.employeeIds;
    }

    const rows = await this.usersRepository
      .createQueryBuilder("user")
      .select("user.email", "email")
      .where("user.orgId = :orgId", { orgId })
      .andWhere("user.role = :role", { role: "employee" })
      .getRawMany<{ email: string }>();

    const employeeIds = new Set(rows.map((entry) => entry.email));
    this.employeeRoleCache.set(orgId, {
      updatedAt: now,
      employeeIds,
    });

    return employeeIds;
  }

  private async assertValidRoomId(orgId: string, roomId: string) {
    const roomIds = await this.getRoomIdSet(orgId);
    if (roomIds.size > 0 && !roomIds.has(roomId)) {
      throw new BadRequestException(`Unknown roomId: ${roomId}`);
    }
  }

  private locationKey(orgId: string, employeeId: string) {
    return `ignara:loc:${orgId}:${employeeId}`;
  }

  private async getLocationByKey(key: string): Promise<LastKnownLocation | null> {
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }

    return this.parseStoredLocation(raw);
  }

  private parseStoredLocation(raw: string): LastKnownLocation | null {
    let candidate: Partial<LastKnownLocation>;
    try {
      candidate = JSON.parse(raw) as Partial<LastKnownLocation>;
    } catch {
      return null;
    }

    if (!candidate?.orgId || !candidate?.employeeId || !candidate?.roomId || typeof candidate.ts !== "number") {
      return null;
    }

    const movementSource =
      candidate.movementSource === "wasd" ||
      candidate.movementSource === "drag" ||
      candidate.movementSource === "scanner"
        ? candidate.movementSource
        : undefined;
    const signalSource =
      candidate.signalSource === "ble" ||
      candidate.signalSource === "manual"
        ? candidate.signalSource
        : undefined;

    return {
      orgId: candidate.orgId,
      employeeId: candidate.employeeId,
      roomId: candidate.roomId,
      scannerId: candidate.scannerId ?? "unknown-scanner",
      connected: typeof candidate.connected === "boolean" ? candidate.connected : true,
      lastEvent: candidate.lastEvent === "exit" ? "exit" : "enter",
      x: typeof candidate.x === "number" && Number.isFinite(candidate.x) ? candidate.x : undefined,
      y: typeof candidate.y === "number" && Number.isFinite(candidate.y) ? candidate.y : undefined,
      movementSource,
      signalSource,
      beaconId: candidate.beaconId,
      beaconRssi:
        typeof candidate.beaconRssi === "number" && Number.isFinite(candidate.beaconRssi)
          ? candidate.beaconRssi
          : undefined,
      proximityScore:
        typeof candidate.proximityScore === "number" && Number.isFinite(candidate.proximityScore)
          ? candidate.proximityScore
          : undefined,
      signalLostAt:
        typeof candidate.signalLostAt === "number" && Number.isFinite(candidate.signalLostAt)
          ? candidate.signalLostAt
          : undefined,
      disconnectedAt:
        typeof candidate.disconnectedAt === "number" && Number.isFinite(candidate.disconnectedAt)
          ? candidate.disconnectedAt
          : undefined,
      ts: candidate.ts,
    };
  }

  private async resolveRoomFromBeacon(orgId: string, beaconId: string | undefined, fallbackRoomId: string): Promise<string> {
    if (!beaconId) {
      return fallbackRoomId;
    }

    const cache = await this.getBeaconRoomCache(orgId);
    return cache[beaconId] ?? fallbackRoomId;
  }

  private async getBeaconRoomCache(orgId: string): Promise<Record<string, string>> {
    const now = Date.now();
    const cached = this.beaconCache.get(orgId);
    if (cached && now - cached.updatedAt < this.beaconCacheTtlMs) {
      return cached.roomByBeaconId;
    }

    const maps = await this.mapsRepository.find({ where: { orgId } });
    const roomByBeaconId: Record<string, string> = {};

    maps.forEach((map) => {
      const mapConfig = map.jsonConfig;
      const rooms = mapConfig?.rooms;
      if (!Array.isArray(rooms)) {
        return;
      }

      rooms.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }

        const candidate = entry as Record<string, unknown>;
        const roomId = typeof candidate.id === "string" ? candidate.id : null;
        if (!roomId) {
          return;
        }

        if (typeof candidate.beaconId === "string" && candidate.beaconId.trim()) {
          roomByBeaconId[candidate.beaconId.trim()] = roomId;
        }

        if (Array.isArray(candidate.beaconIds)) {
          candidate.beaconIds.forEach((value) => {
            if (typeof value === "string" && value.trim()) {
              roomByBeaconId[value.trim()] = roomId;
            }
          });
        }
      });
    });

    this.beaconCache.set(orgId, {
      updatedAt: now,
      roomByBeaconId,
    });

    return roomByBeaconId;
  }

  private async getRoomIdSet(orgId: string): Promise<Set<string>> {
    const now = Date.now();
    const cached = this.roomIdCache.get(orgId);
    if (cached && now - cached.updatedAt < this.beaconCacheTtlMs) {
      return cached.roomIds;
    }

    const maps = await this.mapsRepository.find({ where: { orgId } });
    const roomIds = new Set<string>();

    maps.forEach((map) => {
      const rooms = map.jsonConfig?.rooms;
      if (!Array.isArray(rooms)) {
        return;
      }

      rooms.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }

        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.id === "string" && candidate.id.trim()) {
          roomIds.add(candidate.id.trim());
        }
      });
    });

    this.roomIdCache.set(orgId, {
      updatedAt: now,
      roomIds,
    });

    return roomIds;
  }

  private isValidEvent(event: Partial<ScannerLocationEvent>): event is ScannerLocationEvent {
    return Boolean(
      event.employeeId &&
        event.scannerId &&
        event.roomId &&
        typeof event.rssi === "number" &&
        (event.event === "enter" || event.event === "exit"),
    );
  }
}
