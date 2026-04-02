"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "../store/auth-store";
import { ThemeToggle } from "./theme-toggle";

const baseLinks = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/device-config", label: "Device Config" },
  { href: "/notifications", label: "Notifications" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const hydrationAttempted = useAuthStore((state) => state.hydrationAttempted);
  const hydrateSession = useAuthStore((state) => state.hydrateSession);
  const logout = useAuthStore((state) => state.logout);
  const canAccessMapEditor = user?.role === "admin" || user?.isDevAllowlisted === true;

  useEffect(() => {
    if (!hydrationAttempted) {
      void hydrateSession();
    }
  }, [hydrateSession, hydrationAttempted]);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
      router.push("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }

  const links = [...baseLinks];
  if (canAccessMapEditor) {
    links.splice(3, 0, { href: "/map-editor", label: "Map Editor" });
  }

  return (
    <div className="min-h-screen bg-app text-text">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 top-5 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-64 w-64 rounded-full bg-success/12 blur-3xl" />
        <div className="absolute left-1/3 top-2/3 h-80 w-80 rounded-full bg-warning/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-20 border-b border-outline/60 bg-app/86 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[92rem] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-7 lg:px-10">
          <Link href="/" className="text-lg font-semibold tracking-tight text-text">
            IGNARA Control Grid
          </Link>
          <nav className="order-3 flex w-full flex-nowrap items-center gap-1 overflow-x-auto pb-1 text-sm md:order-none md:w-auto md:flex-wrap md:overflow-visible md:pb-0">
            {links.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname === link.href || pathname.startsWith(`${link.href}/`);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`whitespace-nowrap rounded-lg border px-3 py-1.5 font-medium transition duration-200 ${
                    active
                      ? "border-outline bg-panel text-text shadow-sm"
                      : "border-transparent text-text-dim hover:border-outline/60 hover:bg-panel/75 hover:text-text"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            {user ? (
              <>
                <p className="max-w-[19rem] truncate text-sm font-medium text-text">{user.email}</p>
                <button
                  type="button"
                  disabled={isLoggingOut}
                  onClick={() => void handleLogout()}
                  className="inline-flex items-center rounded-full border border-outline bg-panel px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-panel-strong disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isLoggingOut ? "Logging out..." : "Logout"}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center rounded-full border border-outline bg-panel px-3 py-1.5 text-xs font-semibold text-text transition hover:bg-panel-strong"
              >
                {isHydrating ? "Checking session..." : "Sign In"}
              </Link>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
