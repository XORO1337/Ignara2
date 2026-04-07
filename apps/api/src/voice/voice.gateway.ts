import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { VoiceErrorPayload, VoiceJoinPayload, VoiceSignalPayload } from "@ignara/sharedtypes";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import { validateCorsOrigin } from "../common/cors-origin";
import { LocationsService } from "../locations/locations.service";

type VoiceParticipant = {
  orgId: string;
  employeeId: string;
  roomId: string;
};

@Injectable()
export class VoiceGateway implements OnModuleDestroy {
  private server?: Server;
  private readonly participantBySocketId = new Map<string, VoiceParticipant>();
  private readonly roomMembers = new Map<string, Map<string, string>>();

  constructor(private readonly locationsService: LocationsService) {}

  initialize(httpServer: unknown) {
    if (this.server) {
      return;
    }

    this.server = new Server(httpServer as any, {
      cors: {
        origin: (origin, callback) => validateCorsOrigin(origin, callback),
        credentials: true,
      },
      path: "/voice/socket.io",
    });

    this.server.of("/voice").on("connection", (socket: Socket) => {
      socket.on("voice:join", async (payload: VoiceJoinPayload) => {
        await this.handleJoin(socket, payload);
      });

      socket.on("voice:leave", () => {
        this.leaveRoom(socket);
      });

      socket.on("voice:signal", (payload: VoiceSignalPayload) => {
        this.handleSignal(socket, payload);
      });

      socket.on("disconnect", () => {
        this.leaveRoom(socket);
      });
    });
  }

  onModuleDestroy() {
    this.server?.close();
    this.server = undefined;
    this.participantBySocketId.clear();
    this.roomMembers.clear();
  }

  private roomKey(orgId: string, roomId: string) {
    return `org:${orgId}:voice:${roomId}`;
  }

  private async handleJoin(socket: Socket, payload: VoiceJoinPayload) {
    if (!payload?.orgId || !payload?.employeeId || !payload?.roomId) {
      this.emitVoiceError(socket, {
        reason: "invalid-payload",
        message: "Voice join denied: orgId, employeeId, and roomId are required.",
      });
      return;
    }

    const orgId = payload.orgId.trim();
    const employeeId = payload.employeeId.trim();
    const roomId = payload.roomId.trim();
    if (!orgId || !employeeId || !roomId) {
      this.emitVoiceError(socket, {
        reason: "invalid-payload",
        message: "Voice join denied: orgId, employeeId, and roomId are required.",
      });
      return;
    }

    const currentLocations = await this.locationsService.getCurrentByOrg(orgId);
    const currentLocation = currentLocations.find((entry) => entry.employeeId === employeeId);
    if (!currentLocation) {
      this.emitVoiceError(socket, {
        reason: "missing-location",
        message: "Voice join denied: current location is not available.",
        requestedRoomId: roomId,
      });
      return;
    }

    if (!currentLocation.connected) {
      this.emitVoiceError(socket, {
        reason: "not-connected",
        message: "Voice join denied: user is disconnected.",
        requestedRoomId: roomId,
        currentRoomId: currentLocation.roomId,
      });
      return;
    }

    if (currentLocation.roomId !== roomId) {
      this.emitVoiceError(socket, {
        reason: "room-mismatch",
        message: "Voice join denied: user must be connected in the target room.",
        requestedRoomId: roomId,
        currentRoomId: currentLocation.roomId,
      });
      return;
    }

    this.leaveRoom(socket);

    const roomKey = this.roomKey(orgId, roomId);
    const members = this.roomMembers.get(roomKey) ?? new Map<string, string>();
    const peers = [...members.keys()].filter((peerId) => peerId !== employeeId);

    members.set(employeeId, socket.id);
    this.roomMembers.set(roomKey, members);
    this.participantBySocketId.set(socket.id, { orgId, employeeId, roomId });

    socket.join(roomKey);
    socket.emit("voice:peers", { roomId, peers });
    socket.to(roomKey).emit("voice:peer-joined", { employeeId });
  }

  private leaveRoom(socket: Socket) {
    const participant = this.participantBySocketId.get(socket.id);
    if (!participant) {
      return;
    }

    const roomKey = this.roomKey(participant.orgId, participant.roomId);
    const members = this.roomMembers.get(roomKey);
    if (members) {
      members.delete(participant.employeeId);
      if (members.size === 0) {
        this.roomMembers.delete(roomKey);
      }
    }

    socket.leave(roomKey);
    this.participantBySocketId.delete(socket.id);
    socket.to(roomKey).emit("voice:peer-left", { employeeId: participant.employeeId });
  }

  private handleSignal(socket: Socket, payload: VoiceSignalPayload) {
    if (!this.server || !payload?.to || !payload?.signal) {
      this.emitVoiceError(socket, {
        reason: "invalid-payload",
        message: "Voice signal rejected: invalid target or signal payload.",
      });
      return;
    }

    const participant = this.participantBySocketId.get(socket.id);
    if (!participant) {
      this.emitVoiceError(socket, {
        reason: "not-in-room",
        message: "Voice signal rejected: user is not currently in a voice room.",
      });
      return;
    }

    const roomKey = this.roomKey(participant.orgId, participant.roomId);
    const members = this.roomMembers.get(roomKey);
    const targetSocketId = members?.get(payload.to);
    if (!targetSocketId) {
      this.emitVoiceError(socket, {
        reason: "not-in-room",
        message: "Voice signal rejected: target user is not in the active room.",
      });
      return;
    }

    this.server.of("/voice").to(targetSocketId).emit("voice:signal", {
      from: participant.employeeId,
      signal: payload.signal,
    });
  }

  private emitVoiceError(socket: Socket, payload: VoiceErrorPayload) {
    socket.emit("voice:error", payload);
  }
}
