#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <ctype.h>

#ifndef DEVICE_KIND
#define DEVICE_KIND "tag"
#endif

#ifndef TAG_DEVICE_ID
#define TAG_DEVICE_ID "tag-001"
#endif

#ifndef TAG_EMPLOYEE_ID
#define TAG_EMPLOYEE_ID "employee-1"
#endif

#ifndef BLE_SERVICE_UUID
#define BLE_SERVICE_UUID "8f240001-6f8d-4f13-a42a-8434f84f0001"
#endif

#ifndef BLE_STATUS_CHAR_UUID
#define BLE_STATUS_CHAR_UUID "8f240002-6f8d-4f13-a42a-8434f84f0001"
#endif

#ifndef BLE_PROVISION_CHAR_UUID
#define BLE_PROVISION_CHAR_UUID "8f240003-6f8d-4f13-a42a-8434f84f0001"
#endif

namespace {
const unsigned long kStatusIntervalMs = 5000;
const unsigned long kDisplayIntervalMs = 1000;

unsigned long lastStatusAt = 0;
unsigned long lastDisplayAt = 0;
unsigned long bootAt = 0;
uint32_t frame = 0;

BLECharacteristic* statusCharacteristic = nullptr;
BLECharacteristic* provisioningCharacteristic = nullptr;
bool provisioningDirty = false;

struct DeviceRuntimeConfig {
  bool bleEnabled = true;
  int bleTxPowerDbm = -8;
  bool locationTracking = true;
  bool notifications = true;
  bool scannerPresence = true;
  bool debugMode = false;
};

DeviceRuntimeConfig runtimeConfig;

String extractJsonString(const String& payload, const char* key) {
  const String quotedKey = String("\"") + key + "\":";
  const int keyPos = payload.indexOf(quotedKey);
  if (keyPos < 0) {
    return "";
  }

  const int valueStart = payload.indexOf('"', keyPos + quotedKey.length());
  if (valueStart < 0) {
    return "";
  }

  const int valueEnd = payload.indexOf('"', valueStart + 1);
  if (valueEnd < 0) {
    return "";
  }

  return payload.substring(valueStart + 1, valueEnd);
}

bool extractJsonBool(const String& payload, const char* key, bool fallback) {
  const String quotedKey = String("\"") + key + "\":";
  const int keyPos = payload.indexOf(quotedKey);
  if (keyPos < 0) {
    return fallback;
  }

  const int valueStart = keyPos + quotedKey.length();
  if (payload.startsWith("true", valueStart)) {
    return true;
  }

  if (payload.startsWith("false", valueStart)) {
    return false;
  }

  return fallback;
}

int extractJsonInt(const String& payload, const char* key, int fallback) {
  const String quotedKey = String("\"") + key + "\":";
  const int keyPos = payload.indexOf(quotedKey);
  if (keyPos < 0) {
    return fallback;
  }

  const int valueStart = keyPos + quotedKey.length();
  int valueEnd = valueStart;
  while (valueEnd < payload.length() && (payload[valueEnd] == '-' || isdigit(payload[valueEnd]))) {
    valueEnd += 1;
  }

  if (valueEnd == valueStart) {
    return fallback;
  }

  return payload.substring(valueStart, valueEnd).toInt();
}

String buildStatusPayload() {
  const unsigned long ts = millis();
  char payload[384];

  snprintf(
    payload,
    sizeof(payload),
    "{\"deviceId\":\"%s\",\"deviceKind\":\"%s\",\"employeeId\":\"%s\",\"status\":\"online\",\"uptimeMs\":%lu,\"bleEnabled\":%s,\"bleTxPowerDbm\":%d,\"features\":{\"locationTracking\":%s,\"notifications\":%s,\"scannerPresence\":%s,\"debugMode\":%s},\"ts\":%lu}",
    TAG_DEVICE_ID,
    DEVICE_KIND,
    TAG_EMPLOYEE_ID,
    ts - bootAt,
    runtimeConfig.bleEnabled ? "true" : "false",
    runtimeConfig.bleTxPowerDbm,
    runtimeConfig.locationTracking ? "true" : "false",
    runtimeConfig.notifications ? "true" : "false",
    runtimeConfig.scannerPresence ? "true" : "false",
    runtimeConfig.debugMode ? "true" : "false",
    ts);

  return String(payload);
}

class ProvisioningCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    const std::string raw = characteristic->getValue();
    if (raw.empty()) {
      return;
    }

