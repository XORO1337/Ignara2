# Firmware Structure

- `tag`: Employee ID/tag firmware (BLE beacon + MQTT notifications + OLED rendering).
- `scanner`: Room scanner firmware (BLE scanning + MQTT enter/exit publish).

Current implementation status:

- Both firmware targets now publish MQTT payloads when WiFi/MQTT build flags are configured.
- `tag` emits status-beacon JSON every 5 seconds and OLED-equivalent frame text every 1 second.
- `scanner` emits contract-compatible `ScannerLocationEvent` JSON with enter/exit transitions using RSSI hysteresis.
- Serial output mirrors every published payload for quick debugging.

## MQTT contracts
- Location topic: `ignara/location/{roomId}`
- Targeted notifications: `ignara/notifications/{empId}`
- Broadcast notifications: `ignara/notifications/broadcast`
- Device status: `ignara/status/{deviceId}`
- Device config: `ignara/config/{deviceId}`

## Next Step to Reach Hardware MVP

1. Replace scanner RSSI simulator with BLE scan results.
2. Replace tag OLED serial renderer with real OLED library draw calls.

## Firmware Build Flags

Set these per target in `platformio.ini`:

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `MQTT_HOST`
- `MQTT_PORT`

If `WIFI_SSID` is left as `CHANGE_ME_WIFI_SSID`, firmware stays in serial-only mode and skips MQTT connection attempts.
