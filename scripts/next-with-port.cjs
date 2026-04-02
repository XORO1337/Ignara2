const { spawn } = require("child_process");
const path = require("path");
const {
  buildRuntimeEnv,
  resolvePorts,
  writeRuntimeEnv,
} = require("./port-runtime.cjs");

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node ../../scripts/next-with-port.cjs <dev|start>");
  process.exit(1);
}

const workspaceRoot = path.resolve(__dirname, "..");
const runtimeEnvFile = path.join(workspaceRoot, ".env.ports");

function runNext(commandMode, port, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "next",
      [commandMode, "-p", String(port)],
      {
        cwd: process.cwd(),
        env,
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );

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
  const ports = await resolvePorts(["WEB_PORT"], {
    runtimeFilePath: runtimeEnvFile,
  });

  const runtimeEnv = buildRuntimeEnv(ports, process.env);

  await writeRuntimeEnv(runtimeEnv, runtimeEnvFile);

  const env = {
    ...process.env,
    ...runtimeEnv,
  };

  console.log(`[ports] Web ${runtimeEnv.WEB_PORT} | API ${runtimeEnv.API_PORT}`);

  const exitCode = await runNext(mode, runtimeEnv.WEB_PORT, env);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[ports] Failed to start Next.js", error);
  process.exit(1);
});
