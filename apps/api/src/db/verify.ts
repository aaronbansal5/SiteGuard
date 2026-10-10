// Read-only check of the configured PostgreSQL / Tiger Data service.
// Prints connection facts without ever printing DATABASE_URL or credentials.
import { loadConfig } from "../config.js";
import { openRepository } from "./repository.js";

const c = loadConfig();
if (!c.databaseUrl) {
  console.error("FAIL: DATABASE_URL is not set (no SQLite fallback).");
  process.exit(1);
}
let host: string;
try {
  host = new URL(c.databaseUrl).hostname.replace(/^[^.]+/, "***");
} catch {
  // Node's ERR_INVALID_URL error carries the full input (including the
  // password) and is printed verbatim if uncaught. Never echo it.
  console.error(
    "FAIL: DATABASE_URL is not a valid URL (value hidden). Percent-encode special characters in the password.",
  );
  process.exit(1);
}
let ok = true;
const r = await openRepository(c);
try {
  const [v] = (await r.driver.query("SELECT version()")) as {
    version: string;
  }[];
  const [tls] = (await r.driver.query(
    "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()",
  )) as { ssl: boolean; version: string | null }[];
  const ext = (await r.driver.query(
    "SELECT extversion FROM pg_extension WHERE extname='timescaledb'",
  )) as { extversion: string }[];
  const tables = (await r.driver.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1",
  )) as { table_name: string }[];
  let hyper = false;
  if (ext.length) {
    const h = (await r.driver.query(
      "SELECT count(*)::text AS n FROM timescaledb_information.hypertables WHERE hypertable_name='vital_readings'",
    )) as { n: string }[];
    hyper = h[0]?.n === "1";
  }
  console.log("host:           ", host);
  console.log("server:         ", v.version.split(" on ")[0]);
  console.log("TLS:            ", tls?.ssl ? `yes (${tls.version})` : "NO");
  console.log("timescaledb:    ", ext[0]?.extversion ?? "not installed");
  console.log(
    "tables:         ",
    tables.map((t) => t.table_name).join(", ") || "(none)",
  );
  console.log("vital_readings hypertable:", hyper ? "yes" : "no");
  if (!tls?.ssl) ok = false;
  if (!tables.some((t) => t.table_name === "vital_readings")) {
    console.log("-> run: npm run db:migrate:postgres");
    ok = false;
  }
  if (!hyper) {
    console.log("-> run: npm run db:enable-timescale");
    ok = false;
  }
} finally {
  await r.close();
}
console.log(
  ok ? "PASS: Tiger Data / PostgreSQL ready" : "FAIL: see notes above",
);
process.exit(ok ? 0 : 1);
