"use client";

import { useEffect, useState } from "react";
import type {
  DeviceFeatureToggles,
  ScannerDeviceSummary,
  TagDeviceSummary,
  UsbConfigCommandBundle,
  UsbDeviceConfigRequest,
} from "@ignara/sharedtypes";
import { apiRequest } from "../../lib/api";
import { useAuthStore, type SessionUser } from "../../store/auth-store";
import { alpha } from "@mui/material/styles";
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  Chip,
} from "@mui/material";

type UsbTargetsResponse = {
  tags: TagDeviceSummary[];
  scanners: ScannerDeviceSummary[];
};

const defaultFeatures: DeviceFeatureToggles = {
  locationTracking: true,
  notifications: true,
  scannerPresence: true,
  debugMode: false,
};

export default function DeviceConfigPage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [targets, setTargets] = useState<UsbTargetsResponse>({ tags: [], scanners: [] });

  const [deviceKind, setDeviceKind] = useState<"tag" | "scanner">("tag");
  const [deviceId, setDeviceId] = useState("");

  const [enablePasswordProtection, setEnablePasswordProtection] = useState(true);
  const [secureConfigPassword, setSecureConfigPassword] = useState("");
  const [features, setFeatures] = useState<DeviceFeatureToggles>(defaultFeatures);

  const [bundle, setBundle] = useState<UsbConfigCommandBundle | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const hasUsbAccess = user?.role === "admin" || user?.isDevAllowlisted === true;

  const activeDeviceOptions = deviceKind === "tag" ? targets.tags : targets.scanners;

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        let sessionUser = user;
        if (!sessionUser) {
          const me = await apiRequest<{ user: SessionUser }>("/auth/me");
          sessionUser = me.user;
          if (active) {
            setUser(sessionUser);
          }
        }

        if (!sessionUser) {
          throw new Error("Missing session");
        }

        const response = await apiRequest<UsbTargetsResponse>("/devices/usb/targets");

        if (active) {
          setTargets(response);
          const nextDefaultDevice = response.tags[0]?.id ?? response.scanners[0]?.id ?? "";
          setDeviceId(nextDefaultDevice);
          setStatus("USB provisioning targets loaded.");
        }
      } catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : "Unknown error";
          setStatus(`Could not load USB configuration dashboard. ${message}`);
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [setUser, user]);

  useEffect(() => {
    const preferred = activeDeviceOptions[0]?.id ?? "";
    if (!activeDeviceOptions.some((entry) => entry.id === deviceId)) {
      setDeviceId(preferred);
    }
  }, [activeDeviceOptions, deviceId]);

  async function generateCommands() {
    if (!deviceId.trim()) {
      setStatus("Device is required.");
      return;
    }

    const requestBody: UsbDeviceConfigRequest = {
      deviceId: deviceId.trim(),
      deviceKind,
      bleEnabled: true,
      enablePasswordProtection,
      secureConfigPassword: enablePasswordProtection ? secureConfigPassword.trim() : undefined,
      features,
    };

    if (enablePasswordProtection && !requestBody.secureConfigPassword) {
      setStatus("Set a configuration security password or disable protection.");
      return;
    }

    try {
      setIsGenerating(true);
      const response = await apiRequest<UsbConfigCommandBundle>("/devices/usb/commands/generate", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });

      setBundle(response);
      setStatus(`Generated USB/ADB command bundle for ${response.deviceId}.`);
    } catch {
      setStatus("Failed to generate command bundle. Verify admin/dev access and backend health.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyCommands() {
    if (!bundle) {
      return;
    }

    try {
      await navigator.clipboard.writeText(bundle.adbCommands.join("\n"));
      setStatus("ADB command bundle copied to clipboard.");
    } catch {
      setStatus("Clipboard copy failed. Copy commands manually from the panel.");
    }
  }

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 4 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card
        elevation={0}
        sx={(theme) => ({
          p: { xs: 2.5, md: 3.5 },
          backgroundImage: `linear-gradient(140deg, ${alpha(theme.palette.primary.main, 0.18)}, transparent 55%),
            linear-gradient(220deg, ${alpha(theme.palette.secondary.main, 0.16)}, transparent 60%)`,
        })}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2, fontWeight: 700 }}>
              Admin + Dev Console
            </Typography>
            <Typography variant="h3" sx={{ mt: 1 }}>USB Device Configuration Dashboard</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Configure employee tags and scanners over USB/ADB with BLE provisioning and password-protected feature toggles.
            </Typography>
          </Box>
          <Chip color={hasUsbAccess ? "success" : "error"} label={hasUsbAccess ? "Access granted" : "Access denied"} />
        </Box>
      </Card>

      {isBootstrapping ? <Alert severity="info">Loading dashboard...</Alert> : null}
      {!isBootstrapping && !hasUsbAccess ? (
        <Alert severity="warning">This dashboard is restricted to admins and allowlisted developer accounts.</Alert>
      ) : null}

      {!isBootstrapping && hasUsbAccess ? (
        <Grid container spacing={3}>
          <Grid item xs={12} xl={7}>
            <Card elevation={0} sx={{ p: 3, height: '100%' }}>
              <Stack spacing={2}>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                  Provisioning Form
                </Typography>

                <Stack spacing={1}>
                  <Typography variant="subtitle2" color="text.secondary">Device Type</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant={deviceKind === "tag" ? "contained" : "outlined"}
                      onClick={() => setDeviceKind("tag")}
                    >
                      Tag
                    </Button>
                    <Button
                      variant={deviceKind === "scanner" ? "contained" : "outlined"}
                      onClick={() => setDeviceKind("scanner")}
                    >
                      Scanner
                    </Button>
                  </Stack>
                </Stack>

                <FormControl fullWidth>
                  <InputLabel>Device</InputLabel>
                  <Select label="Device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
                    <MenuItem value="">Select device</MenuItem>
                    {activeDeviceOptions.map((entry) => (
                      <MenuItem key={entry.id} value={entry.id}>
                        {entry.id} ({entry.roomId ?? "unassigned"})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControlLabel
                  control={
                    <Switch
                      checked={enablePasswordProtection}
                      onChange={(event) => setEnablePasswordProtection(event.target.checked)}
                    />
                  }
                  label="Protect configuration toggles behind password security"
                />

                {enablePasswordProtection ? (
                  <TextField
                    label="Configuration Security Password"
                    type="password"
                    value={secureConfigPassword}
                    onChange={(event) => setSecureConfigPassword(event.target.value)}
                    placeholder="Required for protected features"
                  />
                ) : null}

                <Card elevation={0} sx={{ p: 2 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.4, fontWeight: 700 }}>
                    Feature Toggles
                  </Typography>
                  <FormGroup sx={{ mt: 1 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={features.locationTracking}
                          onChange={(event) =>
                            setFeatures((prev) => ({
                              ...prev,
                              locationTracking: event.target.checked,
                            }))
                          }
                        />
                      }
                      label="Location tracking"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={features.notifications}
                          onChange={(event) =>
                            setFeatures((prev) => ({
                              ...prev,
                              notifications: event.target.checked,
                            }))
                          }
                        />
                      }
                      label="Notifications receive/publish"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={features.scannerPresence}
                          onChange={(event) =>
                            setFeatures((prev) => ({
                              ...prev,
                              scannerPresence: event.target.checked,
                            }))
                          }
                        />
                      }
                      label="Scanner presence detection"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={features.debugMode}
                          onChange={(event) =>
                            setFeatures((prev) => ({
                              ...prev,
                              debugMode: event.target.checked,
                            }))
                          }
                        />
                      }
                      label="Debug mode"
                    />
                  </FormGroup>
                </Card>

                <Button variant="contained" onClick={() => void generateCommands()} disabled={isGenerating}>
                  {isGenerating ? "Generating..." : "Generate USB/ADB Commands"}
                </Button>
              </Stack>
            </Card>
          </Grid>

          <Grid item xs={12} xl={5}>
            <Card elevation={0} sx={{ p: 3, height: '100%' }}>
              <Stack spacing={2}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                    ADB Command Bundle
                  </Typography>
                  <Button variant="outlined" size="small" onClick={() => void copyCommands()} disabled={!bundle}>
                    Copy Commands
                  </Button>
                </Box>

                {!bundle ? (
                  <Typography variant="body2" color="text.secondary">
                    Generate a command bundle to prepare USB provisioning.
                  </Typography>
                ) : null}

                {bundle ? (
                  <>
                    <Chip color="success" label={`Generated at ${bundle.generatedAtIso}`} />
                    <TextField
                      label="ADB Commands"
                      multiline
                      minRows={8}
                      value={bundle.adbCommands.join("\n")}
                      InputProps={{ readOnly: true }}
                    />
                    <Divider />
                    <TextField
                      label="Generated Config JSON"
                      multiline
                      minRows={8}
                      value={bundle.configJson}
                      InputProps={{ readOnly: true }}
                    />
                  </>
                ) : null}
              </Stack>
            </Card>
          </Grid>
        </Grid>
      ) : null}

      {status ? (
        <Alert severity={status.includes("Failed") || status.includes("Could not") ? "error" : "info"}>{status}</Alert>
      ) : null}
    </Container>
  );
}
