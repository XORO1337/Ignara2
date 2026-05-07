import React, { type ReactNode } from "react";
import type { ButtonProps, CardProps, ContainerProps, TextFieldProps } from "@mui/material";
import { Container, Card, Button, TextField, Chip, Typography, CircularProgress } from "@mui/material";

export function AppContainer({ children, sx, ...props }: ContainerProps) {
  return (
    <Container
      maxWidth="xl"
      component={props.component ?? "main"}
      sx={{ py: { xs: 3, md: 4 }, ...(sx ?? {}) }}
      {...props}
    >
      {children}
    </Container>
  );
}

type CardVariant = "default" | "soft" | "elevated";

export function GlassCard({
  variant = "default",
  children,
  sx,
  ...props
}: CardProps & { variant?: CardVariant }) {
  const elevation = variant === "elevated" ? 4 : variant === "soft" ? 1 : 2;

  return (
    <Card
      component="section"
      elevation={elevation}
      sx={{ p: { xs: 2, md: 3 }, borderRadius: 4, mb: 2, ...(sx ?? {}) }}
      {...props}
    >
      {children}
    </Card>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function AppButton({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  ...props
}: ButtonProps & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  const muiVariant = variant === "primary" ? "contained" : variant === "secondary" ? "outlined" : "text";
  const muiColor = variant === "danger" ? "error" : "primary";
  const muiSize = size === "sm" ? "small" : size === "lg" ? "large" : "medium";

  return (
    <Button
      variant={muiVariant}
      color={muiColor}
      size={muiSize}
      disabled={props.disabled || loading}
      sx={{ textTransform: 'none', borderRadius: 3, fontWeight: 600 }}
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
      {...(props as any)}
    >
      {children}
    </Button>
  );
}

export function AppInput({
  invalid = false,
  ...props
}: TextFieldProps & { invalid?: boolean }) {
  return (
    <TextField
      {...props}
      error={invalid || props.error}
      variant={props.variant ?? "outlined"}
      size={props.size ?? "small"}
      fullWidth={props.fullWidth ?? true}
    />
  );
}

export function AppTextArea({
  invalid = false,
  ...props
}: TextFieldProps & { invalid?: boolean }) {
  return (
    <TextField
      {...props}
      error={invalid || props.error}
      variant={props.variant ?? "outlined"}
      size={props.size ?? "small"}
      fullWidth={props.fullWidth ?? true}
      multiline
      minRows={props.minRows ?? 3}
    />
  );
}

export function StatusPill({
  tone,
  children,
  pulse = false,
}: {
  tone: "neutral" | "success" | "warning" | "error";
  children: ReactNode;
  pulse?: boolean;
}) {
  const muiColor = tone === "neutral" ? "default" : tone === "success" ? "success" : tone === "warning" ? "warning" : "error";

  return (
    <Chip
      size="small"
      color={muiColor}
      label={children}
      variant={tone === "neutral" ? "outlined" : "filled"}
      sx={{ fontWeight: 600, borderRadius: 999 }}
    />
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "error";
}) {
  return (
    <Card elevation={2} sx={{ p: 2.5, borderRadius: 4, borderLeft: 4, borderColor: `${tone}.main` }}>
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>
        {label}
      </Typography>
      <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {hint}
        </Typography>
      ) : null}
    </Card>
  );
}
