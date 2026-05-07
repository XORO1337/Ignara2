import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import type {
  BleBeaconConfig,
  BleBeaconStatus,
  BleProximityReportPayload,
  BleTagConnection,
  BleTagRegistrationPayload,
  RoomBeaconNotification,
  RoomBeaconNotifyRequest,
  RoomBeaconReportPayload,
  ScannerLocationEvent,
} from "@ignara/sharedtypes";
import { LocationsService } from "../locations/locations.service";
import { DevicesService } from "../devices/devices.service";

const DEFAULT_RSSI_THRESHOLD = -70;
const DEFAULT_ADVERTISE_NAME = "IgnaraBeacon";
const EXIT_TIMEOUT_MS = 10_000; // 10 seconds without update = exit
const RSSI_HYSTERESIS_COUNT = 3; // Number of consecutive readings to confirm state change
// An observation is considered fresh for this long before it's ignored when
// comparing RSSI across beacons. Must be greater than the beacons' report
// interval so a single skipped report doesn't flip the winning room.
const OBSERVATION_TTL_MS = 12_000;
// Stickiness margin (in dB) — a challenger beacon must beat the current
// winning beacon by this much to flip the employee's room assignment, which
// damps oscillation when the user is roughly equidistant between two rooms.
const SWITCH_MARGIN_DB = 3;

type TagState = {
  connection: BleTagConnection;
  lastEvent: "enter" | "exit" | null;
  rssiReadings: number[];
  exitTimer: NodeJS.Timeout | null;
};

type RoomBeaconState = {
  beaconDeviceId: string;
  roomId: string;
  orgId?: string;
  lastReportAt: number;
  lastReadings: number;
};

type BeaconObservation = {
  rssi: number;
  ts: number;
  deviceId: string;
  employeeId?: string;
};

type EmployeePresence = {
  beaconDeviceId: string;
  roomId: string;
  rssi: number;
};

