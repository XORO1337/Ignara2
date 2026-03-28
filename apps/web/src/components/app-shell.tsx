"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "../store/auth-store";
import { ThemeToggle } from "./theme-toggle";

const baseLinks = [
  { href: "/", label: "Landing" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/device-config", label: "Device Config" },
  { href: "/notifications", label: "Notifications" },
  { href: "/login", label: "Login" },
];

function parseDevAllowlist() {
  const raw = process.env.NEXT_PUBLIC_DEV_USER_EMAILS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const devAllowlist = useMemo(parseDevAllowlist, []);
  const isDevUser = !!user?.email && devAllowlist.includes(user.email.toLowerCase());
  const canAccessMapEditor = user?.role === "admin" || isDevUser;

  const links = canAccessMapEditor
    ? [...baseLinks.slice(0, 3), { href: "/map-editor", label: "Map Editor" }, ...baseLinks.slice(3)]
    : baseLinks;

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
          <nav className="order-3 flex w-full flex-wrap items-center gap-1 text-sm md:order-none md:w-auto">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg border px-3 py-1.5 font-medium transition duration-200 ${
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
          <ThemeToggle />
        </div>
      </header>

      {children}
    </div>
  );
}
