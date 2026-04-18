const fs = require("fs/promises");
const net = require("net");
const path = require("path");

const RUNTIME_ENV_FILE = path.resolve(process.cwd(), ".env.ports");

const PORT_DEFAULTS = {
  WEB_PORT: 3000,
  API_PORT: 3001,
  POSTGRES_PORT: 5432,
  REDIS_PORT: 6379,
  MQTT_PORT: 1883,
  MQTT_WS_PORT: 9001,
};

const PORT_KEYS = Object.keys(PORT_DEFAULTS);

function parseEnvFile(content) {
  const data = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    data[key] = value;
  }

  return data;
}

async function loadEnvFile(filePath = RUNTIME_ENV_FILE) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parseEnvFile(content);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function parsePortValue(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return undefined;
  }

  return parsed;
}

function getBasePort(key, env, existingPorts) {
  return (
    parsePortValue(env[key]) ?? parsePortValue(existingPorts[key]) ?? PORT_DEFAULTS[key]
  );
}

function isAddressInUseError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  return error.code === "EADDRINUSE";
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (isAddressInUseError(error)) {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(true);
      });
    });

    server.unref();
    server.listen({ port, host: "0.0.0.0", exclusive: true });
  });
}

async function findAvailablePort(startPort, usedPorts = new Set()) {
  let candidate = startPort;

  while (candidate <= 65535) {
    if (usedPorts.has(candidate)) {
      candidate += 1;
      continue;
    }

    // Prevent assigning the same port to multiple services in the same run,
    // then confirm the candidate is not already occupied on the host.
    const available = await isPortAvailable(candidate);
    if (available) {
      return candidate;
    }

    candidate += 1;
  }

  throw new Error(`Could not find an available port starting at ${startPort}`);
}

async function resolvePorts(requestedKeys, options = {}) {
  const env = options.env ?? process.env;
  const runtimeFilePath = options.runtimeFilePath ?? RUNTIME_ENV_FILE;
  const existingPorts = await loadEnvFile(runtimeFilePath);
  const requested = new Set(requestedKeys);

  const ports = {};
  const usedPorts = new Set();

  for (const key of PORT_KEYS) {
    ports[key] = getBasePort(key, env, existingPorts);
    if (!requested.has(key)) {
      usedPorts.add(ports[key]);
    }
  }

  for (const key of PORT_KEYS) {
    if (!requested.has(key)) {
      continue;
    }

    ports[key] = await findAvailablePort(ports[key], usedPorts);
    usedPorts.add(ports[key]);
  }

  return ports;
}

function rewriteLocalUrlPort(value, fallbackValue, port) {
  const input = value && value.trim() ? value.trim() : fallbackValue;

  try {
    const url = new URL(input);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      url.port = String(port);
      return url.toString();
    }

    return input;
  } catch {
    return input;
  }
}

function buildRuntimeEnv(ports, env = process.env) {
  const configuredPublicApiUrl =
    env.NEXT_PUBLIC_API_URL && env.NEXT_PUBLIC_API_URL.trim()
      ? env.NEXT_PUBLIC_API_URL.trim()
      : "";

  const runtimeEnv = {
    WEB_PORT: String(ports.WEB_PORT),
    API_PORT: String(ports.API_PORT),
    POSTGRES_PORT: String(ports.POSTGRES_PORT),
    REDIS_PORT: String(ports.REDIS_PORT),
    MQTT_PORT: String(ports.MQTT_PORT),
    MQTT_WS_PORT: String(ports.MQTT_WS_PORT),
    NEXT_PUBLIC_WEB_PORT: String(ports.WEB_PORT),
    NEXT_PUBLIC_API_PORT: String(ports.API_PORT),
    NEXT_PUBLIC_API_URL: configuredPublicApiUrl,
    INTERNAL_API_URL: rewriteLocalUrlPort(
      env.INTERNAL_API_URL,
      "http://localhost:3001",
      ports.API_PORT,
    ),
    PORT_FALLBACK_ENABLED: "false",
    PORT: String(ports.API_PORT),
    DATABASE_URL: rewriteLocalUrlPort(
      env.DATABASE_URL,
      "postgresql://ignara:ignara123@localhost:5432/ignara",
      ports.POSTGRES_PORT,
    ),
    REDIS_URL: rewriteLocalUrlPort(env.REDIS_URL, "redis://localhost:6379", ports.REDIS_PORT),
    MQTT_URL: rewriteLocalUrlPort(env.MQTT_URL, "mqtt://localhost:1883", ports.MQTT_PORT),
  };

  return runtimeEnv;
}

function toRuntimeEnvFileContent(runtimeEnv) {
  const orderedKeys = [
    "WEB_PORT",
    "API_PORT",
    "POSTGRES_PORT",
    "REDIS_PORT",
    "MQTT_PORT",
    "MQTT_WS_PORT",
    "NEXT_PUBLIC_WEB_PORT",
    "NEXT_PUBLIC_API_PORT",
    "NEXT_PUBLIC_API_URL",
    "INTERNAL_API_URL",
    "PORT_FALLBACK_ENABLED",
    "PORT",
    "DATABASE_URL",
    "REDIS_URL",
    "MQTT_URL",
  ];

  const lines = ["# Auto-generated by scripts. Do not edit manually."];
  for (const key of orderedKeys) {
    lines.push(`${key}=${runtimeEnv[key]}`);
  }

  return `${lines.join("\n")}\n`;
}

async function writeRuntimeEnv(runtimeEnv, filePath = RUNTIME_ENV_FILE) {
  const content = toRuntimeEnvFileContent(runtimeEnv);
  await fs.writeFile(filePath, content, "utf8");
}

module.exports = {
  RUNTIME_ENV_FILE,
  PORT_DEFAULTS,
  PORT_KEYS,
  buildRuntimeEnv,
  findAvailablePort,
  resolvePorts,
  writeRuntimeEnv,
};
