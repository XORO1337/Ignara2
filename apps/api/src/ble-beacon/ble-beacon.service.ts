import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  BleBeaconConfig,
  BleBeaconStatus,
  BleProximityReportPayload,
  BleTagConnection,
  BleTagRegistrationPayload,
  ScannerLocationEvent,
} from "@ignara/sharedtypes";
import bleno from "@abandonware/bleno";
import { BleBeaconGattService, BLE_SERVICE_UUID } from "./ble-beacon.gatt.service";
import { LocationsService } from "../locations/locations.service";
import { DevicesService } from "../devices/devices.service";

const DEFAULT_RSSI_THRESHOLD = -70;
const DEFAULT_ADVERTISE_NAME = "IgnaraBeacon";
const EXIT_TIMEOUT_MS = 10_000; // 10 seconds without update = exit
const RSSI_HYSTERESIS_COUNT = 3; // Number of consecutive readings to confirm state change

type TagState = {
  connection: BleTagConnection;
  lastEvent: "enter" | "exit" | null;
  rssiReadings: number[];
  exitTimer: NodeJS.Timeout | null;
};

@Injectable()
export class BleBeaconService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BleBeaconService.name);
  private readonly gattService = new BleBeaconGattService();
  private readonly tags = new Map<string, TagState>();
  private config: BleBeaconConfig | null = null;
  private isAdvertising = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly locationsService: LocationsService,
    private readonly devicesService: DevicesService,
  ) {}

  async onModuleInit() {
    const enabled = this.configService.get<string>("BLE_BEACON_ENABLED", "true") === "true";

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

    // Set up GATT callbacks
    this.gattService.setTagRegistrationCallback((payload) => this.handleTagRegistration(payload));
    this.gattService.setProximityReportCallback((payload) => this.handleProximityReport(payload));

    // Initialize BLE
    this.initializeBleno();
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

    if (bleno) {
      bleno.stopAdvertising();
      bleno.disconnect();
    }
  }

  private initializeBleno() {
    if (!this.config) {
      return;
    }

    bleno.on("stateChange", (state: string) => {
      this.logger.log(`BLE state changed: ${state}`);

      if (state === "poweredOn") {
        this.startAdvertising();
      } else {
        this.stopAdvertising();
      }
    });

    bleno.on("advertisingStart", (error: Error | null) => {
      if (error) {
        this.logger.error(`Failed to start advertising: ${error.message}`);
        return;
      }

      this.logger.log("BLE advertising started");
      this.isAdvertising = true;

      // Set up GATT service
      const ServiceConstructor = this.gattService.createGattServiceDefinition(bleno);
      bleno.setServices([new (ServiceConstructor as any)()]);
    });

    bleno.on("advertisingStop", () => {
      this.logger.log("BLE advertising stopped");
      this.isAdvertising = false;
    });

    bleno.on("accept", (clientAddress: string) => {
      this.logger.log(`BLE client connected: ${clientAddress}`);
    });

    bleno.on("disconnect", (clientAddress: string) => {
      this.logger.log(`BLE client disconnected: ${clientAddress}`);
    });

    bleno.on("rssiUpdate", (rssi: number) => {
      this.logger.debug(`BLE RSSI update: ${rssi}`);
    });
  }

  private startAdvertising() {
    if (!this.config || this.isAdvertising) {
      return;
    }

    const name = this.config.advertiseName;
    
    bleno.startAdvertising(name, [BLE_SERVICE_UUID], (error?: Error | null) => {
      if (error) {
        this.logger.error(`Failed to start advertising: ${error?.message}`);
      }
    });
  }

  private stopAdvertising() {
    if (this.isAdvertising) {
      bleno.stopAdvertising();
    }
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

    const status: BleBeaconStatus = {
      deviceId: this.config.deviceId,
      roomId: this.config.roomId,
      orgId: this.config.orgId,
      active: this.isAdvertising,
      connectedTags: Array.from(this.tags.values()).filter((t) => t.connection.connected).length,
      rssiThreshold: this.config.rssiThreshold,
    };

    this.gattService.setStatus(status);
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
}
