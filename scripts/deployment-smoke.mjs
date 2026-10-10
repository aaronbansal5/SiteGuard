// Developer3 deployment smoke. Usage:
//   SMOKE_URL=https://<app>.fly.dev node scripts/deployment-smoke.mjs
// Runs the shared app smoke (health, frontend, fictional roster), then, for any
// non-loopback URL, requires HTTPS, HSTS and an HTTP->HTTPS redirect.
const base = (process.env.SMOKE_URL || "http://127.0.0.1:3001").replace(
  /\/+$/,
  "",
);
process.env.SMOKE_URL = base;
await import("./smoke.mjs");

const url = new URL(base);
const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
if (!loopback) {
  if (url.protocol !== "https:")
    throw new Error("Hosted SMOKE_URL must use https://");
  const health = await fetch(base + "/api/health", {
    signal: AbortSignal.timeout(10000),
  });
  if (
    !(health.headers.get("strict-transport-security") || "").includes("max-age")
  )
    throw new Error("Hosted response missing Strict-Transport-Security");
  const plain = await fetch(`http://${url.host}/api/health`, {
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const location = plain.headers.get("location") || "";
  if (
    plain.status < 300 ||
    plain.status > 399 ||
    !location.startsWith("https://")
  )
    throw new Error(
      `Plain HTTP should redirect to HTTPS (got ${plain.status} ${location})`,
    );
  console.log("Deployment smoke passed: HTTPS, HSTS, HTTP->HTTPS redirect.");
} else {
  console.log("Loopback URL: HTTPS checks skipped (local smoke only).");
}
