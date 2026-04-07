import { Injectable } from "@nestjs/common";
import type { ChatMessage } from "@ignara/sharedtypes";
import { randomUUID } from "node:crypto";

const MAX_HISTORY_PER_ORG = 200;

@Injectable()
export class ChatService {
  private readonly historyByOrg = new Map<string, ChatMessage[]>();

  getHistory(orgId: string, limit = 80): ChatMessage[] {
    const history = this.historyByOrg.get(orgId) ?? [];
    return history.slice(-Math.max(1, limit));
  }

  addMessage(input: {
    orgId: string;
    senderId: string;
    text: string;
    roomId?: string;
  }): ChatMessage {
    const message: ChatMessage = {
      id: randomUUID(),
      orgId: input.orgId,
      senderId: input.senderId,
      text: input.text,
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
