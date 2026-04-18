function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getConfiguredWebPort(): string {
  return process.env.WEB_PORT?.trim() || process.env.NEXT_PUBLIC_WEB_PORT?.trim() || "3000";
}

function getDefaultAllowedOriginPatterns(): RegExp[] {
  const webPort = escapeRegExp(getConfiguredWebPort());

  return [
    /^https?:\/\/localhost(?::\d+)?$/i,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
    new RegExp(`^https:\\/\\/.+-${webPort}\\..+$`, "i"),
    /^https:\/\/.+-\d+\..+$/i,
  ];
}

function normalizeOrigin(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseOriginList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

function getConfiguredCorsOrigins(): string[] {
  return parseOriginList(process.env.CORS_ORIGIN);
}

function isDevMode(): boolean {
  return (process.env.NODE_ENV ?? "development") !== "production";
}

function getCodespacesForwardedOrigins(): string[] {
  const explicitOrigins = parseOriginList(process.env.CODESPACES_HOST_FORWARDED_ORIGIN);

  const codespaceName = process.env.CODESPACE_NAME?.trim();
  const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN?.trim() || "app.github.dev";
  const webPort = getConfiguredWebPort();

  if (!codespaceName) {
    return explicitOrigins;
  }

  const derivedOrigin = normalizeOrigin(`https://${codespaceName}-${webPort}.${forwardingDomain}`);
  if (explicitOrigins.includes(derivedOrigin)) {
    return explicitOrigins;
  }

  return [...explicitOrigins, derivedOrigin];
}

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const configuredOrigins = getConfiguredCorsOrigins();

  // In development, default to permissive CORS unless explicitly configured.
  if (configuredOrigins.length === 0 && isDevMode()) {
    return true;
  }

  if (configuredOrigins.includes("*")) {
    return true;
  }

  if (configuredOrigins.includes(normalizedOrigin)) {
    return true;
  }

  const codespacesForwardedOrigins = getCodespacesForwardedOrigins();
  if (codespacesForwardedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  return getDefaultAllowedOriginPatterns().some((pattern) => pattern.test(normalizedOrigin));
}

export function validateCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) {
  if (isAllowedCorsOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin ${origin ?? "unknown"} is not allowed by CORS`), false);
}