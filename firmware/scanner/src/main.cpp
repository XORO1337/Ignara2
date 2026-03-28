#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

#ifndef DEVICE_KIND
#define DEVICE_KIND "scanner"
#endif

#ifndef MQTT_TOPIC_LOC
#define MQTT_TOPIC_LOC "ignara/location/room-A3"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "CHANGE_ME_WIFI_SSID"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "CHANGE_ME_WIFI_PASSWORD"
#endif

#ifndef MQTT_HOST
#define MQTT_HOST "192.168.1.10"
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif

namespace {
const char* kScannerId = "scanner-01";
const char* kEmployeeId = "employee-1";
const char* kRoomId = "room-A3";
const char* kOrgId = "default-org";

const unsigned long kScanIntervalMs = 1000;
const unsigned long kReconnectIntervalMs = 5000;
const int kEnterThreshold = -68;
const int kExitThreshold = -74;

unsigned long lastScanAt = 0;
unsigned long lastReconnectAt = 0;
int simulatedRssi = -85;
bool occupantPresent = false;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
bool mqttEnabled = true;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.print("[WIFI] connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void connectMqtt() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected() || !mqttEnabled) {
    return;
  }

  char clientId[64];
  snprintf(clientId, sizeof(clientId), "ignara-scanner-%lu", millis());

  Serial.print("[MQTT] connecting to ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);

  if (mqttClient.connect(clientId)) {
    Serial.println("[MQTT] connected");
    return;
  }

  Serial.print("[MQTT] connect failed rc=");
  Serial.println(mqttClient.state());
}

void ensureConnectivity() {
  const unsigned long now = millis();
  if (now - lastReconnectAt < kReconnectIntervalMs) {
    return;
  }
  lastReconnectAt = now;

  connectWiFi();
  connectMqtt();
}

int nextRssiSample() {
  const unsigned long t = millis() / 1000;

  // 30-second cycle: approach desk, stay nearby, then walk away.
  if (t % 30 < 8) {
    simulatedRssi += 3;
  } else if (t % 30 < 18) {
    simulatedRssi += (random(-1, 2));
  } else {
    simulatedRssi -= 3;
  }

  if (simulatedRssi > -55) {
    simulatedRssi = -55;
  }
  if (simulatedRssi < -92) {
    simulatedRssi = -92;
  }

  return simulatedRssi;
}

void publishLocationEvent(const char* eventName, int rssi) {
  const unsigned long ts = millis();
  char payload[320];

  snprintf(
    payload,
    sizeof(payload),
    "{\"employeeId\":\"%s\",\"scannerId\":\"%s\",\"roomId\":\"%s\",\"rssi\":%d,\"event\":\"%s\",\"orgId\":\"%s\",\"ts\":%lu}",
    kEmployeeId,
    kScannerId,
    kRoomId,
    rssi,
    eventName,
    kOrgId,
    ts);

  if (mqttClient.connected()) {
    const ok = mqttClient.publish(MQTT_TOPIC_LOC, payload);
    if (!ok) {
      Serial.println("[MQTT] publish failed");
    }
  }

  Serial.print("[MQTT:LOC] topic=");
  Serial.println(MQTT_TOPIC_LOC);
  Serial.println(payload);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  randomSeed(static_cast<unsigned long>(micros()));
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);

  if (String(WIFI_SSID).startsWith("CHANGE_ME_")) {
    mqttEnabled = false;
    Serial.println("[CONFIG] WiFi/MQTT disabled. Set WIFI_SSID/WIFI_PASSWORD build flags.");
  }

  Serial.println("Ignara SCANNER firmware");
  Serial.println("Mode: simulated BLE scan + enter/exit publish over MQTT");
  Serial.print("Thresholds: enter >= ");
  Serial.print(kEnterThreshold);
  Serial.print(" dBm, exit <= ");
  Serial.print(kExitThreshold);
  Serial.println(" dBm");
}

void loop() {
  ensureConnectivity();
  mqttClient.loop();

  const unsigned long now = millis();
  if (now - lastScanAt < kScanIntervalMs) {
    delay(20);
    return;
  }
  lastScanAt = now;

  const int rssi = nextRssiSample();
  Serial.print("[SCAN] employee=");
  Serial.print(kEmployeeId);
  Serial.print(" rssi=");
  Serial.println(rssi);

  if (!occupantPresent && rssi >= kEnterThreshold) {
    occupantPresent = true;
    publishLocationEvent("enter", rssi);
  } else if (occupantPresent && rssi <= kExitThreshold) {
    occupantPresent = false;
    publishLocationEvent("exit", rssi);
  }
}
