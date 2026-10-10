import pg from "pg";
import type { Driver } from "./repository.js";

// Errors on idle pooled connections (for example a managed service such as
// Tiger Cloud closing an idle connection) are emitted as "error" events. With
// no listener Node.js treats them as uncaught and terminates the API. The pool
// already discards the broken client; the next query opens a new connection or
// fails explicitly. There is never a fallback to another store.
export function logPoolError(error: Error) {
  console.error("PostgreSQL connection error:", error.message);
}

export async function postgresDriver(
  url: string,
  onConnectionError: (error: Error) => void = logPoolError,
): Promise<Driver> {
  const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    max: 5,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
  });
  pool.on("error", onConnectionError);
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
      // A checked-out client has no pool idle listener; keep a listener so a
      // connection terminated mid-transaction rejects the transaction instead
      // of crashing the process.
      let broken: Error | undefined;
      const onError = (error: Error) => {
        broken = error;
        onConnectionError(error);
      };
      c.on("error", onError);
      // One connection runs one statement at a time. Callers (for example
      // Repository.schedule) issue concurrent reads with Promise.all; queue them
      // explicitly instead of relying on pg's deprecated implicit client queue.
      let queue: Promise<unknown> = Promise.resolve();
      const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
        const result = queue.then(operation, operation);
        queue = result.catch(() => {});
        return result;
      };
      const d: Driver = {
        kind: "postgres",
        query: (sql, p = []) =>
          serialized(async () => (await c.query(sql, p)).rows),
        exec: (sql) =>
          serialized(async () => {
            await c.query(sql);
          }),
        close: async () => {},
        transaction: async () => {
          throw new Error("Nested PostgreSQL transactions are not supported");
        },
      };
      let releaseError: Error | undefined;
      try {
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock(73920401)");
        const result = await fn(d);
        await queue;
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await queue;
        try {
          await c.query("ROLLBACK");
        } catch (rollbackError) {
          // The connection is unusable; destroy it instead of returning it to
          // the pool. The original failure is the one reported to the caller.
          releaseError = rollbackError as Error;
        }
        throw e;
      } finally {
        c.removeListener("error", onError);
        c.release(releaseError ?? broken);
      }
    },
  };
}
