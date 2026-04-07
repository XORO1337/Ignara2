export type Role = "admin" | "manager" | "employee";
export type UserGender = "male" | "female" | "other";

export interface ScannerLocationEvent {
  employeeId: string;
  scannerId: string;
  roomId: string;
  rssi: number;
  event: "enter" | "exit";
  beaconId?: string;
  beaconRssi?: number;
  sourceType?: "ble";
  proximityScore?: number;
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
  x?: number;
  y?: number;
  signalSource?: "ble" | "manual";
  movementSource?: "wasd" | "drag" | "scanner";
  beaconId?: string;
  beaconRssi?: number;
  proximityScore?: number;
  signalLostAt?: number;
  disconnectedAt?: number;
  ts: number;
}

export interface EmployeePresenceEvent {
  orgId: string;
  employeeId: string;
  roomId: string;
  action: "joined" | "left";
  ts: number;
  reason?: "manual" | "scanner" | "stale";
}

export interface ChatMessage {
  id: string;
  orgId: string;
  senderId: string;
  text: string;
  roomId?: string;
  ts: number;
}

export interface ChatJoinPayload {
  orgId: string;
  employeeId: string;
}

export interface ChatSendPayload {
  text: string;
  roomId?: string;
}

export type VoiceSignal =
  | {
      type: "offer";
      sdp: string;
    }
  | {
      type: "answer";
      sdp: string;
    }
  | {
      type: "ice-candidate";
      candidate: string;
      sdpMid?: string;
      sdpMLineIndex?: number;
    };

export interface VoiceJoinPayload {
  orgId: string;
  employeeId: string;
  roomId: string;
}

export interface VoiceSignalPayload {
  to: string;
  signal: VoiceSignal;
}

export interface VoicePeersPayload {
  roomId: string;
  peers: string[];
}

export interface VoicePeerEvent {
  employeeId: string;
}

export interface VoiceInboundSignalPayload {
  from: string;
  signal: VoiceSignal;
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
  beaconId?: string;
  beaconIds?: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

export interface LocationMoveRequest {
  roomId?: string;
  x: number;
  y: number;
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
  bleProvisionedAt?: string | null;
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
  bleEnabled?: boolean;
  bleTxPowerDbm?: number;
  enablePasswordProtection: boolean;
  secureConfigPassword?: string;
  features: DeviceFeatureToggles;
}

export interface UsbDeviceConfigPayload {
  deviceId: string;
  deviceKind: "tag" | "scanner";
  ble: {
    enabled: boolean;
    txPowerDbm?: number;
  };
  security: {
    enabled: boolean;
    passwordHash?: string;
  };
  features: DeviceFeatureToggles;
  ts: number;
}

export interface BleProvisioningPayload {
  action: "apply_config" | "factory_reset" | "request_status";
  ts: number;
  payload?: {
    deviceId: string;
    deviceKind: "tag" | "scanner";
    bleEnabled: boolean;
    bleTxPowerDbm?: number;
    features: DeviceFeatureToggles;
  };
}

export interface UsbConfigCommandBundle {
  deviceId: string;
  deviceKind: "tag" | "scanner";
  generatedAtIso: string;
  adbCommands: string[];
  configJson: string;
}
