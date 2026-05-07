const { spawn } = require("child_process");
const path = require("path");
const {
  RUNTIME_ENV_FILE,
  buildRuntimeEnv,
  resolvePorts,
  writeRuntimeEnv,
} = require("./port-runtime.cjs");

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }

      resolve(code ?? 0);
    });
  });
}

async function main() {
  const ports = await resolvePorts(["POSTGRES_PORT", "REDIS_PORT", "MQTT_PORT", "MQTT_WS_PORT"], {
    runtimeFilePath: RUNTIME_ENV_FILE,
  });
  const runtimeEnv = buildRuntimeEnv(ports, process.env);

  await writeRuntimeEnv(runtimeEnv, RUNTIME_ENV_FILE);

  console.log(
    `[ports] Postgres ${runtimeEnv.POSTGRES_PORT} | Redis ${runtimeEnv.REDIS_PORT} | MQTT ${runtimeEnv.MQTT_PORT} | MQTT WS ${runtimeEnv.MQTT_WS_PORT}`,
  );

  const envFilePath = path.relative(process.cwd(), RUNTIME_ENV_FILE);
  const exitCode = await runCommand("docker", [
    "compose",
    "--env-file",
    envFilePath,
    "up",
    "-d",
    "postgres",
    "redis",
    "mosquitto",
  ]);

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[ports] Failed to start infrastructure", error);
  process.exit(1);
});
