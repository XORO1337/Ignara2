import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MapEntity } from "../entities/map.entity";
import { MapsController } from "./maps.controller";
import { MapsService } from "./maps.service";

@Module({
  imports: [TypeOrmModule.forFeature([MapEntity])],
  controllers: [MapsController],
  providers: [MapsService],
  exports: [MapsService],
})
export class MapsModule {}
