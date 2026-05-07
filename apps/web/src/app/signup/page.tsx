"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { alpha } from "@mui/material/styles";
import { apiRequest } from "../../lib/api";
import { useAuthStore, type SessionUser } from "../../store/auth-store";
import {
  Container,
  Card,
  Typography,
  TextField,
  Button,
  Box,
  Alert,
  Stack,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
} from "@mui/material";

type SignupResponse = {
  user: SessionUser;
};

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"admin" | "manager" | "employee">("employee");
  const [error, setError] = useState<string | null>(null);
  const setUser = useAuthStore((state) => state.setUser);
  const router = useRouter();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    try {
      const response = await apiRequest<SignupResponse>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password, role }),
      });
      setUser(response.user);
      router.push(response.user.role === "employee" ? "/employee-dashboard" : "/dashboard");
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes("Cannot reach API")) {
        setError(
          `${caught.message} Start backend with: pnpm --filter @ignara/api dev.`,
        );
        return;
      }

      if (caught instanceof Error && caught.message.includes("400")) {
        setError("An account with this email already exists.");
        return;
      }

      setError("Sign up failed. Please try again.");
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
            backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.secondary.main, 0.2)}, transparent 55%),
              linear-gradient(240deg, ${alpha(theme.palette.primary.main, 0.18)}, transparent 60%)`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 2,
          })}
        >
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2.6, fontWeight: 700 }}>
            Join Ignara
          </Typography>
          <Typography variant="h3" sx={{ maxWidth: 360 }}>
            Create your workspace account.
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 360 }}>
            Sign up to access live dashboards, device management, and real-time office tracking.
          </Typography>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Already have an account?{" "}
              <Typography
                component={Link}
                href="/login"
                variant="body2"
                color="primary"
                sx={{ fontWeight: 700, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
              >
                Sign in instead
              </Typography>
            </Typography>
          </Box>
        </Box>

        <Box component="form" onSubmit={onSubmit} sx={{ p: { xs: 4, md: 5 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.8, fontWeight: 700 }}>
            New Account
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Get started
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Fill in the details below to create your account.
          </Typography>

          <TextField
            fullWidth
            label="Email"
            type="email"
            variant="outlined"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />

          <TextField
            fullWidth
            type="password"
            label="Password"
            variant="outlined"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />

          <TextField
            fullWidth
            type="password"
            label="Confirm Password"
            variant="outlined"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />

          <FormControl fullWidth size="small">
            <InputLabel id="role-label">Role</InputLabel>
            <Select
              labelId="role-label"
              label="Role"
              value={role}
              onChange={(event) => setRole(event.target.value as "admin" | "manager" | "employee")}
            >
              <MenuItem value="employee">Employee</MenuItem>
              <MenuItem value="manager">Manager</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
            </Select>
          </FormControl>

          {error ? (
            <Alert severity="error">
              {error}
            </Alert>
          ) : null}

          <Button type="submit" variant="contained" color="primary" size="large" fullWidth>
            Create Account
          </Button>
        </Box>
      </Card>
    </Container>
  );
}
