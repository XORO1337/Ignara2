"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "../store/auth-store";
import { ToastFeed } from "./toast-feed";
import { ThemeToggle } from "./theme-toggle";
import { alpha } from "@mui/material/styles";
import { AppBar, Toolbar, Typography, Button, Box, Container, Stack } from "@mui/material";

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
  const dashboardHref = user?.role === "employee" ? "/employee-dashboard" : "/dashboard";

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

  const links = [
    { href: "/", label: "Home" },
    { href: dashboardHref, label: "Dashboard" },
    { href: "/device-config", label: "Device Config" },
    { href: "/notifications", label: "Notifications" },
  ];
  if (canAccessMapEditor) {
    links.splice(3, 0, { href: "/map-editor", label: "Map Editor" });
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', color: 'text.primary' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: 'transparent', boxShadow: 'none' }}>
        <Box
          sx={(theme) => ({
            backdropFilter: 'blur(16px)',
            backgroundColor: alpha(theme.palette.background.paper, 0.82),
            borderBottom: 1,
            borderColor: 'divider',
            boxShadow: `0 16px 40px ${alpha(theme.palette.common.black, 0.08)}`,
          })}
        >
          <Container maxWidth="xl">
            <Toolbar disableGutters sx={{ gap: 2, flexWrap: 'wrap', py: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mr: 2 }}>
                <Box
                  sx={(theme) => ({
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    backgroundImage: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                    boxShadow: `0 0 16px ${alpha(theme.palette.primary.main, 0.5)}`,
                  })}
                />
                <Typography
                  variant="h6"
                  component={Link}
                  href="/"
                  sx={(theme) => ({
                    fontWeight: 700,
                    textDecoration: 'none',
                    letterSpacing: 1.2,
                    backgroundImage: `linear-gradient(120deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  })}
                >
                  IGNARA Control Grid
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} sx={{ flexGrow: 1, flexWrap: 'wrap', gap: 1 }}>
                {links.map((link) => {
                  const active =
                    link.href === "/"
                      ? pathname === "/"
                      : pathname === link.href || pathname.startsWith(`${link.href}/`);

                  return (
                    <Button
                      key={link.href}
                      component={Link}
                      href={link.href}
                      variant={active ? "contained" : "text"}
                      disableElevation
                      sx={(theme) => ({
                        borderRadius: 999,
                        px: 2,
                        color: active ? theme.palette.primary.contrastText : theme.palette.text.secondary,
                        backgroundColor: active ? undefined : 'transparent',
                        '&:hover': {
                          backgroundColor: active
                            ? undefined
                            : alpha(theme.palette.primary.main, 0.08),
                        },
                      })}
                    >
                      {link.label}
                    </Button>
                  );
                })}
              </Stack>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                {user ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      sx={(theme) => ({
                        px: 1.5,
                        py: 0.5,
                        borderRadius: 999,
                        bgcolor: alpha(theme.palette.primary.main, 0.12),
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
                      })}
                    >
                      <Typography
                        variant="caption"
                        sx={{ maxWidth: 180, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {user.email}
                      </Typography>
                    </Box>
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={isLoggingOut}
                      onClick={() => void handleLogout()}
                    >
                      {isLoggingOut ? "Logging out..." : "Logout"}
                    </Button>
                  </Stack>
                ) : (
                  <Button
                    component={Link}
                    href="/login"
                    variant="outlined"
                    size="small"
                  >
                    {isHydrating ? "Checking session..." : "Sign In"}
                  </Button>
                )}
                <ThemeToggle />
              </Box>
            </Toolbar>
          </Container>
        </Box>
      </AppBar>

      <Box component="main" sx={{ flexGrow: 1, pb: { xs: 4, md: 6 } }}>
        {children}
      </Box>
      <ToastFeed />
    </Box>
  );
}
