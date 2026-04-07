import { Module } from "@nestjs/common";
import { LocationsModule } from "../locations/locations.module";
import { VoiceGateway } from "./voice.gateway";

@Module({
  imports: [LocationsModule],
  providers: [VoiceGateway],
  exports: [VoiceGateway],
})
export class VoiceModule {}
