const base = process.env.SMOKE_URL || "http://127.0.0.1:3001";
const health = await fetch(base + "/api/health");
if (!health.ok) throw new Error("Health check failed");
const h = await health.json();
if (h.status !== "ok") throw new Error("Health state not ok");
const index = await fetch(base);
if (!index.ok || !(await index.text()).includes("SiteGuard"))
  throw new Error("Frontend not served");
const roster = await fetch(base + "/api/workers");
if (!roster.ok || (await roster.json()).workers.length !== 6)
  throw new Error("Demo roster missing");
console.log(
  "Smoke passed: health, frontend, fictional roster. Database:",
  h.database,
);
