import "reflect-metadata";
import { DataSource } from "typeorm";
import { DeviceEntity } from "./entities/device.entity";
import { MapEntity } from "./entities/map.entity";
import { NotificationEntity } from "./entities/notification.entity";
import { OrganizationEntity } from "./entities/organization.entity";
import { RoomEntity } from "./entities/room.entity";
import { UserEntity } from "./entities/user.entity";

const DEFAULT_DATABASE_URL = "postgresql://ignara:ignara123@localhost:5432/ignara";

export default new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL,
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
