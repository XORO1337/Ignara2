import Link from "next/link";
import { alpha } from "@mui/material/styles";
import { Container, Box, Typography, Button, Paper, Grid, Stack, Chip } from "@mui/material";

export default function HomePage() {
  return (
    <Container maxWidth="xl" sx={{ py: { xs: 4, md: 6 }, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Paper
        elevation={0}
        sx={(theme) => ({
          position: 'relative',
          overflow: 'hidden',
          p: { xs: 4, md: 6 },
          borderRadius: 6,
          border: 1,
          borderColor: 'divider',
          backgroundImage: `linear-gradient(140deg, ${alpha(theme.palette.primary.main, 0.16)}, transparent 40%),
            linear-gradient(220deg, ${alpha(theme.palette.secondary.main, 0.14)}, transparent 45%)`,
        })}
      >
        <Grid container spacing={4} alignItems="center">
          <Grid item xs={12} md={7}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2.6, fontWeight: 700 }}>
              Ignara Platform
            </Typography>
            <Typography variant="h2" sx={{ mt: 2, mb: 2, maxWidth: 640 }}>
              Smart office operations with a cinematic view of every room.
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 600 }}>
              Ignara brings live presence, device orchestration, and on-site notifications into one workspace.
              Track occupancy in real time, coordinate BLE provisioning, and deliver announcements with one console.
            </Typography>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
              <Button component={Link} href="/login" variant="contained" color="primary" size="large">
                Sign In To Workspace
              </Button>
              <Button component={Link} href="/dashboard" variant="outlined" color="primary" size="large">
                Open Live Dashboard
              </Button>
            </Stack>
          </Grid>
          <Grid item xs={12} md={5}>
            <Stack spacing={2}>
              <Paper sx={{ p: 2.5 }} elevation={0}>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                  Live Signals
                </Typography>
                <Typography variant="h6" sx={{ mt: 1 }}>
                  Real-time room presence
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Socket-powered room presence with contextual overlays for managers and employees.
                </Typography>
              </Paper>
              <Paper sx={{ p: 2.5 }} elevation={0}>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                  Device Control
                </Typography>
                <Typography variant="h6" sx={{ mt: 1 }}>
                  BLE provisioning hub
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Generate USB/ADB bundles, manage tag provisioning, and audit device health in one workflow.
                </Typography>
              </Paper>
            </Stack>
          </Grid>
        </Grid>
        <Stack direction="row" spacing={1} sx={{ mt: 3, flexWrap: 'wrap', gap: 1 }}>
          <Chip label="Realtime Enabled" color="success" size="small" />
          <Chip label="Self Hosted" size="small" />
          <Chip label="MUI Reimagined" size="small" />
        </Stack>
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, height: '100%' }} elevation={0}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 700 }}>
              Live Location Layer
            </Typography>
            <Typography variant="h6" sx={{ mt: 1, mb: 1 }}>
              Room-Scoped Tracking
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Scanner events flow through MQTT and Socket.io to update map presence instantly for managers and admins.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, height: '100%' }} elevation={0}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 700 }}>
              Device Operations
            </Typography>
            <Typography variant="h6" sx={{ mt: 1, mb: 1 }}>
              Tag BLE Provisioning
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Configure BLE behavior for field tags from the management console and deploy updates with USB provisioning bundles.
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 3, height: '100%' }} elevation={0}>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.5, fontWeight: 700 }}>
              Manager Broadcasts
            </Typography>
            <Typography variant="h6" sx={{ mt: 1, mb: 1 }}>
              Notification Routing
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Send targeted or broadcast announcements through API-backed channels integrated with your existing infrastructure.
            </Typography>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}
