import type { ComponentPropsWithoutRef, ReactNode } from "react";

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export function AppContainer({ className, ...props }: ComponentPropsWithoutRef<"main">) {
  return <main className={joinClasses("mx-auto w-full max-w-[92rem] px-4 py-6 md:px-7 md:py-8 lg:px-10", className)} {...props} />;
}

type CardVariant = "default" | "soft" | "elevated";

export function GlassCard({
  className,
  variant = "default",
  ...props
}: ComponentPropsWithoutRef<"section"> & { variant?: CardVariant }) {
  const variantClass =
    variant === "elevated"
      ? "bg-panel/95 shadow-lifted"
      : variant === "soft"
        ? "bg-panel/68 shadow-glass"
        : "bg-panel/85 shadow-card";

  return (
    <section
      className={joinClasses(
        "rounded-2xl border border-outline/60 p-5 backdrop-blur-sm md:p-6",
        variantClass,
        className,
      )}
      {...props}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function AppButton({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  children,
  disabled,
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  const variantClass =
    variant === "primary"
      ? "bg-accent text-accent-contrast hover:bg-accent/90"
      : variant === "secondary"
        ? "border border-outline bg-panel text-text hover:bg-panel-strong"
        : variant === "danger"
          ? "bg-error text-white hover:bg-error/90"
          : "border border-transparent bg-transparent text-text hover:border-outline/60 hover:bg-panel-strong";

  const sizeClass =
    size === "sm"
      ? "px-3 py-1.5 text-xs"
      : size === "lg"
        ? "px-5 py-3 text-base"
        : "px-4 py-2 text-sm";

  return (
    <button
      className={joinClasses(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-60",
        sizeClass,
        variantClass,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function AppInput({
  className,
  invalid = false,
  ...props
}: ComponentPropsWithoutRef<"input"> & { invalid?: boolean }) {
  return (
    <input
      className={joinClasses(
        "w-full rounded-xl border bg-panel-strong px-3 py-2 text-sm text-text placeholder:text-text-dim transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        invalid ? "border-error/70 focus-visible:ring-error/45" : "border-outline",
        className,
      )}
      aria-invalid={invalid || props["aria-invalid"]}
      {...props}
    />
  );
}

export function AppTextArea({
  className,
  invalid = false,
  ...props
}: ComponentPropsWithoutRef<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      className={joinClasses(
        "w-full rounded-xl border bg-panel-strong px-3 py-2 text-sm text-text placeholder:text-text-dim transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        invalid ? "border-error/70 focus-visible:ring-error/45" : "border-outline",
        className,
      )}
      aria-invalid={invalid || props["aria-invalid"]}
      {...props}
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
  const toneClass =
    tone === "success"
      ? "border-success/25 bg-success/15 text-success"
      : tone === "warning"
        ? "border-warning/30 bg-warning/20 text-warning"
        : tone === "error"
          ? "border-error/25 bg-error/15 text-error"
          : "border-outline/80 bg-panel-strong text-text-dim";

  const pulseClass = pulse && tone === "warning" ? "animate-pulse-soft" : "";

  return <span className={joinClasses("inline-flex rounded-full border px-3 py-1 text-xs font-semibold", toneClass, pulseClass)}>{children}</span>;
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
  const toneClass =
    tone === "success"
      ? "border-success/35 bg-success/8"
      : tone === "warning"
        ? "border-warning/35 bg-warning/8"
        : tone === "error"
          ? "border-error/35 bg-error/8"
          : "border-outline/70 bg-panel/70";

  return (
    <article className={joinClasses("rounded-2xl border p-4 shadow-card", toneClass)}>
      <p className="font-data text-xs uppercase tracking-[0.18em] text-text-dim">{label}</p>
      <p className="mt-2 text-3xl font-semibold leading-none text-text">{value}</p>
      {hint ? <p className="mt-2 text-xs text-text-dim">{hint}</p> : null}
    </article>
  );
}
