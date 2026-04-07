import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BleBeaconController } from "./ble-beacon.controller";
import { BleBeaconService } from "./ble-beacon.service";
import { DevicesModule } from "../devices/devices.module";
import { LocationsModule } from "../locations/locations.module";
import { MapEntity } from "../entities/map.entity";
import { UserEntity } from "../entities/user.entity";
import { DeviceEntity } from "../entities/device.entity";

@Module({
  imports: [
    ConfigModule,
    DevicesModule,
    LocationsModule,
    TypeOrmModule.forFeature([MapEntity, UserEntity, DeviceEntity]),
  ],
  controllers: [BleBeaconController],
  providers: [BleBeaconService],
  exports: [BleBeaconService],
})
export class BleBeaconModule {}
