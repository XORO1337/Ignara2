"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DeviceFeatureToggles,
  ScannerDeviceSummary,
  TagDeviceSummary,
  UsbConfigCommandBundle,
  UsbDeviceConfigRequest,
} from "@ignara/sharedtypes";
import { AppButton, AppContainer, AppInput, AppTextArea, GlassCard, StatusPill } from "../../components/ui";
import { apiRequest } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";

type SessionUser = {
  sub: string;
  email: string;
  role: "admin" | "manager" | "employee";
  orgId: string;
};

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

function parseDevAllowlist() {
  const raw = process.env.NEXT_PUBLIC_DEV_USER_EMAILS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export default function DeviceConfigPage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [targets, setTargets] = useState<UsbTargetsResponse>({ tags: [], scanners: [] });

  const [deviceKind, setDeviceKind] = useState<"tag" | "scanner">("tag");
  const [deviceId, setDeviceId] = useState("");
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");

  const [enablePasswordProtection, setEnablePasswordProtection] = useState(true);
  const [secureConfigPassword, setSecureConfigPassword] = useState("");
  const [features, setFeatures] = useState<DeviceFeatureToggles>(defaultFeatures);

  const [bundle, setBundle] = useState<UsbConfigCommandBundle | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const devAllowlist = useMemo(parseDevAllowlist, []);
  const isDevUser = !!user?.email && devAllowlist.includes(user.email.toLowerCase());
  const hasUsbAccess = user?.role === "admin" || isDevUser;

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
    if (!deviceId.trim() || !wifiSsid.trim() || !wifiPassword.trim()) {
      setStatus("Device, WiFi SSID, and WiFi password are required.");
      return;
    }

    const requestBody: UsbDeviceConfigRequest = {
      deviceId: deviceId.trim(),
      deviceKind,
      wifiSsid: wifiSsid.trim(),
      wifiPassword: wifiPassword.trim(),
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
    <AppContainer className="space-y-4">
      <GlassCard variant="elevated">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.24em] text-text-dim">Admin + Dev Console</p>
            <h1 className="mt-1 text-3xl font-semibold text-balance">USB Device Configuration Dashboard</h1>
            <p className="mt-1 text-sm text-text-dim text-balance">
              Configure employee tags and scanners over USB/ADB with WiFi provisioning and password-protected feature toggles.
            </p>
          </div>
          <StatusPill tone={hasUsbAccess ? "success" : "error"}>{hasUsbAccess ? "Access granted" : "Access denied"}</StatusPill>
        </div>
      </GlassCard>

      {isBootstrapping ? <p className="text-sm text-text-dim">Loading dashboard...</p> : null}
      {!isBootstrapping && !hasUsbAccess ? (
        <GlassCard variant="soft">
          <p className="text-sm text-error">
            This dashboard is restricted to admins and dev allowlisted emails (NEXT_PUBLIC_DEV_USER_EMAILS).
          </p>
        </GlassCard>
      ) : null}

      {!isBootstrapping && hasUsbAccess ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <GlassCard className="space-y-3" variant="soft">
            <h2 className="text-lg font-semibold">Provisioning Form</h2>

            <label className="block text-sm text-text-dim">Device Type</label>
            <div className="flex gap-2">
              <AppButton
                type="button"
                variant={deviceKind === "tag" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setDeviceKind("tag")}
              >
                Tag
              </AppButton>
              <AppButton
                type="button"
                variant={deviceKind === "scanner" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setDeviceKind("scanner")}
              >
                Scanner
              </AppButton>
            </div>

            <label className="block text-sm text-text-dim">Device</label>
            <select
              className="w-full rounded-xl border border-outline bg-panel-strong px-3 py-2 text-sm"
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            >
              <option value="">Select device</option>
              {activeDeviceOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id} ({entry.roomId ?? "unassigned"})
                </option>
              ))}
            </select>

            <label className="block text-sm text-text-dim">WiFi SSID</label>
            <AppInput value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} placeholder="Office-WiFi-5G" />

            <label className="block text-sm text-text-dim">WiFi Password</label>
            <AppInput
              type="password"
              value={wifiPassword}
              onChange={(event) => setWifiPassword(event.target.value)}
              placeholder="Strong network password"
            />

            <label className="mt-2 flex items-center gap-2 text-sm text-text-dim">
              <input
                type="checkbox"
                checked={enablePasswordProtection}
                onChange={(event) => setEnablePasswordProtection(event.target.checked)}
              />
              Protect configuration toggles behind password security
            </label>

            {enablePasswordProtection ? (
              <>
                <label className="block text-sm text-text-dim">Configuration Security Password</label>
                <AppInput
                  type="password"
                  value={secureConfigPassword}
                  onChange={(event) => setSecureConfigPassword(event.target.value)}
                  placeholder="Required for protected features"
                />
              </>
            ) : null}

            <div className="mt-2 rounded-xl border border-outline/70 bg-panel-strong/60 p-3">
              <p className="font-data text-xs uppercase tracking-[0.2em] text-text-dim">Feature Toggles</p>
              <div className="mt-2 grid gap-2 text-sm text-text-dim">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={features.locationTracking}
                    onChange={(event) =>
                      setFeatures((prev) => ({
                        ...prev,
                        locationTracking: event.target.checked,
                      }))
                    }
                  />
                  Location tracking
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={features.notifications}
                    onChange={(event) =>
                      setFeatures((prev) => ({
                        ...prev,
                        notifications: event.target.checked,
                      }))
                    }
                  />
                  Notifications receive/publish
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={features.scannerPresence}
                    onChange={(event) =>
                      setFeatures((prev) => ({
                        ...prev,
                        scannerPresence: event.target.checked,
                      }))
                    }
                  />
                  Scanner presence detection
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={features.debugMode}
                    onChange={(event) =>
                      setFeatures((prev) => ({
                        ...prev,
                        debugMode: event.target.checked,
                      }))
                    }
                  />
                  Debug mode
                </label>
              </div>
            </div>

            <AppButton type="button" onClick={() => void generateCommands()} loading={isGenerating} disabled={isGenerating}>
              Generate USB/ADB Commands
            </AppButton>
          </GlassCard>

          <GlassCard className="space-y-3" variant="soft">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">ADB Command Bundle</h2>
              <AppButton type="button" variant="secondary" size="sm" onClick={() => void copyCommands()} disabled={!bundle}>
                Copy Commands
              </AppButton>
            </div>

            {!bundle ? <p className="text-sm text-text-dim">Generate a command bundle to prepare USB provisioning.</p> : null}

            {bundle ? (
              <>
                <StatusPill tone="success">Generated at {bundle.generatedAtIso}</StatusPill>
                <AppTextArea readOnly className="h-56 font-data text-xs" value={bundle.adbCommands.join("\n")} />
                <p className="font-data text-xs uppercase tracking-[0.2em] text-text-dim">Generated Config JSON</p>
                <AppTextArea readOnly className="h-56 font-data text-xs" value={bundle.configJson} />
              </>
            ) : null}
          </GlassCard>
        </section>
      ) : null}

      {status ? (
        <GlassCard variant="soft">
          <p className="text-sm text-text-dim">{status}</p>
        </GlassCard>
      ) : null}
    </AppContainer>
  );
}
