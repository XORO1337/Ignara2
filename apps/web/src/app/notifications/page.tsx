"use client";

import { FormEvent, useState } from "react";
import { alpha } from "@mui/material/styles";
import { Container, Card, Typography, TextField, Button, Box, Stack, Alert, Chip, Divider } from "@mui/material";
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
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card
        sx={(theme) => ({
          p: { xs: 3, md: 4 },
          backgroundImage: `linear-gradient(140deg, ${alpha(theme.palette.primary.main, 0.2)}, transparent 55%),
            linear-gradient(220deg, ${alpha(theme.palette.secondary.main, 0.16)}, transparent 60%)`,
        })}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.8, fontWeight: 700 }}>
              Manager Comms
            </Typography>
            <Typography variant="h3" sx={{ mt: 1, mb: 1 }}>
              Notifications
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Send targeted updates or high-priority broadcasts across your workplace.
            </Typography>
          </Box>
          <Chip label="API backed" variant="outlined" />
        </Box>
      </Card>

      <Card sx={{ p: { xs: 3, md: 4 } }} elevation={0}>
        <form onSubmit={sendTargeted}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
            Compose Message
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={4}
            label="Message"
            variant="outlined"
            margin="normal"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            helperText={`${message.trim().length} characters`}
          />

          <TextField
            fullWidth
            label="Recipient IDs (comma-separated)"
            variant="outlined"
            margin="normal"
            value={recipientIds}
            onChange={(event) => setRecipientIds(event.target.value)}
          />

          <Divider sx={{ my: 3 }} />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isSendingTargeted || isSendingBroadcast}
            >
              {isSendingTargeted ? "Sending..." : "Send Targeted"}
            </Button>
            <Button
              type="button"
              variant="outlined"
              color="secondary"
              disabled={isSendingTargeted || isSendingBroadcast}
              onClick={() => void sendBroadcast()}
            >
              {isSendingBroadcast ? "Sending..." : "Send Broadcast"}
            </Button>
          </Stack>
        </form>
      </Card>

      {status ? (
        <Alert severity={status.includes("Could not") ? "error" : "success"} sx={{ mt: 1 }}>
          {status}
        </Alert>
      ) : null}
    </Container>
  );
}
