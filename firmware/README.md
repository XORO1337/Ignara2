# Firmware Structure

- `tag`: Employee tag firmware (BLE peripheral with status + provisioning characteristics and serial OLED stub).
- `scanner`: Room scanner firmware (BLE central scanner with service filter and serial enter/exit event stream).

Current implementation status:

- Both firmware targets are BLE-only and contain no WiFi runtime paths.
- `tag` exposes GATT service + characteristics for status and provisioning updates.
- `scanner` filters scans to the Ignara BLE service UUID and emits enter/exit events with RSSI hysteresis.
- Serial output mirrors status/events for quick debugging and gateway integration.

## BLE contract

- Service UUID: `8f240001-6f8d-4f13-a42a-8434f84f0001`
- Tag status characteristic: `8f240002-6f8d-4f13-a42a-8434f84f0001` (read/notify)
- Tag provisioning characteristic: `8f240003-6f8d-4f13-a42a-8434f84f0001` (write/notify)

Status payload shape:

```json
{
	"deviceId": "tag-001",
	"deviceKind": "tag",
	"employeeId": "employee-1",
	"status": "online",
	"uptimeMs": 12345,
	"bleEnabled": true,
	"bleTxPowerDbm": -8,
	"features": {
		"locationTracking": true,
		"notifications": true,
		"scannerPresence": true,
		"debugMode": false
	},
	"ts": 12345
}
```

Provisioning write payload keys currently consumed by firmware:

- `deviceId`
- `bleEnabled`
- `bleTxPowerDbm`
- `locationTracking`
- `notifications`
- `scannerPresence`
- `debugMode`

## Next Step to Reach Full Platform Flow

1. Add/enable BLE gateway on backend side to ingest scanner serial/BLE event stream.
2. Replace tag OLED serial renderer with real OLED draw calls if physical display is connected.

## Firmware Build Flags

Set these per target in `platformio.ini`:

- `BLE_SERVICE_UUID`
- `BLE_STATUS_CHAR_UUID`
- `BLE_PROVISION_CHAR_UUID` (tag only)
- `TAG_DEVICE_ID` and `TAG_EMPLOYEE_ID` (tag only)
