#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <PubSubClient.h>

#ifndef DEVICE_KIND
#define DEVICE_KIND "tag"
#endif

#ifndef MQTT_TOPIC_STATUS
#define MQTT_TOPIC_STATUS "ignara/status/tag-001"
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
const char* kDeviceId = "tag-001";
const char* kEmployeeId = "employee-1";
const char* kConfigTopicPrefix = "ignara/config/";
const unsigned long kBeaconIntervalMs = 5000;
const unsigned long kDisplayIntervalMs = 1000;
const unsigned long kReconnectIntervalMs = 5000;

unsigned long lastBeaconAt = 0;
unsigned long lastDisplayAt = 0;
unsigned long lastReconnectAt = 0;
unsigned long bootAt = 0;
uint32_t frame = 0;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
Preferences preferences;

bool mqttEnabled = true;
String activeSsid;
String activePassword;
String configTopic;

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

void loadWifiConfig() {
  preferences.begin("ignara-tag", true);
  const String persistedSsid = preferences.getString("wifi_ssid", "");
  const String persistedPassword = preferences.getString("wifi_pwd", "");
  preferences.end();

  if (persistedSsid.length() > 0) {
    activeSsid = persistedSsid;
    activePassword = persistedPassword;
    return;
  }

  activeSsid = WIFI_SSID;
  activePassword = WIFI_PASSWORD;
}

void persistWifiConfig(const String& ssid, const String& password) {
  preferences.begin("ignara-tag", false);
  preferences.putString("wifi_ssid", ssid);
  preferences.putString("wifi_pwd", password);
  preferences.end();
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (activeSsid.length() == 0) {
    return;
  }

  Serial.print("[WIFI] connecting to ");
  Serial.println(activeSsid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(activeSsid.c_str(), activePassword.c_str());
}

void applyWifiConfig(const String& ssid, const String& password) {
  activeSsid = ssid;
  activePassword = password;
  persistWifiConfig(ssid, password);

  Serial.println("[CONFIG] new WiFi credentials saved, reconnecting");
  mqttClient.disconnect();
  WiFi.disconnect(true, false);
}

void handleMqttMessage(char* topic, byte* payload, unsigned int length) {
  String body;
  body.reserve(length);
  for (unsigned int i = 0; i < length; i += 1) {
    body += static_cast<char>(payload[i]);
  }

  Serial.print("[MQTT:RECV] topic=");
  Serial.println(topic);
  Serial.println(body);

  if (String(topic) != configTopic) {
    return;
  }

  const String nextSsid = extractJsonString(body, "ssid");
  const String nextPassword = extractJsonString(body, "password");
  if (nextSsid.length() == 0 || nextPassword.length() == 0) {
    Serial.println("[CONFIG] ignored invalid wifi config payload");
    return;
  }

  applyWifiConfig(nextSsid, nextPassword);
}

void connectMqtt() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected() || !mqttEnabled) {
    return;
  }

  char clientId[64];
  snprintf(clientId, sizeof(clientId), "ignara-tag-%lu", millis());

  Serial.print("[MQTT] connecting to ");
  Serial.print(MQTT_HOST);
  Serial.print(":");
  Serial.println(MQTT_PORT);

  if (mqttClient.connect(clientId)) {
    Serial.println("[MQTT] connected");
    if (mqttClient.subscribe(configTopic.c_str(), 1)) {
      Serial.print("[MQTT] subscribed: ");
      Serial.println(configTopic);
    }
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

void publishStatusBeacon() {
  const unsigned long ts = millis();
  char payload[320];

  snprintf(
    payload,
    sizeof(payload),
    "{\"deviceId\":\"%s\",\"deviceKind\":\"%s\",\"employeeId\":\"%s\",\"status\":\"online\",\"uptimeMs\":%lu,\"ts\":%lu}",
    kDeviceId,
    DEVICE_KIND,
    kEmployeeId,
    ts - bootAt,
    ts);

  if (mqttClient.connected()) {
    const ok = mqttClient.publish(MQTT_TOPIC_STATUS, payload);
    if (!ok) {
      Serial.println("[MQTT] publish failed");
    }
  }

  Serial.print("[MQTT:STATUS] topic=");
  Serial.println(MQTT_TOPIC_STATUS);
  Serial.println(payload);
}

void renderOledStub() {
  // OLED is not wired in this scaffold; render equivalent frame over serial.
  const unsigned long ts = millis();
  frame += 1;
  Serial.print("[OLED] ");
  Serial.print("ID=");
  Serial.print(kEmployeeId);
  Serial.print(" | Uptime=");
  Serial.print((ts - bootAt) / 1000);
  Serial.print("s | Frame=");
  Serial.println(frame);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  loadWifiConfig();
  configTopic = String(kConfigTopicPrefix) + kDeviceId;

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(handleMqttMessage);

  if (activeSsid.startsWith("CHANGE_ME_")) {
    mqttEnabled = false;
    Serial.println("[CONFIG] WiFi/MQTT disabled. Set WIFI_SSID/WIFI_PASSWORD build flags.");
  }

  bootAt = millis();
  lastBeaconAt = bootAt;
  lastDisplayAt = bootAt;

  Serial.println("Ignara TAG firmware");
  Serial.println("Mode: status beacons over MQTT + OLED serial renderer");
}

void loop() {
  const unsigned long now = millis();

  ensureConnectivity();
  mqttClient.loop();

  if (now - lastDisplayAt >= kDisplayIntervalMs) {
    renderOledStub();
    lastDisplayAt = now;
  }

  if (now - lastBeaconAt >= kBeaconIntervalMs) {
    publishStatusBeacon();
    lastBeaconAt = now;
  }

  delay(20);
}
