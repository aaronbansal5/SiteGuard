import { readFileSync } from "node:fs";
import { loadConfig } from "../config.js";
import { openRepository } from "./repository.js";
const mode = process.argv[2];
const c = loadConfig();
if ((mode === "postgres" || mode === "timescale") && !c.databaseUrl)
  throw new Error("DATABASE_URL is required; no SQLite fallback");
const r = await openRepository(c);
try {
  if (mode === "timescale") {
    const ext = await r.driver.query(
      "SELECT extversion FROM pg_extension WHERE extname='timescaledb'",
    );
    if (!ext.length)
      throw new Error(
        "TimescaleDB extension must be enabled by your database administrator",
      );
    console.log("TimescaleDB version", ext[0].extversion);
    await r.driver.exec(
      readFileSync(
        "apps/api/src/db/migrations/postgres/002_timescale.sql",
        "utf8",
      ),
    );
  }
  console.log("Migration complete:", r.driver.kind);
} finally {
  await r.close();
}
