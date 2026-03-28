export type Role = "admin" | "manager" | "employee";

export interface ScannerLocationEvent {
  employeeId: string;
  scannerId: string;
  roomId: string;
  rssi: number;
  event: "enter" | "exit";
  orgId?: string;
  ts?: number;
}

export interface LastKnownLocation {
  orgId: string;
  employeeId: string;
  roomId: string;
  scannerId: string;
  connected: boolean;
  lastEvent: "enter" | "exit";
  disconnectedAt?: number;
  ts: number;
}

export interface NotificationPayload {
  orgId: string;
  senderId: string;
  message: string;
  priority: "low" | "normal" | "high";
  recipientIds?: string[];
}

export interface RoomZone {
  id: string;
  label: string;
  scannerDeviceId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapConfig {
  id: string;
  orgId: string;
  name: string;
  svgUrl?: string;
  rooms: RoomZone[];
}

export interface TagDeviceSummary {
  id: string;
  orgId: string;
  type: "tag";
  roomId?: string | null;
  wifiSsid?: string | null;
  wifiUpdatedAt?: string | null;
}

export interface DeviceWifiConfigCommand {
  ssid: string;
  password: string;
  ts: number;
}

export interface ScannerDeviceSummary {
  id: string;
  orgId: string;
  type: "scanner";
  roomId?: string | null;
}

export interface DeviceFeatureToggles {
  locationTracking: boolean;
  notifications: boolean;
  scannerPresence: boolean;
  debugMode: boolean;
}

export interface UsbDeviceConfigRequest {
  deviceId: string;
  deviceKind: "tag" | "scanner";
  wifiSsid: string;
  wifiPassword: string;
  enablePasswordProtection: boolean;
  secureConfigPassword?: string;
  features: DeviceFeatureToggles;
}

export interface UsbDeviceConfigPayload {
  deviceId: string;
  deviceKind: "tag" | "scanner";
  wifi: {
    ssid: string;
    password: string;
  };
  security: {
    enabled: boolean;
    passwordHash?: string;
  };
  features: DeviceFeatureToggles;
  ts: number;
}

export interface UsbConfigCommandBundle {
  deviceId: string;
  deviceKind: "tag" | "scanner";
  generatedAtIso: string;
  adbCommands: string[];
  configJson: string;
}
