export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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
