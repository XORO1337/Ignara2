import Link from "next/link";
import { AppButton, AppContainer, GlassCard, StatusPill } from "../components/ui";

export default function HomePage() {
  return (
    <AppContainer className="space-y-6 py-10 md:py-14">
      <GlassCard className="relative overflow-hidden p-7 md:p-10">
        <div className="absolute right-0 top-0 h-48 w-48 translate-x-1/3 -translate-y-1/3 rounded-full bg-accent/25 blur-3xl" />
        <p className="font-data text-xs uppercase tracking-[0.28em] text-text-dim">Ignara Platform</p>
        <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight md:text-6xl">
          Smart Office Control Center With Live Spatial Intelligence
        </h1>
        <p className="mt-5 max-w-3xl text-base text-text-dim md:text-lg">
          Ignara unifies room-level employee visibility, device operations, and onsite notifications across one self-hosted stack.
          Managers monitor occupancy in real time, assign tag network credentials remotely, and deliver team messages instantly.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login">
            <AppButton>Sign In To Workspace</AppButton>
          </Link>
          <Link href="/dashboard">
            <AppButton variant="secondary">Open Live Dashboard</AppButton>
          </Link>
          <StatusPill tone="success">Realtime Enabled</StatusPill>
          <StatusPill tone="neutral">Self Hosted</StatusPill>
        </div>
      </GlassCard>

      <section className="grid gap-4 md:grid-cols-3">
        <GlassCard>
          <p className="font-data text-xs uppercase tracking-[0.2em] text-text-dim">Live Location Layer</p>
          <h2 className="mt-2 text-xl font-semibold">Room-Scoped Tracking</h2>
          <p className="mt-2 text-sm text-text-dim">
            Scanner events flow through MQTT and Socket.io to update map presence instantly for managers and admins.
          </p>
        </GlassCard>
        <GlassCard>
          <p className="font-data text-xs uppercase tracking-[0.2em] text-text-dim">Device Operations</p>
          <h2 className="mt-2 text-xl font-semibold">Tag WiFi Commanding</h2>
          <p className="mt-2 text-sm text-text-dim">
            Assign per-tag network credentials from dashboard controls and publish retained config messages to field devices.
          </p>
        </GlassCard>
        <GlassCard>
          <p className="font-data text-xs uppercase tracking-[0.2em] text-text-dim">Manager Broadcasts</p>
          <h2 className="mt-2 text-xl font-semibold">Notification Routing</h2>
          <p className="mt-2 text-sm text-text-dim">
            Send targeted or broadcast announcements through API-backed channels integrated with your existing infrastructure.
          </p>
        </GlassCard>
      </section>
    </AppContainer>
  );
}
