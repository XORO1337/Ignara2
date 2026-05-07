import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import { BleBeaconModule } from "./ble-beacon/ble-beacon.module";
import { ChatModule } from "./chat/chat.module";
import { HealthModule } from "./health/health.module";
import { LocationsModule } from "./locations/locations.module";
import { MapsModule } from "./maps/maps.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { VoiceModule } from "./voice/voice.module";
import { DevicesModule } from "./devices/devices.module";
import { DeviceEntity } from "./entities/device.entity";
import { MapEntity } from "./entities/map.entity";
import { NotificationEntity } from "./entities/notification.entity";
import { OrganizationEntity } from "./entities/organization.entity";
import { RoomEntity } from "./entities/room.entity";
import { UserEntity } from "./entities/user.entity";
import { UsersModule } from "./users/users.module";

const DEFAULT_DATABASE_URL = "postgresql://ignara:ignara123@localhost:5432/ignara";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        ".env.ports",
        "../.env.ports",
        "../../.env.ports",
        "apps/api/.env",
        ".env",
        "../.env",
        "../../.env",
      ],
    }),
    TypeOrmModule.forRoot({
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
      synchronize: true,
    }),
    UsersModule,
    AuthModule,
    BleBeaconModule,
    ChatModule,
    HealthModule,
    MapsModule,
    LocationsModule,
    NotificationsModule,
    DevicesModule,
    VoiceModule,
  ],
})
export class AppModule {}
