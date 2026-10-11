import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const token = process.env.FALL_DETECTION_TOKEN;
if (!token || token.length < 32) {
  console.error(
    "Set FALL_DETECTION_TOKEN to an independent secret of at least 32 characters in .env.",
  );
  process.exit(1);
}
const directory = resolve("integrations/fall-detection");
const interpreter = resolve(
  directory,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
if (!existsSync(interpreter)) {
  console.error(
    "Create the fall detector .venv and install requirements-camera.txt first; see integrations/fall-detection/README.md.",
  );
  process.exit(1);
}
const environment = Object.fromEntries(
  ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "SYSTEMROOT", "LANG"]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
const child = spawn(
  interpreter,
  ["-u", "-m", "fall_detection.server", "--source", "camera", "--port", "4322"],
  {
    cwd: directory,
    env: { ...environment, FALL_DETECTION_TOKEN: token },
    stdio: "inherit",
  },
);
child.on("error", () => {
  console.error("Could not start local fall detector");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
