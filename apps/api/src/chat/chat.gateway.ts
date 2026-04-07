import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { ChatJoinPayload, ChatSendPayload } from "@ignara/sharedtypes";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import { validateCorsOrigin } from "../common/cors-origin";
import { ChatService } from "./chat.service";

type ChatContext = {
  orgId: string;
  employeeId: string;
};

@Injectable()
export class ChatGateway implements OnModuleDestroy {
  private server?: Server;
  private readonly contextBySocketId = new Map<string, ChatContext>();

  constructor(private readonly chatService: ChatService) {}

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
      socket.on("join", (payload: ChatJoinPayload) => {
        this.handleJoin(socket, payload);
      });

      socket.on("chat:send", (payload: ChatSendPayload) => {
        this.handleSend(socket, payload);
      });

      socket.on("disconnect", () => {
        this.contextBySocketId.delete(socket.id);
      });
    });
  }

  onModuleDestroy() {
    this.server?.close();
    this.server = undefined;
    this.contextBySocketId.clear();
  }

  private handleJoin(socket: Socket, payload: ChatJoinPayload) {
    if (!payload?.orgId || !payload?.employeeId) {
      return;
    }

    const orgId = payload.orgId.trim();
    const employeeId = payload.employeeId.trim();
    if (!orgId || !employeeId) {
      return;
    }

    this.contextBySocketId.set(socket.id, { orgId, employeeId });
    socket.join(`org:${orgId}:chat`);
    socket.emit("chat:history", this.chatService.getHistory(orgId));
  }

  private handleSend(socket: Socket, payload: ChatSendPayload) {
    const context = this.contextBySocketId.get(socket.id);
    if (!context || !this.server) {
      return;
    }

    const text = payload?.text?.trim();
    if (!text) {
      return;
    }

    const message = this.chatService.addMessage({
      orgId: context.orgId,
      senderId: context.employeeId,
      text: text.slice(0, 500),
      roomId: payload?.roomId?.trim() || undefined,
    });

    this.server.of("/chat").to(`org:${context.orgId}:chat`).emit("chat:message", message);
  }
}