    const String payload(raw.c_str());

    const String requestedDeviceId = extractJsonString(payload, "deviceId");
    if (requestedDeviceId.length() > 0 && requestedDeviceId != TAG_DEVICE_ID) {
      Serial.println("[BLE:CFG] ignored payload for different deviceId");
      return;
    }

    runtimeConfig.bleEnabled = extractJsonBool(payload, "bleEnabled", runtimeConfig.bleEnabled);
    runtimeConfig.bleTxPowerDbm = extractJsonInt(payload, "bleTxPowerDbm", runtimeConfig.bleTxPowerDbm);
    runtimeConfig.locationTracking = extractJsonBool(payload, "locationTracking", runtimeConfig.locationTracking);
    runtimeConfig.notifications = extractJsonBool(payload, "notifications", runtimeConfig.notifications);
    runtimeConfig.scannerPresence = extractJsonBool(payload, "scannerPresence", runtimeConfig.scannerPresence);
    runtimeConfig.debugMode = extractJsonBool(payload, "debugMode", runtimeConfig.debugMode);

    provisioningDirty = true;

    Serial.println("[BLE:CFG] provisioning payload applied");
    Serial.println(payload);

    const String ack = String("{\"ok\":true,\"deviceId\":\"") + TAG_DEVICE_ID + "\"}";
    characteristic->setValue(ack.c_str());
    characteristic->notify();
  }
};

void updateStatusCharacteristic() {
  if (statusCharacteristic == nullptr) {
    return;
  }

  const String payload = buildStatusPayload();
  statusCharacteristic->setValue(payload.c_str());
  statusCharacteristic->notify();

  Serial.println("[BLE:STATUS]");
  Serial.println(payload);
}

void startBlePeripheral() {
  BLEDevice::init(TAG_DEVICE_ID);

  BLEServer* server = BLEDevice::createServer();
  BLEService* service = server->createService(BLE_SERVICE_UUID);

  statusCharacteristic = service->createCharacteristic(
    BLE_STATUS_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  statusCharacteristic->addDescriptor(new BLE2902());

  provisioningCharacteristic = service->createCharacteristic(
    BLE_PROVISION_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
  provisioningCharacteristic->addDescriptor(new BLE2902());
  provisioningCharacteristic->setCallbacks(new ProvisioningCallbacks());

  statusCharacteristic->setValue(buildStatusPayload().c_str());
  provisioningCharacteristic->setValue("{\"ok\":true}");

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] peripheral started");
  Serial.print("[BLE] service UUID: ");
  Serial.println(BLE_SERVICE_UUID);
}

void renderOledStub() {
  const unsigned long ts = millis();
  frame += 1;

  Serial.print("[OLED] ");
  Serial.print("ID=");
  Serial.print(TAG_EMPLOYEE_ID);
  Serial.print(" | Uptime=");
  Serial.print((ts - bootAt) / 1000);
  Serial.print("s | Frame=");
  Serial.println(frame);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);

  bootAt = millis();
  lastStatusAt = bootAt;
  lastDisplayAt = bootAt;

  startBlePeripheral();

  Serial.println("Ignara TAG firmware");
  Serial.println("Mode: BLE-only status + provisioning over GATT");
}

void loop() {
  const unsigned long now = millis();

  if (now - lastDisplayAt >= kDisplayIntervalMs) {
    renderOledStub();
    lastDisplayAt = now;
  }

  if (provisioningDirty || now - lastStatusAt >= kStatusIntervalMs) {
    updateStatusCharacteristic();
    provisioningDirty = false;
    lastStatusAt = now;
  }

  delay(20);
}
