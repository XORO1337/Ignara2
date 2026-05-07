import { Logger } from "@nestjs/common";
import type {
  BleBeaconStatus,
  BleProximityReportPayload,
  BleTagRegistrationPayload,
} from "@ignara/sharedtypes";

// BLE Service and Characteristic UUIDs (Ignara BLE namespace)
export const BLE_SERVICE_UUID = "8f240001-6f8d-4f13-a42a-8434f84f0001";
export const BLE_TAG_REGISTRATION_CHAR_UUID = "8f240010-6f8d-4f13-a42a-8434f84f0001";
export const BLE_PROXIMITY_REPORT_CHAR_UUID = "8f240011-6f8d-4f13-a42a-8434f84f0001";
export const BLE_STATUS_CHAR_UUID = "8f240012-6f8d-4f13-a42a-8434f84f0001";

export type TagRegistrationCallback = (payload: BleTagRegistrationPayload) => void;
export type ProximityReportCallback = (payload: BleProximityReportPayload) => void;

export class BleBeaconGattService {
  private readonly logger = new Logger(BleBeaconGattService.name);
  private onTagRegistration?: TagRegistrationCallback;
  private onProximityReport?: ProximityReportCallback;
  private currentStatus: BleBeaconStatus | null = null;

  setStatus(status: BleBeaconStatus) {
    this.currentStatus = status;
  }

  setTagRegistrationCallback(callback: TagRegistrationCallback) {
    this.onTagRegistration = callback;
  }

  setProximityReportCallback(callback: ProximityReportCallback) {
    this.onProximityReport = callback;
  }

  // Handler for tag registration characteristic write
  handleTagRegistrationWrite(data: Buffer): void {
    try {
      const payload = JSON.parse(data.toString("utf-8")) as BleTagRegistrationPayload;

      if (!payload?.deviceId) {
        this.logger.warn("Tag registration missing deviceId");
        return;
      }

      this.logger.log(`Tag registration: ${payload.deviceId} (employee: ${payload.employeeId ?? "none"})`);

      if (this.onTagRegistration) {
        this.onTagRegistration(payload);
      }
    } catch (error) {
      this.logger.error(`Failed to parse tag registration: ${String(error)}`);
    }
  }

  // Handler for proximity report characteristic write
  handleProximityReportWrite(data: Buffer): void {
    try {
      const payload = JSON.parse(data.toString("utf-8")) as BleProximityReportPayload;

      if (!payload?.deviceId || typeof payload.rssi !== "number") {
        this.logger.warn("Proximity report missing deviceId or rssi");
        return;
      }

      if (this.onProximityReport) {
        this.onProximityReport({
          ...payload,
          timestamp: payload.timestamp ?? Date.now(),
        });
      }
    } catch (error) {
      this.logger.error(`Failed to parse proximity report: ${String(error)}`);
    }
  }

  // Handler for status characteristic read
  handleStatusRead(): Buffer {
    if (!this.currentStatus) {
      return Buffer.from(JSON.stringify({ error: "Beacon not initialized" }));
    }
    return Buffer.from(JSON.stringify(this.currentStatus));
  }

  // Create GATT service definition for bleno
  createGattServiceDefinition(bleno: typeof import("@abandonware/bleno")): unknown {
    const self = this;

    const TagRegistrationCharacteristic = function () {
      bleno.Characteristic.call(this, {
        uuid: BLE_TAG_REGISTRATION_CHAR_UUID,
        properties: ["write"],
        onWriteRequest: (data: Buffer, _offset: number, _withoutResponse: boolean, callback: (result: number) => void) => {
          self.handleTagRegistrationWrite(data);
          callback(bleno.Characteristic.RESULT_SUCCESS);
        },
      });
    };
    TagRegistrationCharacteristic.prototype = Object.create(bleno.Characteristic.prototype);
    TagRegistrationCharacteristic.prototype.constructor = TagRegistrationCharacteristic;

    const ProximityReportCharacteristic = function () {
      bleno.Characteristic.call(this, {
        uuid: BLE_PROXIMITY_REPORT_CHAR_UUID,
        properties: ["write", "notify"],
        onWriteRequest: (data: Buffer, _offset: number, _withoutResponse: boolean, callback: (result: number) => void) => {
          self.handleProximityReportWrite(data);
          callback(bleno.Characteristic.RESULT_SUCCESS);
        },
      });
    };
    ProximityReportCharacteristic.prototype = Object.create(bleno.Characteristic.prototype);
    ProximityReportCharacteristic.prototype.constructor = ProximityReportCharacteristic;

    const StatusCharacteristic = function () {
      bleno.Characteristic.call(this, {
        uuid: BLE_STATUS_CHAR_UUID,
        properties: ["read", "notify"],
        onReadRequest: (_offset: number, callback: (result: number, data: Buffer) => void) => {
          const data = self.handleStatusRead();
          callback(bleno.Characteristic.RESULT_SUCCESS, data);
        },
      });
    };
    StatusCharacteristic.prototype = Object.create(bleno.Characteristic.prototype);
    StatusCharacteristic.prototype.constructor = StatusCharacteristic;

    return function () {
      bleno.PrimaryService.call(this, {
        uuid: BLE_SERVICE_UUID,
        characteristics: [
          new (TagRegistrationCharacteristic as any)(),
          new (ProximityReportCharacteristic as any)(),
          new (StatusCharacteristic as any)(),
        ],
      });
    };
  }
}
