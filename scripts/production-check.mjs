import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const dir = mkdtempSync(join(tmpdir(), "siteguard-production-"));
const port = process.env.PRODUCTION_CHECK_PORT || "3002";
const base = `http://127.0.0.1:${port}`;
let output = "";
const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: port,
    SQLITE_PATH: join(dir, "verify.sqlite"),
    DATABASE_URL: "",
    HOSTED: "false",
    DEMO_MODE: "true",
    COOKIE_SECRET:
      "production-check-cookie-secret-at-least-thirty-two-characters",
    MEASUREMENT_TOKEN: "production-check-internal-token",
    GEMINI_API_KEY: "",
    GEMINI_MODEL: "",
    PRESAGE_BRIDGE_TOKEN: "",
  },
});
child.stdout.on("data", (b) => {
  output = (output + b).slice(-20000);
});
child.stderr.on("data", (b) => {
  output = (output + b).slice(-20000);
});
const done = new Promise((resolve) => child.once("exit", resolve));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error("Production server exited: " + output);
    try {
      const h = await fetch(base + "/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (h.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  if (!ready)
    throw new Error("Production server did not become ready: " + output);
  const home = await fetch(base);
  const html = await home.text();
  if (!home.ok || !html.includes("SiteGuard"))
    throw new Error("Production landing page not served");
  for (const path of ["/worker", "/history", "/supervisor"]) {
    const response = await fetch(base + path);
    if (!response.ok || !(await response.text()).includes('<div id="root">'))
      throw new Error("SPA route failed: " + path);
  }
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
  if (!asset) throw new Error("Built frontend script missing");
  const javascript = await fetch(base + asset);
  if (
    !javascript.ok ||
    !(javascript.headers.get("content-type") || "").includes("javascript")
  )
    throw new Error("Built script not served");
  for (const path of ["/api/no-such-endpoint", "/assets/missing.js"]) {
    const response = await fetch(base + path);
    if (response.status !== 404)
      throw new Error("Missing resource should return404: " + path);
  }
  console.log(
    "Production checks passed: landing, SPA routes, built assets, health, missing resources.",
  );
} catch (e) {
  console.error(output);
  throw e;
} finally {
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await done;
  clearTimeout(timer);
  rmSync(dir, { recursive: true, force: true });
}
