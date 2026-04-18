function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

const API_PORT_PROBE_WINDOW = 12;
const API_PROBE_TIMEOUT_MS = 1200;

let resolvedApiUrlCache: string | null = null;
let apiUrlResolutionInFlight: Promise<string> | null = null;

function getConfiguredWebPort(): string {
  return process.env.NEXT_PUBLIC_WEB_PORT?.trim() || "3000";
}

function getConfiguredApiPort(): string {
  return process.env.NEXT_PUBLIC_API_PORT?.trim() || "3001";
}

function getServerApiUrl(): string {
  const internalApiUrl = process.env.INTERNAL_API_URL?.trim();
  if (internalApiUrl) {
    return trimTrailingSlash(internalApiUrl);
  }

  const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredApiUrl) {
    return trimTrailingSlash(configuredApiUrl);
  }

  return `http://localhost:${getConfiguredApiPort()}`;
}

function normalizeConfiguredApiUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimTrailingSlash(trimmed);
}

function parseOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function resolveCodespacesApiUrl(
  host: string,
  protocol: string,
  webPort: string,
  apiPort: string,
): string | null {
  const codespacesMarker = `-${webPort}.`;
  if (!host.includes(codespacesMarker)) {
    return null;
  }

  return `${protocol}//${host.replace(codespacesMarker, `-${apiPort}.`)}`;
}

function resolveBrowserApiUrl(): string {
  const { host, hostname, port, protocol } = window.location;
  const webPort = getConfiguredWebPort();
  const apiPort = getConfiguredApiPort();

  const codespacesApiUrl = resolveCodespacesApiUrl(host, protocol, webPort, apiPort);
  if (codespacesApiUrl) {
    return codespacesApiUrl;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || port === webPort) {
    return `${protocol}//${hostname}:${apiPort}`;
  }

  return `${protocol}//${hostname}:${apiPort}`;
}

function getApiPortCandidates(): number[] {
  const configuredPort = Number(getConfiguredApiPort());
  const basePort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3001;

  return Array.from({ length: API_PORT_PROBE_WINDOW }, (_, index) => basePort + index);
}

function pushUnique(target: string[], value: string) {
  const normalized = trimTrailingSlash(value);
  if (!target.includes(normalized)) {
    target.push(normalized);
  }
}

function getBrowserApiCandidates(preferredApiUrl: string | null): string[] {
  const { host, hostname, protocol } = window.location;
  const webPort = getConfiguredWebPort();
  const portCandidates = getApiPortCandidates();
  const candidates: string[] = [];
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
  const isCodespacesHost = host.includes(`-${webPort}.`);

  if (preferredApiUrl) {
    pushUnique(candidates, preferredApiUrl);
  }

  const preferredOrigin = preferredApiUrl ? parseOrigin(preferredApiUrl) : null;
  if (preferredOrigin) {
    pushUnique(candidates, preferredOrigin);
  }

  const hostnames = new Set([hostname]);
  if (hostname === "localhost") {
    hostnames.add("127.0.0.1");
  }
  if (hostname === "127.0.0.1") {
    hostnames.add("localhost");
  }

  // Port probing is useful for localhost/Codespaces where auto-incremented
  // dev ports are common. For named/remote hosts, prefer the configured API
  // port directly to avoid noisy CORS failures on unrelated services.
  if (isLocalHost || isCodespacesHost) {
    for (const name of hostnames) {
      for (const port of portCandidates) {
        pushUnique(candidates, `${protocol}//${name}:${port}`);
      }
    }
  } else {
    pushUnique(candidates, `${protocol}//${hostname}:${getConfiguredApiPort()}`);
  }

  const codespacesMarker = `-${webPort}.`;
  if (isCodespacesHost) {
    for (const port of portCandidates) {
      const replacedHost = host.replace(codespacesMarker, `-${port}.`);
      pushUnique(candidates, `${protocol}//${replacedHost}`);
    }
  }

  pushUnique(candidates, resolveBrowserApiUrl());
  return candidates;
}

async function probeApiCandidate(candidate: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${candidate}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    return response.ok || response.status === 401 || response.status === 403;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function resolveApiUrlAsync(forceRefresh = false): Promise<string> {
  const configuredApiUrl = normalizeConfiguredApiUrl(process.env.NEXT_PUBLIC_API_URL);

  if (typeof window === "undefined") {
    return getServerApiUrl();
  }

  if (!forceRefresh && resolvedApiUrlCache) {
    return resolvedApiUrlCache;
  }

  if (!forceRefresh && apiUrlResolutionInFlight) {
    return apiUrlResolutionInFlight;
  }

  const resolver = (async () => {
    const candidates = getBrowserApiCandidates(configuredApiUrl);

    const checks = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        ok: await probeApiCandidate(candidate),
      })),
    );

    const reachable = checks.find((entry) => entry.ok)?.candidate;
    if (reachable) {
      resolvedApiUrlCache = reachable;
      return reachable;
    }

    const fallbackCandidate = configuredApiUrl ?? candidates[0] ?? trimTrailingSlash(resolveBrowserApiUrl());
    // Do not cache an unreachable fallback; connectivity may recover shortly
    // and a fresh probe should be allowed to select the correct endpoint.
    return fallbackCandidate;
  })();

  apiUrlResolutionInFlight = resolver;
  try {
    return await resolver;
  } finally {
    apiUrlResolutionInFlight = null;
  }
}

function resolveApiUrl(): string {
  if (typeof window === "undefined") {
    return getServerApiUrl();
  }

  const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredApiUrl) {
    return trimTrailingSlash(configuredApiUrl);
  }

  return trimTrailingSlash(resolveBrowserApiUrl());
}

export const API_URL = resolveApiUrl();

export async function getApiUrl(forceRefresh = false): Promise<string> {
  return resolveApiUrlAsync(forceRefresh);
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  let apiUrl = await resolveApiUrlAsync();

  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (typeof window !== "undefined") {
      apiUrl = await resolveApiUrlAsync(true);

      try {
        response = await fetch(`${apiUrl}${path}`, {
          ...init,
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
          },
        });
      } catch (retryError) {
        const message = retryError instanceof Error ? retryError.message : "Network error";
        throw new Error(`Cannot reach API at ${apiUrl}. ${message}`);
      }
    } else {
      const message = error instanceof Error ? error.message : "Network error";
      throw new Error(`Cannot reach API at ${apiUrl}. ${message}`);
    }
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}
