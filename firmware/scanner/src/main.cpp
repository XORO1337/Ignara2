#include <Arduino.h>
#include <BLEDevice.h>

#ifndef DEVICE_KIND
#define DEVICE_KIND "scanner"
#endif

#ifndef BLE_SERVICE_UUID
#define BLE_SERVICE_UUID "8f240001-6f8d-4f13-a42a-8434f84f0001"
#endif

#ifndef BLE_STATUS_CHAR_UUID
#define BLE_STATUS_CHAR_UUID "8f240002-6f8d-4f13-a42a-8434f84f0001"
#endif

namespace {
const char* kScannerId = "scanner-01";
const char* kEmployeeId = "employee@ignara.local";
const char* kRoomId = "room-A3";
const char* kOrgId = "default-org";

const unsigned long kScanIntervalMs = 2000;
const int kEnterThreshold = -68;
const int kExitThreshold = -74;
const int kSignalLossExitScans = 3;
const uint32_t kBleScanDurationSeconds = 1;

unsigned long lastScanAt = 0;
bool occupantPresent = false;
int missedBeaconScans = 0;
String activeBeaconId;

BLEScan* bleScan = nullptr;

struct BeaconSample {
  bool found;
  String beaconId;
  int rssi;
};

float computeProximityScore(int rssi) {
  const float normalized = static_cast<float>(rssi + 100) / 45.0f;
  if (normalized < 0.0f) {
    return 0.0f;
  }
  if (normalized > 1.0f) {
    return 1.0f;
  }
  return normalized;
}

bool hasIgnaraService(const BLEAdvertisedDevice& device) {
  if (!device.haveServiceUUID()) {
    return false;
  }

  BLEUUID expected(BLE_SERVICE_UUID);
  return device.isAdvertisingService(expected);
}

String resolveBeaconId(const BLEAdvertisedDevice& device) {
  if (device.haveServiceData()) {
    std::string serviceData = device.getServiceData();
    if (!serviceData.empty()) {
      return String(serviceData.c_str());
    }
  }

  if (device.haveName() && device.getName().length() > 0) {
    return String(device.getName().c_str());
  }

  return String(device.getAddress().toString().c_str());
}

void initializeBleScan() {
  BLEDevice::init("");
  bleScan = BLEDevice::getScan();
  bleScan->setActiveScan(true);
  bleScan->setInterval(160);
  bleScan->setWindow(99);
}

BeaconSample scanStrongestBeacon() {
  if (bleScan == nullptr) {
    return {false, "", -100};
  }

  BLEScanResults results = bleScan->start(kBleScanDurationSeconds, false);
  int bestRssi = -127;
  String bestBeaconId = "";

  for (int i = 0; i < results.getCount(); i += 1) {
    BLEAdvertisedDevice device = results.getDevice(i);
    if (!hasIgnaraService(device)) {
      continue;
    }

    const int rssi = device.getRSSI();
    if (rssi <= bestRssi) {
      continue;
    }

    const String beaconId = resolveBeaconId(device);
    if (beaconId.length() == 0) {
      continue;
    }

    bestRssi = rssi;
    bestBeaconId = beaconId;
  }

  bleScan->clearResults();
  if (bestBeaconId.length() == 0) {
    return {false, "", -100};
  }

  return {true, bestBeaconId, bestRssi};
}

void emitLocationEvent(const char* eventName, const String& beaconId, int rssi) {
  const unsigned long ts = millis();
  const float proximityScore = computeProximityScore(rssi);
  char payload[512];

  snprintf(
    payload,
    sizeof(payload),
    "{\"employeeId\":\"%s\",\"scannerId\":\"%s\",\"roomId\":\"%s\",\"rssi\":%d,\"event\":\"%s\",\"beaconId\":\"%s\",\"beaconRssi\":%d,\"sourceType\":\"ble\",\"proximityScore\":%.2f,\"orgId\":\"%s\",\"ts\":%lu}",
    kEmployeeId,
    kScannerId,
    kRoomId,
    rssi,
    eventName,
    beaconId.c_str(),
    rssi,
    proximityScore,
    kOrgId,
    ts);

  Serial.println("[BLE:LOC]");
  Serial.println(payload);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  initializeBleScan();

  Serial.println("Ignara SCANNER firmware");
  Serial.println("Mode: BLE-only scan + enter/exit serial event stream");
  Serial.print("Service filter: ");
  Serial.println(BLE_SERVICE_UUID);
  Serial.print("Thresholds: enter >= ");
  Serial.print(kEnterThreshold);
  Serial.print(" dBm, exit <= ");
  Serial.print(kExitThreshold);
  Serial.println(" dBm");
}

void loop() {
  const unsigned long now = millis();
  if (now - lastScanAt < kScanIntervalMs) {
    delay(20);
    return;
  }
  lastScanAt = now;

  const BeaconSample sample = scanStrongestBeacon();
  if (!sample.found) {
    Serial.println("[BLE] no matching Ignara beacon detected");
    if (occupantPresent) {
      missedBeaconScans += 1;
      if (missedBeaconScans >= kSignalLossExitScans) {
        occupantPresent = false;
        emitLocationEvent("exit", activeBeaconId, -100);
        activeBeaconId = "";
        missedBeaconScans = 0;
      }
    }
    return;
  }

  missedBeaconScans = 0;

  Serial.print("[BLE] strongest beacon=");
  Serial.print(sample.beaconId);
  Serial.print(" rssi=");
  Serial.println(sample.rssi);

  if (!occupantPresent && sample.rssi >= kEnterThreshold) {
    occupantPresent = true;
    activeBeaconId = sample.beaconId;
    emitLocationEvent("enter", sample.beaconId, sample.rssi);
    return;
  }

  if (occupantPresent && sample.rssi <= kExitThreshold) {
    occupantPresent = false;
    emitLocationEvent("exit", sample.beaconId, sample.rssi);
    activeBeaconId = "";
    return;
  }

  if (occupantPresent && activeBeaconId != sample.beaconId && sample.rssi >= kEnterThreshold) {
    activeBeaconId = sample.beaconId;
    emitLocationEvent("enter", sample.beaconId, sample.rssi);
  }
}
