const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https:\/\/.+-3000\..+$/i,
];

function normalizeOrigin(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getConfiguredCorsOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const configuredOrigins = getConfiguredCorsOrigins();

  if (configuredOrigins.includes("*")) {
    return true;
  }

  if (configuredOrigins.includes(normalizedOrigin)) {
    return true;
  }

  return DEFAULT_ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(normalizedOrigin));
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