# Ignara

Indoor location and notification platform built as a pnpm monorepo.

## Stack Overview

- API: NestJS + TypeORM + PostgreSQL + Redis + MQTT
- Web: Next.js 14 + React + Tailwind + Socket.IO client
- Infra: Docker Compose (Postgres, Redis, Mosquitto)
- Firmware examples: PlatformIO projects in `firmware/`

## Prerequisites

- Node.js 20.11+ (repo requires Node >=20.11.0)
- pnpm 9.x (`corepack enable` recommended)
- Docker Engine + Docker Compose

## Install

```bash
corepack enable
pnpm install
```

## Start Infra

```bash
pnpm infra:up
```

Services and ports:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- Mosquitto MQTT: `localhost:1883` (WebSocket: `localhost:9001`)

## Run Apps

Run both apps in dev mode:

```bash
pnpm dev
```

Or run individually:

```bash
pnpm --filter @ignara/api dev   # API on :3001
pnpm --filter @ignara/web dev   # Web on :3000
```

- Web: `http://localhost:3000`
- API: `http://localhost:3001`

## Seed Users

Run DB setup + seed script:

```bash
pnpm db:setup
```

Default demo users:

- `admin@ignara.local` / `admin123`
- `manager@ignara.local` / `manager123`
- `employee@ignara.local` / `employee123`

## MQTT Test Commands (Enter/Exit)

The API subscribes to `ignara/location/+` and expects JSON payloads shaped like `ScannerLocationEvent`.

Enter event example:

```bash
docker exec ignara-mosquitto mosquitto_pub -h localhost -p 1883 \
  -t ignara/location/scanner-01 \
  -m '{"employeeId":"employee-1","scannerId":"scanner-01","roomId":"room-a","rssi":-58,"event":"enter","orgId":"default-org","ts":1742200000000}'
```

Exit event example:

```bash
docker exec ignara-mosquitto mosquitto_pub -h localhost -p 1883 \
  -t ignara/location/scanner-01 \
  -m '{"employeeId":"employee-1","scannerId":"scanner-01","roomId":"room-a","rssi":-60,"event":"exit","orgId":"default-org","ts":1742200005000}'
```

## Location Persistence Rule

Only `event: "enter"` updates last-known location in Redis. `event: "exit"` is ignored and does not overwrite stored location.

## Tag WiFi Assignment From Manager Dashboard

- Manager/Admin users can assign WiFi credentials per tag from the dashboard.
- API endpoints:
  - `GET /devices/tags`
  - `POST /devices/tags` with `{ "deviceId": "tag-003", "roomId": "room-C2" }`
  - `PUT /devices/tags/:id/wifi` with `{ "ssid": "...", "password": "..." }`
- The API publishes retained MQTT config messages to `ignara/config/{deviceId}`.
- Tag firmware subscribes to its config topic (example: `ignara/config/tag-001`), stores credentials in NVS, and reconnects WiFi using assigned credentials.

## Backup `./data`

```bash
tar -czf ignara-data-backup-$(date +%Y%m%d-%H%M%S).tar.gz ./data
```