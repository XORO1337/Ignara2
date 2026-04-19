# Ignara Room Beacon (ESP32)

Firmware that runs on every room-mounted ESP32. Each beacon:

1. Scans continuously for nearby employee tags (ESP32s flashed with
   `../esp-section`) and records the RSSI of each advertisement it sees.
2. Every few seconds, POSTs a batch RSSI report over WiFi to the Ignara API
   at `POST /ble-beacon/report`.
3. Polls `GET /ble-beacon/notifications/<beaconDeviceId>` on a short interval.
   When an admin pushes a notification from the web UI, the beacon briefly
   switches to BLE advertising mode and encodes the message in its device
   name so nearby employee tags can pick it up by scanning.

The beacon corresponds to a "Beacon" prop placed on the map in the Ignara map
editor. Set the prop's `beaconDeviceId` and `beaconRoomId` to match the values
configured below.

## Configuration

```
idf.py menuconfig
  → Ignara Room Beacon Configuration
     - Room beacon device ID            (IGNARA_BEACON_DEVICE_ID)
     - Room ID covered by this beacon   (IGNARA_BEACON_ROOM_ID)
     - Organization ID                  (IGNARA_BEACON_ORG_ID)
     - WiFi SSID / password             (IGNARA_WIFI_SSID, IGNARA_WIFI_PASSWORD)
     - API host / port / HTTPS          (IGNARA_API_HOST, IGNARA_API_PORT, IGNARA_API_SCHEME_HTTPS)
     - Shared device token              (IGNARA_DEVICE_TOKEN)
     - Report interval (ms)             (IGNARA_REPORT_INTERVAL_MS, default 5000)
     - Notification poll interval (ms)  (IGNARA_NOTIFY_POLL_INTERVAL_MS, default 3000)
     - BLE scan window (ms)             (IGNARA_BLE_SCAN_WINDOW_MS, default 15000)
     - Employee adv-name prefix         (IGNARA_BLE_ADV_NAME_PREFIX, default IGN-EMP-)
     - Notification relay seconds       (IGNARA_RELAY_ADV_SECONDS, default 15)
```

`IGNARA_DEVICE_TOKEN` must match the `ROOM_BEACON_DEVICE_TOKEN` env var on the
API server. Leave both blank during local development to disable auth.

## Build & flash

```
idf.py set-target esp32
idf.py menuconfig
idf.py -p <PORT> flash monitor
```

## Data contract with the API

`POST /ble-beacon/report` request body:
```json
{
  "beaconDeviceId": "beacon-room-a",
  "roomId": "room-a",
  "orgId": "default-org",
  "ts": 123456789,
  "readings": [
    { "deviceId": "AABBCCDDEEFF", "employeeId": "emp-024", "rssi": -52, "lastSeenMsAgo": 820 },
    { "deviceId": "112233445566", "employeeId": "emp-031", "rssi": -71, "lastSeenMsAgo": 1400 }
  ]
}
```

`GET /ble-beacon/notifications/<beaconDeviceId>` response:
```json
{
  "beaconDeviceId": "beacon-room-a",
  "pending": [
    {
      "id": "7e7b…",
      "message": "Meeting starting in 5 minutes",
      "priority": "normal",
      "createdAt": 1700000000000,
      "expiresAt": 1700000060000
    }
  ]
}
```
