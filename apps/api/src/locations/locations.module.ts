import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MapEntity } from "../entities/map.entity";
import { LocationsController } from "./locations.controller";
import { LocationsGateway } from "./locations.gateway";
import { LocationsService } from "./locations.service";

@Module({
  imports: [TypeOrmModule.forFeature([MapEntity])],
  controllers: [LocationsController],
  providers: [LocationsGateway, LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
