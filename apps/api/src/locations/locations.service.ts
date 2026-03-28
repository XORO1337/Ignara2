import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { LastKnownLocation, ScannerLocationEvent } from "@ignara/sharedtypes";
import Redis from "ioredis";
import mqtt, { MqttClient } from "mqtt";
import { LocationsGateway } from "./locations.gateway";

@Injectable()
export class LocationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LocationsService.name);
  private readonly redis: Redis;
  private readonly mqttClient: MqttClient;

  constructor(private readonly gateway: LocationsGateway) {
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
        if (!this.isValidEvent(payload)) {
          this.logger.warn("Ignored invalid location payload");
          return;
        }

        await this.handleEvent(payload);
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
        const candidate = JSON.parse(entry) as Partial<LastKnownLocation>;
        if (!candidate?.orgId || !candidate?.employeeId || !candidate?.roomId || typeof candidate.ts !== "number") {
          continue;
        }

        parsed.push({
          orgId: candidate.orgId,
          employeeId: candidate.employeeId,
          roomId: candidate.roomId,
          scannerId: candidate.scannerId ?? "unknown-scanner",
          connected: candidate.connected ?? true,
          lastEvent: candidate.lastEvent ?? "enter",
          disconnectedAt: candidate.disconnectedAt,
          ts: candidate.ts,
        });
      } catch {
        this.logger.warn("Skipped malformed location value in Redis");
      }
    }

    return parsed.sort((a, b) => b.ts - a.ts);
  }

  private async handleEvent(event: ScannerLocationEvent) {
    const orgId = event.orgId ?? "default-org";
    const ts = event.ts ?? Date.now();
    const key = `ignara:loc:${orgId}:${event.employeeId}`;
    const previousRaw = await this.redis.get(key);

    let previous: LastKnownLocation | null = null;
    if (previousRaw) {
      try {
        previous = JSON.parse(previousRaw) as LastKnownLocation;
      } catch {
        previous = null;
      }
    }

    const lastKnownRoom = previous?.roomId ?? event.roomId;

    const location: LastKnownLocation = {
      orgId,
      employeeId: event.employeeId,
      roomId: event.event === "enter" ? event.roomId : lastKnownRoom,
      scannerId: event.scannerId,
      connected: event.event === "enter",
      lastEvent: event.event,
      disconnectedAt: event.event === "exit" ? ts : undefined,
      ts,
    };

    // Persist only enter events so current location reflects last known presence.
    if (event.event === "enter") {
      await this.redis.set(key, JSON.stringify(location));
    }

    this.gateway.emitOrgLocation(orgId, location);
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
