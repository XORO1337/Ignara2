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
npm install -g corepack
corepack enable
pnpm install
```

## Start Infra

```bash
pnpm infra:up
```

The infra launcher now checks host ports and automatically increments to the next free port when needed.
Resolved ports are written to `.env.ports` and reused by app startup.

Infra service default starting ports:

- PostgreSQL: starts at `localhost:5432`
- Redis: starts at `localhost:6379`
- Mosquitto MQTT: starts at `localhost:1883` (WebSocket starts at `localhost:9001`)

## Run Apps

Run both apps in dev mode:

```bash
pnpm dev
```

The dev launcher also auto-increments ports when occupied, starting from Web `3000` and API `3001`.
Effective values are stored in `.env.ports` and injected into both apps.

Use fixed legacy behavior (no allocation wrapper):

```bash
pnpm dev:fixed
```

Or run individually:

```bash
pnpm --filter @ignara/api dev   # starts at PORT or :3001 and auto-increments
pnpm --filter @ignara/web dev   # starts at WEB_PORT or :3000 and auto-increments
```

- Web URL: `http://localhost:<WEB_PORT from .env.ports>`
- API URL: `http://localhost:<API_PORT from .env.ports>`

### API URL and CORS Defaults

- The web app auto-detects the API URL for local dev and GitHub Codespaces.
- `NEXT_PUBLIC_API_URL` is optional and only needed when overriding the default behavior.
- `NEXT_PUBLIC_API_PORT` and `NEXT_PUBLIC_WEB_PORT` can be provided to align explicit port mappings.
- API CORS allows localhost and GitHub Codespaces web origins by default.
- `CORS_ORIGIN` is optional and can be set to a comma-separated list of additional origins.
- `CODESPACES_HOST_FORWARDED_ORIGIN` is optional and can be set to explicit forwarded Codespaces web origin(s).
- In GitHub Codespaces, API CORS derives forwarded web origins from `CODESPACE_NAME`, `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`, and the configured web port.
- Developer allowlist access for Map Editor and USB Device Config is configured only on the API via `DEV_USER_EMAILS`.
- `DEV_USER_EMAILS` supports CSV, JSON array, or JSON object/hashmap formats.

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

## BLE Tag Management From Dashboard and USB Console

- Manager/Admin users can register and inspect tags from the dashboard.
- USB provisioning generates BLE-oriented configuration payloads (no WiFi credentials required).
- API endpoints:
  - `GET /devices/tags`
  - `POST /devices/tags` with `{ "deviceId": "tag-003", "roomId": "room-C2" }`
  - `POST /devices/usb/commands/generate` with BLE/config flags
- BLE gateway ingest endpoint:
  - `POST /locations/ingest` with `ScannerLocationEvent` JSON and admin/manager auth token
- Tag firmware exposes BLE provisioning and status characteristics and applies updates received over BLE GATT.

## Backup `./data`

```bash
tar -czf ignara-data-backup-$(date +%Y%m%d-%H%M%S).tar.gz ./data
```
