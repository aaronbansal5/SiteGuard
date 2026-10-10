import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postgresDriver } from "../src/db/postgres.js";
import { openRepository } from "../src/db/repository.js";
import { loadConfig } from "../src/config.js";

// Runs without any database: an unreachable PostgreSQL URL must fail
// explicitly and never create or use a SQLite store.
it("fails explicitly when PostgreSQL is unreachable, with no SQLite fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "siteguard-pg-fallback-"));
  const sqlitePath = join(dir, "should-not-exist.sqlite");
  try {
    await expect(
      openRepository(
        loadConfig({
          // Port 1 on loopback is reserved and refuses connections.
          databaseUrl: "postgres://nobody:nothing@127.0.0.1:1/none",
          sqlitePath,
          cookieSecret: "fallback-test-cookie-at-least-thirty-two-chars",
          measurementToken: "fallback-test-token",
        }),
      ),
    ).rejects.toThrow(/ECONNREFUSED|connect/);
    expect(existsSync(sqlitePath)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL;
// Uses only POSTGRES_TEST_DATABASE_URL and creates no tables.
describe.skipIf(!databaseUrl)(
  "PostgreSQL driver resilience (skipped unless POSTGRES_TEST_DATABASE_URL is explicitly supplied)",
  () => {
    const appName = `siteguard_driver_${randomUUID().replaceAll("-", "")}`;
    const withAppName = () => {
      const url = new URL(databaseUrl!);
      url.searchParams.set("application_name", appName);
      return url.toString();
    };
    const terminate = async () => {
      const admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      try {
        // appName is generated locally from UUID hex and passed as a parameter.
        const r = await admin.query(
          "SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE application_name=$1",
          [appName],
        );
        return r.rowCount ?? 0;
      } finally {
        await admin.end();
      }
    };
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("serializes concurrent queries inside a transaction on one connection", async () => {
      const original = pg.Client.prototype.query;
      let overlapping = 0;
      vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
        this: pg.Client,
        ...args: unknown[]
      ) {
        // Mirrors pg's deprecated implicit-queue condition (removed in pg@9).
        if ((this as unknown as { _queryQueue: unknown[] })._queryQueue.length)
          overlapping++;
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      } as typeof original);
      const d = await postgresDriver(withAppName());
      try {
        const rows = await d.transaction!((tx) =>
          Promise.all(
            [1, 2, 3, 4, 5].map((n) =>
              tx.query("SELECT $1::int AS n, pg_sleep(0.02)", [n]),
            ),
          ),
        );
        expect(rows.map((r) => r[0].n)).toEqual([1, 2, 3, 4, 5]);
        expect(overlapping).toBe(0);
      } finally {
        await d.close();
      }
    });

    it("survives the server closing an idle pooled connection", async () => {
      const errors: Error[] = [];
      const d = await postgresDriver(withAppName(), (e) => errors.push(e));
      try {
        expect(await terminate()).toBeGreaterThan(0);
        await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
        expect(await d.query("SELECT 1 AS ok")).toEqual([{ ok: 1 }]);
      } finally {
        await d.close();
      }
    });

    it("rejects a transaction whose connection is terminated and keeps the pool usable", async () => {
      const errors: Error[] = [];
      const d = await postgresDriver(withAppName(), (e) => errors.push(e));
      try {
        await expect(
          d.transaction!(async (tx) => {
            await tx.query("SELECT 1");
            await terminate();
            await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
            return tx.query("SELECT 2");
          }),
        ).rejects.toThrow();
        expect(await d.query("SELECT 3 AS ok")).toEqual([{ ok: 3 }]);
      } finally {
        await d.close();
      }
    });

    it("refuses nested transactions explicitly and rolls back", async () => {
      const d = await postgresDriver(withAppName());
      try {
        await expect(
          d.transaction!((tx) => tx.transaction!(async () => 1)),
        ).rejects.toThrow("Nested PostgreSQL transactions are not supported");
        // The connection was rolled back and returned in a usable state.
        expect(
          await d.transaction!(async (tx) => tx.query("SELECT 1 AS ok")),
        ).toEqual([{ ok: 1 }]);
      } finally {
        await d.close();
      }
    });
  },
);
