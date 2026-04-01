function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseJsonAllowlist(raw: string): string[] | null {
  const value = raw.trim();
  if (!value) {
    return [];
  }

  const looksJson =
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"));

  if (!looksJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => normalizeEmail(entry))
        .filter(Boolean);
    }

    if (parsed && typeof parsed === "object") {
      return Object.keys(parsed)
        .map((entry) => normalizeEmail(entry))
        .filter(Boolean);
    }
  } catch {
    return null;
  }

  return [];
}

function parseCsvAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}

function parseDevAllowlistedEmails(raw: string): Set<string> {
  const jsonEntries = parseJsonAllowlist(raw);
  const entries = jsonEntries ?? parseCsvAllowlist(raw);
  return new Set(entries);
}

let cachedRaw = "";
let cachedAllowlist = new Set<string>();

function getAllowlist(): Set<string> {
  const raw = process.env.DEV_USER_EMAILS ?? "";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedAllowlist = parseDevAllowlistedEmails(raw);
  }

  return cachedAllowlist;
}

export function isDevAllowlistedEmail(email: string | undefined): boolean {
  if (!email) {
    return false;
  }

  return getAllowlist().has(normalizeEmail(email));
}
