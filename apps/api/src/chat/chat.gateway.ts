import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { ChatJoinPayload, ChatSendPayload } from "@ignara/sharedtypes";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import { validateCorsOrigin } from "../common/cors-origin";
import { LocationsService } from "../locations/locations.service";
import { UsersService } from "../users/users.service";
import { ChatService } from "./chat.service";

type ChatContext = {
  orgId: string;
  employeeId: string;
  mode: "global" | "room";
  roomId?: string;
};

@Injectable()
export class ChatGateway implements OnModuleDestroy {
  private server?: Server;
  private readonly contextBySocketId = new Map<string, ChatContext>();

  constructor(
    private readonly chatService: ChatService,
    private readonly locationsService: LocationsService,
    private readonly usersService: UsersService,
  ) {}

  initialize(httpServer: unknown) {
    if (this.server) {
      return;
    }

    this.server = new Server(httpServer as any, {
      cors: {
        origin: (origin, callback) => validateCorsOrigin(origin, callback),
        credentials: true,
      },
      path: "/chat/socket.io",
    });

    this.server.of("/chat").on("connection", (socket: Socket) => {
      socket.on("join", async (payload: ChatJoinPayload) => {
        await this.handleJoin(socket, payload);
      });

      socket.on("chat:send", async (payload: ChatSendPayload) => {
        await this.handleSend(socket, payload);
      });

      socket.on("disconnect", () => {
        this.leaveChatChannels(socket);
        this.contextBySocketId.delete(socket.id);
      });
    });
  }

  onModuleDestroy() {
    this.server?.close();
    this.server = undefined;
    this.contextBySocketId.clear();
  }

  private globalChannel(orgId: string) {
    return `org:${orgId}:chat:global`;
  }

  private roomChannel(orgId: string, roomId: string) {
    return `org:${orgId}:chat:room:${roomId}`;
  }

  private leaveChatChannels(socket: Socket) {
    const context = this.contextBySocketId.get(socket.id);
    if (!context) {
      return;
    }

    socket.leave(this.globalChannel(context.orgId));
    if (context.roomId) {
      socket.leave(this.roomChannel(context.orgId, context.roomId));
    }
  }

  private async handleJoin(socket: Socket, payload: ChatJoinPayload) {
    if (!payload?.orgId || !payload?.employeeId) {
      return;
    }

    const orgId = payload.orgId.trim();
    const employeeId = payload.employeeId.trim();
    if (!orgId || !employeeId) {
      return;
    }

    // Enforce chat restriction
    const user = await this.usersService.findByEmail(employeeId);
    if (user && (user.status === "banned" || user.restrictions?.chat)) {
      socket.emit("chat:error", user.status === "banned"
        ? "Your account has been suspended. Chat access is disabled."
        : "Chat access has been restricted by your administrator.");
      socket.emit("chat:history", []);
      return;
    }

    const mode = payload.mode === "room" ? "room" : "global";
    const requestedRoomId = payload.roomId?.trim();

    this.leaveChatChannels(socket);

    if (mode === "room") {
      if (!requestedRoomId) {
        socket.emit("chat:error", "Room mode requires an active room.");
        this.contextBySocketId.set(socket.id, { orgId, employeeId, mode: "room" });
        socket.emit("chat:history", []);
        return;
      }

      const currentLocations = await this.locationsService.getCurrentByOrg(orgId);
      const currentLocation = currentLocations.find((entry) => entry.employeeId === employeeId);
      if (!currentLocation || !currentLocation.connected || currentLocation.roomId !== requestedRoomId) {
        socket.emit("chat:error", "Room channel unavailable: you must be connected inside that room.");
        this.contextBySocketId.set(socket.id, { orgId, employeeId, mode: "room" });
        socket.emit("chat:history", []);
        return;
      }

      this.contextBySocketId.set(socket.id, { orgId, employeeId, mode: "room", roomId: requestedRoomId });
      socket.join(this.roomChannel(orgId, requestedRoomId));
      socket.emit("chat:history", this.chatService.getHistory(orgId, 80, "room", requestedRoomId));
      return;
    }

    this.contextBySocketId.set(socket.id, { orgId, employeeId, mode: "global" });
    socket.join(this.globalChannel(orgId));
    socket.emit("chat:history", this.chatService.getHistory(orgId, 80, "global"));
  }

  private async handleSend(socket: Socket, payload: ChatSendPayload) {
    const context = this.contextBySocketId.get(socket.id);
    if (!context || !this.server) {
      return;
    }

    const text = payload?.text?.trim();
    if (!text) {
      return;
    }

    if (context.mode === "room" && context.roomId) {
      const currentLocations = await this.locationsService.getCurrentByOrg(context.orgId);
      const currentLocation = currentLocations.find((entry) => entry.employeeId === context.employeeId);
      if (!currentLocation || !currentLocation.connected || currentLocation.roomId !== context.roomId) {
        socket.emit("chat:error", "Room channel unavailable: you moved out of the selected room.");
        return;
      }
    } else if (context.mode === "room" && !context.roomId) {
      socket.emit("chat:error", "Room channel unavailable: join a room before sending messages.");
      return;
    }

    const message = this.chatService.addMessage({
      orgId: context.orgId,
      senderId: context.employeeId,
      text: text.slice(0, 500),
      mode: context.mode,
      roomId: context.mode === "room" ? context.roomId : undefined,
    });

    const channel =
      context.mode === "room" && context.roomId
        ? this.roomChannel(context.orgId, context.roomId)
        : this.globalChannel(context.orgId);
    this.server.of("/chat").to(channel).emit("chat:message", message);
  }
}
