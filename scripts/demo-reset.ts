import { loadConfig } from "../apps/api/src/config.js";
import { openRepository } from "../apps/api/src/db/repository.js";
import { seed } from "../apps/api/src/db/seed.js";
const c = loadConfig();
if (c.hosted || !c.demoMode)
  throw new Error("Reset is restricted to local demo data");
const r = await openRepository(c);
try {
  const sessions = await r.list("sessions");
  if (sessions.some((s) => s.source === "presage"))
    throw new Error("Reset refuses to delete real measurements");
  if (sessions.some((s) => s.status === "active"))
    throw new Error("Stop active sessions before resetting");
  await seed(r, true);
  console.log(
    "Demo reset complete. Stop the API before resetting with this CLI.",
  );
} finally {
  await r.close();
}
