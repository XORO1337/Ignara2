import { Module } from "@nestjs/common";
import { LocationsModule } from "../locations/locations.module";
import { ChatGateway } from "./chat.gateway";
import { ChatService } from "./chat.service";

@Module({
  imports: [LocationsModule],
  providers: [ChatService, ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
