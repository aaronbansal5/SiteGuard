import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Driver } from "./repository.js";
export function sqliteDriver(path: string): Driver {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
  // Transaction callbacks use the direct driver; all outside operations wait
  // for commit/rollback instead of joining the same SQLite connection.
  const direct: Driver = {
    kind: "sqlite",
    async query(sql, params = []) {
      const stmt = db.prepare(sql.replace(/\$\d+/g, "?"));
      return stmt.all(...(params as (string | number | null)[])) as Record<
        string,
        unknown
      >[];
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
  return {
    kind: "sqlite",
    query: (sql, params) => serialize(() => direct.query(sql, params)),
    exec: (sql) => serialize(() => direct.exec(sql)),
    close: () => serialize(() => direct.close()),
    transaction: (fn) =>
      serialize(async () => {
        await direct.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn(direct);
          await direct.exec("COMMIT");
          return result;
        } catch (error) {
          await direct.exec("ROLLBACK");
          throw error;
        }
      }),
  };
}
