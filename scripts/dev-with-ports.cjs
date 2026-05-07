const { spawn } = require("child_process");
const {
  RUNTIME_ENV_FILE,
  buildRuntimeEnv,
  resolvePorts,
  writeRuntimeEnv,
} = require("./port-runtime.cjs");

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
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
  const ports = await resolvePorts(["WEB_PORT", "API_PORT"], {
    runtimeFilePath: RUNTIME_ENV_FILE,
  });
  const runtimeEnv = buildRuntimeEnv(ports, process.env);

  await writeRuntimeEnv(runtimeEnv, RUNTIME_ENV_FILE);

  const env = {
    ...process.env,
    ...runtimeEnv,
  };

  console.log(
    `[ports] Web ${runtimeEnv.WEB_PORT} | API ${runtimeEnv.API_PORT} | Postgres ${runtimeEnv.POSTGRES_PORT} | Redis ${runtimeEnv.REDIS_PORT} | MQTT ${runtimeEnv.MQTT_PORT}`,
  );

  const exitCode = await runCommand("turbo", ["dev", "--parallel"], env);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[ports] Failed to start dev environment", error);
  process.exit(1);
});
