function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveCodespacesApiUrl(host: string, protocol: string): string | null {
  if (!host.includes("-3000.")) {
    return null;
  }

  return `${protocol}//${host.replace("-3000.", "-3001.")}`;
}

function resolveBrowserApiUrl(): string {
  const { host, hostname, port, protocol } = window.location;

  const codespacesApiUrl = resolveCodespacesApiUrl(host, protocol);
  if (codespacesApiUrl) {
    return codespacesApiUrl;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || port === "3000") {
    return `${protocol}//${hostname}:3001`;
  }

  return `${protocol}//${hostname}:3001`;
}

function resolveApiUrl(): string {
  const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configuredApiUrl) {
    return trimTrailingSlash(configuredApiUrl);
  }

  if (typeof window !== "undefined") {
    return trimTrailingSlash(resolveBrowserApiUrl());
  }

  return "http://localhost:3001";
}

export const API_URL = resolveApiUrl();

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    throw new Error(`Cannot reach API at ${API_URL}. ${message}`);
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}
