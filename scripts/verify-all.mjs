// One-shot check of every live integration. Never prints secrets.
// Usage: npm run verify:all   (reads .env; start the Presage bridge first to check it)
import { spawnSync } from "node:child_process";

const results = [];
function run(name, script, skip) {
  if (skip) {
    results.push([name, "SKIP", skip]);
    return;
  }
  console.log(`\n=== ${name} (npm run ${script}) ===`);
  const r = spawnSync("npm", ["run", "--silent", script], {
    stdio: "inherit",
    env: process.env,
  });
  results.push([name, r.status === 0 ? "PASS" : "FAIL", `npm run ${script}`]);
}

run(
  "Tiger Data",
  "verify:tiger",
  process.env.DATABASE_URL ? null : "DATABASE_URL not set",
);
run(
  "Gemini",
  "verify:gemini",
  process.env.GEMINI_API_KEY ? null : "GEMINI_API_KEY not set",
);

const url = process.env.PRESAGE_BRIDGE_URL || "http://127.0.0.1:4311";
const token = process.env.PRESAGE_BRIDGE_TOKEN;
console.log(`\n=== Presage bridge (${url}/v1/health) ===`);
if (!token)
  results.push(["Presage bridge", "SKIP", "PRESAGE_BRIDGE_TOKEN not set"]);
else {
  try {
    const res = await fetch(new URL("/v1/health", url), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    const h = await res.json();
    console.log(`status: ${h.status}${h.reason ? ` (${h.reason})` : ""}`);
    results.push([
      "Presage bridge",
      res.ok && h.status === "ready" ? "PASS" : "FAIL",
      h.reason ?? `status=${h.status}`,
    ]);
  } catch {
    results.push([
      "Presage bridge",
      "FAIL",
      "not running (start it: npm run dev:live, or npm start in integrations/presage-bridge)",
    ]);
  }
}

console.log("\n=== Summary ===");
for (const [n, s, d] of results)
  console.log(`${s.padEnd(4)}  ${n.padEnd(15)} ${d}`);
process.exit(results.some(([, s]) => s === "FAIL") ? 1 : 0);
