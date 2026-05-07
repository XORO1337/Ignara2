import { Module } from "@nestjs/common";
import { LocationsModule } from "../locations/locations.module";
import { UsersModule } from "../users/users.module";
import { VoiceGateway } from "./voice.gateway";

@Module({
  imports: [LocationsModule, UsersModule],
  providers: [VoiceGateway],
  exports: [VoiceGateway],
})
export class VoiceModule {}
