"use client";

import { FormEvent, useState } from "react";
import { AppButton, AppContainer, AppInput, AppTextArea, GlassCard, StatusPill } from "../../components/ui";
import { apiRequest } from "../../lib/api";

export default function NotificationsPage() {
  const [message, setMessage] = useState("Standup at 4:00 PM in room-A3");
  const [recipientIds, setRecipientIds] = useState("emp-001,emp-002");
  const [status, setStatus] = useState<string | null>(null);
  const [isSendingTargeted, setIsSendingTargeted] = useState(false);
  const [isSendingBroadcast, setIsSendingBroadcast] = useState(false);

  async function sendTargeted(event: FormEvent) {
    event.preventDefault();
    try {
      setIsSendingTargeted(true);
      await apiRequest("/notifications/targeted", {
        method: "POST",
        body: JSON.stringify({
          message,
          priority: "normal",
          recipientIds: recipientIds
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        }),
      });
      setStatus("Targeted message published.");
    } catch {
      setStatus("Could not publish targeted message. Verify API connectivity.");
    } finally {
      setIsSendingTargeted(false);
    }
  }

  async function sendBroadcast() {
    try {
      setIsSendingBroadcast(true);
      await apiRequest("/notifications/broadcast", {
        method: "POST",
        body: JSON.stringify({
          message,
          priority: "high",
        }),
      });
      setStatus("Broadcast message published.");
    } catch {
      setStatus("Could not publish broadcast message. Verify API connectivity.");
    } finally {
      setIsSendingBroadcast(false);
    }
  }

  return (
    <AppContainer className="space-y-4">
      <GlassCard variant="elevated">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.24em] text-text-dim">Manager Comms</p>
            <h1 className="mt-1 text-3xl font-semibold">Notifications</h1>
            <p className="mt-1 text-sm text-text-dim">Send targeted updates or high-priority broadcasts across your workplace.</p>
          </div>
          <StatusPill tone="neutral">API backed</StatusPill>
        </div>
      </GlassCard>

      <GlassCard variant="soft">
        <form onSubmit={sendTargeted}>
          <p className="font-data text-xs uppercase tracking-[0.2em] text-text-dim">Compose Message</p>
          <label className="mt-2 block text-sm text-text-dim">Message</label>
          <AppTextArea className="mt-1 h-24" value={message} onChange={(event) => setMessage(event.target.value)} />
          <p className="mt-1 text-xs text-text-dim">{message.trim().length} characters</p>

          <label className="mt-4 block text-sm text-text-dim">Recipient IDs (comma-separated)</label>
          <AppInput className="mt-1" value={recipientIds} onChange={(event) => setRecipientIds(event.target.value)} />

          <div className="mt-4 flex flex-wrap gap-3">
            <AppButton type="submit" loading={isSendingTargeted} disabled={isSendingTargeted}>
              Send Targeted
            </AppButton>
            <AppButton type="button" variant="secondary" loading={isSendingBroadcast} disabled={isSendingBroadcast} onClick={() => void sendBroadcast()}>
              Send Broadcast
            </AppButton>
          </div>
        </form>
      </GlassCard>

      {status ? (
        <GlassCard variant="soft">
          <p className="text-sm text-text-dim">{status}</p>
        </GlassCard>
      ) : null}
    </AppContainer>
  );
}
