import { Injectable } from "@nestjs/common";
import type { ChatMessage } from "@ignara/sharedtypes";
import { randomUUID } from "node:crypto";

const MAX_HISTORY_PER_ORG = 200;

@Injectable()
export class ChatService {
  private readonly historyByOrg = new Map<string, ChatMessage[]>();

  getHistory(orgId: string, limit = 80, mode: "global" | "room" = "global", roomId?: string): ChatMessage[] {
    const history = this.historyByOrg.get(orgId) ?? [];
    const normalizedRoomId = roomId?.trim();
    const filtered =
      mode === "room" && normalizedRoomId
        ? history.filter((entry) => entry.mode === "room" && entry.roomId === normalizedRoomId)
        : history.filter((entry) => entry.mode === "global");
    return filtered.slice(-Math.max(1, limit));
  }

  addMessage(input: {
    orgId: string;
    senderId: string;
    text: string;
    mode: "global" | "room";
    roomId?: string;
  }): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      orgId: input.orgId,
      senderId: input.senderId,
      text: input.text,
      mode: input.mode,
      roomId: input.roomId,
      ts: Date.now(),
    };

    const nextHistory = [...(this.historyByOrg.get(input.orgId) ?? []), message];
    if (nextHistory.length > MAX_HISTORY_PER_ORG) {
      nextHistory.splice(0, nextHistory.length - MAX_HISTORY_PER_ORG);
    }

    this.historyByOrg.set(input.orgId, nextHistory);
    return message;
  }
}
