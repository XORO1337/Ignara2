import "reflect-metadata";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import { DeviceEntity } from "./entities/device.entity";
import { MapEntity } from "./entities/map.entity";
import { NotificationEntity } from "./entities/notification.entity";
import { OrganizationEntity } from "./entities/organization.entity";
import { RoomEntity } from "./entities/room.entity";
import { UserEntity } from "./entities/user.entity";

const DEFAULT_DATABASE_URL = "postgresql://ignara:ignara123@localhost:5432/ignara";

function readEnvValue(filePath: string, key: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const currentKey = trimmed.slice(0, equalsIndex).trim();
    if (currentKey !== key) {
      continue;
    }

    const value = trimmed.slice(equalsIndex + 1).trim();
    return value || undefined;
  }

  return undefined;
}

function resolveDatabaseUrlFromRuntimeEnv(): string | undefined {
  const candidates = [
    resolve(process.cwd(), ".env.ports"),
    resolve(process.cwd(), "../.env.ports"),
    resolve(process.cwd(), "../../.env.ports"),
  ];

  for (const candidate of candidates) {
    const value = readEnvValue(candidate, "DATABASE_URL");
    if (value) {
      return value;
    }
  }

  return undefined;
}

const runtimeDatabaseUrl = process.env.DATABASE_URL?.trim() || resolveDatabaseUrlFromRuntimeEnv();

export default new DataSource({
  type: "postgres",
  url: runtimeDatabaseUrl || DEFAULT_DATABASE_URL,
  entities: [
    OrganizationEntity,
    UserEntity,
    DeviceEntity,
    MapEntity,
    RoomEntity,
    NotificationEntity,
  ],
  migrations: ["src/migrations/*.ts"],
});
