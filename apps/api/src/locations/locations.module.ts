import { Module } from "@nestjs/common";
import { LocationsController } from "./locations.controller";
import { LocationsGateway } from "./locations.gateway";
import { LocationsService } from "./locations.service";

@Module({
  controllers: [LocationsController],
  providers: [LocationsGateway, LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
