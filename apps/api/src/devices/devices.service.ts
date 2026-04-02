import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InjectRepository } from "@nestjs/typeorm";
import type {
  ScannerDeviceSummary,
  TagDeviceSummary,
  UsbConfigCommandBundle,
  UsbDeviceConfigPayload,
  UsbDeviceConfigRequest,
} from "@ignara/sharedtypes";
import { Repository } from "typeorm";
import { hashPassword } from "../auth/password";
import { DeviceEntity } from "../entities/device.entity";

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(DeviceEntity)
    private readonly devicesRepository: Repository<DeviceEntity>,
  ) {}

  async listTagsByOrg(orgId: string): Promise<TagDeviceSummary[]> {
    const tags = await this.devicesRepository.find({
      where: { orgId, type: "tag" },
      order: { deviceId: "ASC" },
    });

    return tags.map((tag) => ({
      id: tag.deviceId,
      orgId: tag.orgId,
      type: "tag",
      roomId: tag.roomId,
      bleProvisionedAt: tag.bleProvisionedAt ? tag.bleProvisionedAt.toISOString() : null,
    }));
  }

  async listScannersByOrg(orgId: string): Promise<ScannerDeviceSummary[]> {
    const scanners = await this.devicesRepository.find({
      where: { orgId, type: "scanner" },
      order: { deviceId: "ASC" },
    });

    return scanners.map((scanner) => ({
      id: scanner.deviceId,
      orgId: scanner.orgId,
      type: "scanner",
      roomId: scanner.roomId,
    }));
  }

  async registerTag(input: {
    orgId: string;
    deviceId: string;
    roomId?: string | null;
  }): Promise<TagDeviceSummary> {
    const exists = await this.devicesRepository.findOne({
      where: { deviceId: input.deviceId },
    });

    if (exists) {
      throw new ConflictException("A device with this deviceId already exists");
    }

    const created = this.devicesRepository.create({
      id: randomUUID(),
      deviceId: input.deviceId,
      orgId: input.orgId,
      type: "tag",
      roomId: input.roomId ?? null,
    });

    const saved = await this.devicesRepository.save(created);
    return {
      id: saved.deviceId,
      orgId: saved.orgId,
      type: "tag",
      roomId: saved.roomId,
      bleProvisionedAt: saved.bleProvisionedAt ? saved.bleProvisionedAt.toISOString() : null,
    };
  }

  async generateUsbConfigCommands(input: {
    orgId: string;
    request: UsbDeviceConfigRequest;
  }): Promise<UsbConfigCommandBundle> {
    const device = await this.devicesRepository.findOne({
      where: {
        orgId: input.orgId,
        deviceId: input.request.deviceId,
        type: input.request.deviceKind,
      },
    });

    if (!device) {
      throw new NotFoundException("Device not found for this organization");
    }

    device.bleProvisionedAt = new Date();
    await this.devicesRepository.save(device);

    const passwordHash = input.request.enablePasswordProtection
      ? hashPassword(input.request.secureConfigPassword ?? "")
      : undefined;

    const payload: UsbDeviceConfigPayload = {
      deviceId: input.request.deviceId,
      deviceKind: input.request.deviceKind,
      ble: {
        enabled: input.request.bleEnabled ?? true,
        txPowerDbm: input.request.bleTxPowerDbm,
      },
      security: {
        enabled: input.request.enablePasswordProtection,
        passwordHash,
      },
      features: input.request.features,
      ts: Date.now(),
    };

    const configJson = JSON.stringify(payload, null, 2);
    const escapedConfigJson = configJson.replace(/'/g, "'\\''");
    const localFilename = `ignara-config-${input.request.deviceId}.json`;
    const targetPath = `/sdcard/ignara/${localFilename}`;

    return {
      deviceId: input.request.deviceId,
      deviceKind: input.request.deviceKind,
      generatedAtIso: new Date().toISOString(),
      configJson,
      adbCommands: [
        "adb devices",
        `cat <<'EOF' > ${localFilename}`,
        configJson,
        "EOF",
        "adb shell mkdir -p /sdcard/ignara",
        `adb push ${localFilename} ${targetPath}`,
        `adb shell \"setprop persist.ignara.device_id '${input.request.deviceId}'\"`,
        `adb shell \"setprop persist.ignara.device_kind '${input.request.deviceKind}'\"`,
        `adb shell \"echo '${escapedConfigJson}' > /sdcard/ignara/config-active.json\"`,
        `adb shell \"am broadcast -a com.ignara.CONFIG_APPLY --es config_path '${targetPath}'\"`,
      ],
    };
  }
}