@Injectable()
export class BleBeaconService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BleBeaconService.name);
  private readonly tags = new Map<string, TagState>();
  private readonly roomBeacons = new Map<string, RoomBeaconState>();
  private readonly pendingNotifications = new Map<string, RoomBeaconNotification[]>();
  // Per-beacon map: employeeKey -> latest observation from that beacon.
  private readonly beaconObservations = new Map<string, Map<string, BeaconObservation>>();
  // Global winner: which beacon/room currently owns each employee.
  private readonly employeePresence = new Map<string, EmployeePresence>();
  private config: BleBeaconConfig | null = null;
  private isAdvertising = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly locationsService: LocationsService,
    private readonly devicesService: DevicesService,
  ) {}

  async onModuleInit() {
    const enabled = this.configService.get<string>("BLE_BEACON_ENABLED", "false") === "true";

    if (!enabled) {
      this.logger.log("BLE beacon disabled via BLE_BEACON_ENABLED=false");
      return;
    }

    const deviceId = this.configService.get<string>("BLE_BEACON_DEVICE_ID", "server-beacon");
    const roomId = this.configService.get<string>("BLE_BEACON_ROOM_ID", "");
    const orgId = this.configService.get<string>("ORG_ID", "default-org");
    const rssiThreshold = Number(this.configService.get<string>("BLE_BEACON_RSSI_THRESHOLD", String(DEFAULT_RSSI_THRESHOLD)));
    const advertiseName = this.configService.get<string>("BLE_BEACON_ADVERTISE_NAME", DEFAULT_ADVERTISE_NAME);

    if (!roomId) {
      this.logger.warn("BLE_BEACON_ROOM_ID not set, beacon will not generate location events");
    }

    this.config = {
      deviceId,
      roomId,
      orgId,
      rssiThreshold: Number.isFinite(rssiThreshold) ? rssiThreshold : DEFAULT_RSSI_THRESHOLD,
      advertiseName,
    };

    // Register server beacon as virtual scanner device
    try {
      await this.devicesService.registerServerBeacon({
        deviceId: this.config.deviceId,
        orgId: this.config.orgId,
        roomId: this.config.roomId,
      });
      this.logger.log(`Registered server beacon as virtual device: ${this.config.deviceId}`);
    } catch (error) {
      this.logger.warn(`Failed to register server beacon device: ${String(error)}`);
    }

    // Start simulated advertising (no real BLE hardware required)
    this.startAdvertising();
  }

  onModuleDestroy() {
    this.stopAdvertising();
    
    // Clear all exit timers
    for (const state of this.tags.values()) {
      if (state.exitTimer) {
        clearTimeout(state.exitTimer);
      }
    }
    this.tags.clear();
  }

  private startAdvertising() {
    if (!this.config || this.isAdvertising) {
      return;
    }

    this.isAdvertising = true;
    this.logger.log(`[MOCK] BLE advertising started as "${this.config.advertiseName}"`);
    this.logger.log(`[MOCK] Service UUID: 8f240001-6f8d-4f13-a42a-8434f84f0001`);
    this.logger.log(`[MOCK] This is a simulation mode - no real Bluetooth hardware used`);
    this.logger.log(`[MOCK] Use POST /ble-beacon/simulate/tag and /proximity to test`);
  }

  private stopAdvertising() {
    if (this.isAdvertising) {
      this.isAdvertising = false;
      this.logger.log("[MOCK] BLE advertising stopped");
    }
  }

  // Public method to simulate tag registration (called from controller)
  simulateTagRegistration(payload: BleTagRegistrationPayload): void {
    this.logger.log(`[MOCK] Tag registration received: ${payload.deviceId}`);
    this.handleTagRegistration(payload);
  }

  // Public method to simulate proximity report (called from controller)
  simulateProximityReport(payload: BleProximityReportPayload): void {
    this.logger.log(`[MOCK] Proximity report received: ${payload.deviceId} (RSSI: ${payload.rssi})`);
    this.handleProximityReport(payload);
  }

  private handleTagRegistration(payload: BleTagRegistrationPayload) {
    const existing = this.tags.get(payload.deviceId);
    
    if (existing) {
      // Update existing registration
      existing.connection.employeeId = payload.employeeId;
      existing.connection.connected = true;
      this.logger.log(`Tag re-registered: ${payload.deviceId}`);
    } else {
      // New tag registration
      const connection: BleTagConnection = {
        deviceId: payload.deviceId,
        employeeId: payload.employeeId,
        rssi: -100, // Start with very weak signal
        lastSeen: Date.now(),
        connected: true,
      };

      this.tags.set(payload.deviceId, {
        connection,
        lastEvent: null,
        rssiReadings: [],
        exitTimer: null,
      });

      this.logger.log(`New tag registered: ${payload.deviceId} (employee: ${payload.employeeId ?? "none"})`);
    }

    this.updateGattStatus();
  }

  private handleProximityReport(payload: BleProximityReportPayload) {
    const state = this.tags.get(payload.deviceId);

    if (!state) {
      this.logger.warn(`Proximity report from unregistered tag: ${payload.deviceId}`);
      return;
    }

    const now = payload.timestamp ?? Date.now();
    state.connection.rssi = payload.rssi;
    state.connection.lastSeen = now;
    state.connection.connected = true;

    // Clear exit timer
    if (state.exitTimer) {
      clearTimeout(state.exitTimer);
      state.exitTimer = null;
    }

    // Track RSSI readings for hysteresis
    state.rssiReadings.push(payload.rssi);
    if (state.rssiReadings.length > RSSI_HYSTERESIS_COUNT) {
      state.rssiReadings.shift();
    }

    // Determine proximity state with hysteresis
    const avgRssi = this.calculateAverageRssi(state.rssiReadings);
    const shouldBeInRoom = avgRssi >= (this.config?.rssiThreshold ?? DEFAULT_RSSI_THRESHOLD);

    this.processProximityState(state, shouldBeInRoom);

    // Set exit timer
    state.exitTimer = setTimeout(() => {
      this.handleTagTimeout(payload.deviceId);
    }, EXIT_TIMEOUT_MS);
  }

  private processProximityState(state: TagState, shouldBeInRoom: boolean) {
    if (!this.config?.roomId) {
      return;
    }

    const currentEvent = shouldBeInRoom ? "enter" : "exit";

    // Only emit if state changed
    if (state.lastEvent === currentEvent) {
      return;
    }

    // Require hysteresis confirmation
    if (state.rssiReadings.length < RSSI_HYSTERESIS_COUNT) {
      return;
    }

    state.lastEvent = currentEvent;

    const event: ScannerLocationEvent = {
      employeeId: state.connection.employeeId ?? state.connection.deviceId,
      scannerId: this.config.deviceId,
      roomId: this.config.roomId,
      rssi: state.connection.rssi,
      event: currentEvent,
      orgId: this.config.orgId,
      sourceType: "ble",
      ts: Date.now(),
    };

    this.logger.log(`Tag ${state.connection.deviceId} ${currentEvent} event (RSSI: ${state.connection.rssi}, avg: ${Math.round(this.calculateAverageRssi(state.rssiReadings))})`);

    // Feed to locations service
    this.locationsService.ingestScannerEvent(event).catch((error) => {
      this.logger.error(`Failed to ingest location event: ${String(error)}`);
    });
  }

  private handleTagTimeout(deviceId: string) {
    const state = this.tags.get(deviceId);
    if (!state) {
      return;
    }

    this.logger.log(`Tag ${deviceId} timed out, generating exit event`);
    state.connection.connected = false;

    if (state.lastEvent === "enter" && this.config?.roomId) {
      const event: ScannerLocationEvent = {
        employeeId: state.connection.employeeId ?? state.connection.deviceId,
        scannerId: this.config.deviceId,
        roomId: this.config.roomId,
        rssi: -100,
        event: "exit",
        orgId: this.config.orgId,
        sourceType: "ble",
        ts: Date.now(),
      };

      state.lastEvent = "exit";

      this.locationsService.ingestScannerEvent(event).catch((error) => {
        this.logger.error(`Failed to ingest exit event: ${String(error)}`);
      });
    }

    this.updateGattStatus();
  }

  private calculateAverageRssi(readings: number[]): number {
    if (readings.length === 0) {
      return -100;
    }
    return readings.reduce((sum, r) => sum + r, 0) / readings.length;
  }

  private updateGattStatus() {
    if (!this.config) {
      return;
    }

    const connectedCount = Array.from(this.tags.values()).filter((t) => t.connection.connected).length;
    
    if (this.isAdvertising) {
      this.logger.debug(`[MOCK] Beacon status - connected tags: ${connectedCount}`);
    }
  }

  // Public API for status queries
  getStatus(): BleBeaconStatus | null {
    if (!this.config) {
      return null;
    }

    return {
      deviceId: this.config.deviceId,
      roomId: this.config.roomId,
      orgId: this.config.orgId,
      active: this.isAdvertising,
      connectedTags: Array.from(this.tags.values()).filter((t) => t.connection.connected).length,
      rssiThreshold: this.config.rssiThreshold,
    };
  }

  getConnectedTags(): BleTagConnection[] {
    return Array.from(this.tags.values())
      .filter((t) => t.connection.connected)
      .map((t) => t.connection);
  }

  // ---- Room Beacon (room-mounted ESP32) ingest + notification queue ----

  ingestRoomBeaconReport(payload: RoomBeaconReportPayload) {
    if (!payload || typeof payload.beaconDeviceId !== "string" || typeof payload.roomId !== "string") {
      throw new Error("Invalid room-beacon report payload");
    }

    const now = Date.now();
    const existing = this.roomBeacons.get(payload.beaconDeviceId);
    const state: RoomBeaconState = existing ?? {
      beaconDeviceId: payload.beaconDeviceId,
      roomId: payload.roomId,
      orgId: payload.orgId,
      lastReportAt: now,
      lastReadings: 0,
    };

    state.roomId = payload.roomId;
    state.orgId = payload.orgId ?? state.orgId;
    state.lastReportAt = now;
    state.lastReadings = Array.isArray(payload.readings) ? payload.readings.length : 0;
    this.roomBeacons.set(payload.beaconDeviceId, state);

    const readings = Array.isArray(payload.readings) ? payload.readings : [];

    // Upsert this beacon's observations. Employees absent from the current
    // report are dropped from this beacon's map so they no longer count
    // toward its RSSI when arbitrating the winning room.
    const beaconMap = this.beaconObservations.get(payload.beaconDeviceId) ?? new Map<string, BeaconObservation>();
    const previousKeys = new Set(beaconMap.keys());
    const currentKeys = new Set<string>();

    for (const reading of readings) {
      if (!reading || typeof reading.deviceId !== "string" || typeof reading.rssi !== "number") {
        continue;
      }
      const employeeKey = reading.employeeId ?? reading.deviceId;
      currentKeys.add(employeeKey);
      beaconMap.set(employeeKey, {
        rssi: reading.rssi,
        ts: now,
        deviceId: reading.deviceId,
        employeeId: reading.employeeId,
      });
    }

    for (const key of previousKeys) {
      if (!currentKeys.has(key)) {
        beaconMap.delete(key);
      }
    }
    this.beaconObservations.set(payload.beaconDeviceId, beaconMap);

    // Reconcile every employee whose observation set for this beacon changed.
    // That's the union of "was observed by this beacon before" and "observed
    // now" — employees fully out of range of every beacon are handled by the
    // staleness sweep below.
    const affected = new Set<string>([...previousKeys, ...currentKeys]);
    for (const employeeKey of affected) {
      this.reconcileEmployeePresence(employeeKey, now);
    }

    // Any employee whose winning beacon has gone silent should be released.
    for (const [employeeKey, presence] of this.employeePresence) {
      if (affected.has(employeeKey)) {
        continue;
      }
      const winnerObs = this.beaconObservations.get(presence.beaconDeviceId)?.get(employeeKey);
      if (!winnerObs || now - winnerObs.ts > OBSERVATION_TTL_MS) {
        this.reconcileEmployeePresence(employeeKey, now);
      }
    }

    this.logger.log(
      `Room beacon ${payload.beaconDeviceId} (room ${payload.roomId}) reported ${readings.length} tag(s)`,
    );
  }

  /**
   * Re-derives the winning room for `employeeKey` by picking the beacon with
   * the strongest fresh RSSI above threshold, then emits enter/exit events
   * if the winner changed.
   */
  private reconcileEmployeePresence(employeeKey: string, now: number) {
    const threshold = this.config?.rssiThreshold ?? DEFAULT_RSSI_THRESHOLD;
    const current = this.employeePresence.get(employeeKey);

    let bestBeaconId: string | null = null;
    let bestRssi = -Infinity;

    for (const [beaconDeviceId, observations] of this.beaconObservations) {
      const obs = observations.get(employeeKey);
      if (!obs) {
        continue;
      }
      if (now - obs.ts > OBSERVATION_TTL_MS) {
        continue;
      }
      if (obs.rssi < threshold) {
        continue;
      }
      if (obs.rssi > bestRssi) {
        bestRssi = obs.rssi;
        bestBeaconId = beaconDeviceId;
      }
    }

    // Apply stickiness: if the current owner still has a fresh, above-threshold
    // reading and no challenger beats it by at least SWITCH_MARGIN_DB, keep
    // the current assignment to avoid flapping.
    if (current && bestBeaconId && bestBeaconId !== current.beaconDeviceId) {
      const incumbentObs = this.beaconObservations.get(current.beaconDeviceId)?.get(employeeKey);
      if (
        incumbentObs &&
        now - incumbentObs.ts <= OBSERVATION_TTL_MS &&
        incumbentObs.rssi >= threshold &&
        bestRssi - incumbentObs.rssi < SWITCH_MARGIN_DB
      ) {
        bestBeaconId = current.beaconDeviceId;
        bestRssi = incumbentObs.rssi;
      }
    }

    if (!bestBeaconId) {
      if (!current) {
        return;
      }
      this.employeePresence.delete(employeeKey);
      this.emitScannerEvent("exit", employeeKey, current.beaconDeviceId, current.roomId, current.rssi, now);
      return;
    }

    const bestBeaconState = this.roomBeacons.get(bestBeaconId);
    if (!bestBeaconState) {
      return;
    }

    if (!current) {
      this.employeePresence.set(employeeKey, {
        beaconDeviceId: bestBeaconId,
        roomId: bestBeaconState.roomId,
        rssi: bestRssi,
      });
      this.emitScannerEvent("enter", employeeKey, bestBeaconId, bestBeaconState.roomId, bestRssi, now);
      return;
    }

    if (current.beaconDeviceId === bestBeaconId) {
      const roomChanged = current.roomId !== bestBeaconState.roomId;
      current.rssi = bestRssi;
      current.roomId = bestBeaconState.roomId;
      if (roomChanged) {
        // Same beacon, but it's now reporting a different room (e.g. the
        // beacon was reconfigured). Re-assert so the locations service
        // updates the room and flips signalSource back to "ble".
        this.emitScannerEvent("enter", employeeKey, bestBeaconId, bestBeaconState.roomId, bestRssi, now);
        this.logger.log(
          `Employee ${employeeKey} stayed on ${bestBeaconId} but room changed → ${bestBeaconState.roomId}`,
        );
      }
      return;
    }

    // Winner changed: emit exit from the losing room, enter in the winning one.
    this.emitScannerEvent("exit", employeeKey, current.beaconDeviceId, current.roomId, current.rssi, now);
    this.employeePresence.set(employeeKey, {
      beaconDeviceId: bestBeaconId,
      roomId: bestBeaconState.roomId,
      rssi: bestRssi,
    });
    this.emitScannerEvent("enter", employeeKey, bestBeaconId, bestBeaconState.roomId, bestRssi, now);
    this.logger.log(
      `Employee ${employeeKey} handed off ${current.beaconDeviceId}(${current.rssi}) → ${bestBeaconId}(${bestRssi})`,
    );
  }

  private emitScannerEvent(
    type: "enter" | "exit",
    employeeId: string,
    beaconDeviceId: string,
    roomId: string,
    rssi: number,
    ts: number,
  ) {
    const orgId = this.roomBeacons.get(beaconDeviceId)?.orgId ?? this.config?.orgId ?? "default-org";
    const event: ScannerLocationEvent = {
      employeeId,
      scannerId: beaconDeviceId,
      roomId,
      rssi,
      event: type,
      orgId,
      sourceType: "ble",
      ts,
    };
    this.locationsService.ingestScannerEvent(event).catch((error) => {
      this.logger.error(`Failed to ingest room-beacon ${type} event: ${String(error)}`);
    });
  }

  queueNotification(request: RoomBeaconNotifyRequest): RoomBeaconNotification {
    const ttlSeconds = Math.max(5, Math.min(3600, request.ttlSeconds ?? 60));
    const now = Date.now();
    const notification: RoomBeaconNotification = {
      id: randomUUID(),
      message: String(request.message ?? "").slice(0, 180),
      priority: request.priority ?? "normal",
      targetEmployeeId: request.targetEmployeeId,
      targetRoomId: request.targetRoomId,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
    };

    const targets = request.targetRoomId
      ? Array.from(this.roomBeacons.values()).filter((beacon) => beacon.roomId === request.targetRoomId)
      : Array.from(this.roomBeacons.values());

    if (targets.length === 0) {
      // No beacons have checked in yet — queue under a wildcard key so the next poll picks it up
      const bucket = this.pendingNotifications.get("__pending__") ?? [];
      bucket.push(notification);
      this.pendingNotifications.set("__pending__", bucket);
    } else {
      for (const beacon of targets) {
        const bucket = this.pendingNotifications.get(beacon.beaconDeviceId) ?? [];
        bucket.push(notification);
        this.pendingNotifications.set(beacon.beaconDeviceId, bucket);
      }
    }

    this.logger.log(
      `Queued notification ${notification.id} for ${targets.length || "all pending"} beacon(s): "${notification.message}"`,
    );
    return notification;
  }

  popPendingNotifications(beaconDeviceId: string): RoomBeaconNotification[] {
    const now = Date.now();
    const fanout = this.pendingNotifications.get("__pending__") ?? [];
    if (fanout.length > 0) {
      const active = fanout.filter((entry) => entry.expiresAt > now);
      for (const state of this.roomBeacons.values()) {
        const bucket = this.pendingNotifications.get(state.beaconDeviceId) ?? [];
        this.pendingNotifications.set(state.beaconDeviceId, bucket.concat(active));
      }
      this.pendingNotifications.delete("__pending__");
    }

    const bucket = this.pendingNotifications.get(beaconDeviceId) ?? [];
    const active = bucket.filter((entry) => entry.expiresAt > now);
    this.pendingNotifications.set(beaconDeviceId, []);
    return active;
  }

  listRoomBeacons(): RoomBeaconState[] {
    return Array.from(this.roomBeacons.values());
  }
}
