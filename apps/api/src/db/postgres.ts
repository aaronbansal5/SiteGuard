import pg from "pg";
import type { Driver } from "./repository.js";
export async function postgresDriver(url: string): Promise<Driver> {
  const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    max: 5,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
  });
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    kind: "postgres",
    async query(sql, params = []) {
      return (await pool.query(sql, params)).rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const d: Driver = {
          kind: "postgres",
          query: async (sql, p = []) => (await c.query(sql, p)).rows,
          exec: async (sql) => {
            await c.query(sql);
          },
          close: async () => {},
        };
        await c.query("SELECT pg_advisory_xact_lock(73920401)");
        const result = await fn(d);
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
