"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { alpha } from "@mui/material/styles";
import { apiRequest } from "../../lib/api";
import { useAuthStore, type SessionUser } from "../../store/auth-store";
import { Container, Card, Typography, TextField, Button, Box, Alert, Stack } from "@mui/material";

type LoginResponse = {
  user: SessionUser;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setUser = useAuthStore((state) => state.setUser);
  const router = useRouter();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const response = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUser(response.user);
      router.push(response.user.role === "employee" ? "/employee-dashboard" : "/dashboard");
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes("Cannot reach API")) {
        setError(
          `${caught.message} Start backend with: pnpm --filter @ignara/api dev. If you are using Codespaces, forward the API port and reload the page.`,
        );
        return;
      }

      setError("Login failed. Please check your email and password.");
    }
  }

  return (
    <Container maxWidth="md" sx={{ display: 'flex', minHeight: '75vh', alignItems: 'center', justifyContent: 'center' }}>
      <Card
        elevation={0}
        sx={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr' },
          overflow: 'hidden',
        }}
      >
        <Box
          sx={(theme) => ({
            p: { xs: 4, md: 5 },
            backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.2)}, transparent 55%),
              linear-gradient(240deg, ${alpha(theme.palette.secondary.main, 0.18)}, transparent 60%)`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 2,
          })}
        >
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2.6, fontWeight: 700 }}>
            Secure Access
          </Typography>
          <Typography variant="h3" sx={{ maxWidth: 360 }}>
            Sign in to the Ignara control grid.
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 360 }}>
            Enter your email and password to access dashboards, device operations, and live office maps.
          </Typography>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Don&apos;t have an account?{" "}
              <Typography
                component={Link}
                href="/signup"
                variant="body2"
                color="primary"
                sx={{ fontWeight: 700, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
              >
                Create one now
              </Typography>
            </Typography>
          </Box>
        </Box>

        <Box component="form" onSubmit={onSubmit} sx={{ p: { xs: 4, md: 5 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.8, fontWeight: 700 }}>
            Workspace Login
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Welcome back
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Enter your credentials to access dashboards and device operations.
          </Typography>

          <TextField
            fullWidth
            label="Email"
            variant="outlined"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <TextField
            fullWidth
            type="password"
            label="Password"
            variant="outlined"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error ? (
            <Alert severity="error">
              {error}
            </Alert>
          ) : null}

          <Button type="submit" variant="contained" color="primary" size="large" fullWidth>
            Sign In
          </Button>
        </Box>
      </Card>
    </Container>
  );
}
