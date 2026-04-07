import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { EmployeePresenceEvent, LastKnownLocation } from "@ignara/sharedtypes";
import { Server } from "socket.io";
import { Socket } from "socket.io";
import { validateCorsOrigin } from "../common/cors-origin";

@Injectable()
export class LocationsGateway implements OnModuleDestroy {
  private server?: Server;

  initialize(httpServer: unknown) {
    if (this.server) {
      return;
    }

    this.server = new Server(httpServer as any, {
      cors: {
        origin: (origin, callback) => validateCorsOrigin(origin, callback),
        credentials: true,
      },
      path: "/locations/socket.io",
    });

    this.server.of("/locations").on("connection", (socket: Socket) => {
      socket.on("join", (payload: { room: string }) => {
        if (!payload?.room) {
          return;
        }

        socket.join(payload.room);
        socket.emit("joined", payload.room);
      });
    });
  }

  onModuleDestroy() {
    this.server?.close();
    this.server = undefined;
  }

  emitOrgLocation(orgId: string, location: LastKnownLocation) {
    if (!this.server) {
      return;
    }

    this.server.of("/locations").to(`org:${orgId}:locations`).emit("location:update", location);
  }

  emitOrgPresence(orgId: string, payload: EmployeePresenceEvent) {
    if (!this.server) {
      return;
    }

    const eventName = payload.action === "joined" ? "presence:joined" : "presence:left";
    this.server.of("/locations").to(`org:${orgId}:locations`).emit(eventName, payload);
  }
}
