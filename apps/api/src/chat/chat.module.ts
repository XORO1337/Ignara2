import { Module } from "@nestjs/common";
import { LocationsModule } from "../locations/locations.module";
import { UsersModule } from "../users/users.module";
import { ChatGateway } from "./chat.gateway";
import { ChatService } from "./chat.service";

@Module({
  imports: [LocationsModule, UsersModule],
  providers: [ChatService, ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
