import { randomUUID } from "node:crypto";
import pg from "pg";
import { it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { login, populatedSession } from "./helpers.js";
import { fixtureId, mockReading } from "@siteguard/mock-data";

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL;
it.skipIf(!databaseUrl)(
  "PostgreSQL seed, ingestion, and transactional request/scheduling behavior (skipped unless POSTGRES_TEST_DATABASE_URL is explicitly supplied)",
  async () => {
    // Never fall back to application DATABASE_URL or write to its default schema.
    const schema = `siteguard_test_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(databaseUrl!);
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw new Error("POSTGRES_TEST_DATABASE_URL must be a PostgreSQL URL");
    const admin = new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
    });
    url.searchParams.set("options", `-c search_path=${schema}`);
    let created = false;
    let application: Awaited<ReturnType<typeof createApp>> | undefined;
    await admin.connect();
    try {
      // schema is generated locally from UUID hex, never user-provided SQL.
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      application = await createApp({
        databaseUrl: url.toString(),
        hosted: false,
        demoMode: true,
        cookieSecret: "postgres-test-cookie-at-least-thirty-two-characters",
        measurementToken: "postgres-test-internal-token",
        webDist: "/nonexistent/postgres-test-web",
        geminiKey: undefined,
        geminiModel: undefined,
        bridgeToken: undefined,
      });
      const { repo, app } = application;
      expect(repo.driver.kind).toBe("postgres");
      expect(
        await repo.driver.query("SELECT current_schema() AS schema"),
      ).toEqual([{ schema }]);
      expect(await repo.list("workers")).toHaveLength(6);
      expect(await repo.list("sessions")).toHaveLength(72);
      expect(
        await repo.driver.query(
          "SELECT version FROM schema_migrations ORDER BY version",
        ),
      ).toEqual([
        { version: "001_initial" },
        { version: "003_auth" },
        { version: "003_self_reports" },
        { version: "004_device_pairings" },
        { version: "004_safety" },
        { version: "005_mobile" },
      ]);

      const s = await populatedSession(repo);
      expect(await repo.ingest(s.id, [mockReading(s.startedAt, 0)])).toEqual({
        accepted: 0,
        duplicates: 1,
      });
      const conflict = mockReading(s.startedAt, 0);
      conflict.reading.heartRateBpm = 999;
      await expect(
        repo.ingest(s.id, [mockReading(s.startedAt, 60), conflict]),
      ).rejects.toThrow("different reading");
      expect(await repo.readings(s.id)).toHaveLength(60);
      expect((await repo.readings(s.id))[1].reading).toEqual(
        mockReading(s.startedAt, 1).reading,
      );
      const foreignKeys = await repo.driver.query(
        "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid IN ('rest_requests'::regclass, 'breaks'::regclass, 'symptom_reports'::regclass) AND contype='f'",
      );
      expect(foreignKeys[0].n).toBe(7);

      const workerCookie = await login(app);
      const supervisorCookie = await login(app, "supervisor");
      const write = (
        path: string,
        payload: Record<string, unknown>,
        method: "POST" | "PATCH" = "POST",
        cookie = supervisorCookie,
      ) =>
        app.inject({
          method,
          url: `/api/${path}`,
          headers: { cookie },
          payload,
        });
      // Worker-only personal insights and voluntary self-reports on PostgreSQL.
      const [ownCompleted] = await repo.sessionPage(
        fixtureId(1),
        1,
        undefined,
        {
          source: "mock",
          since: "1970-01-01T00:00:00.000Z",
          before: new Date(Date.now() + 1000).toISOString(),
        },
      );
      expect(await repo.selfReports(fixtureId(1))).not.toHaveLength(0);
      const personal = (
        path: string,
        cookie: string,
        payload?: Record<string, unknown>,
      ) =>
        app.inject({
          method: payload ? "POST" : "GET",
          url: `/api/${path}`,
          headers: { cookie },
          payload,
        });
      const insightsPath = `sessions/${ownCompleted.id}/personal-insights`;
      const reportPath = `sessions/${ownCompleted.id}/self-report`;
      const trendPath = `workers/${fixtureId(1)}/personal-trend?source=mock`;
      expect((await personal(insightsPath, workerCookie)).statusCode).toBe(200);
      expect((await personal(trendPath, workerCookie)).statusCode).toBe(200);
      const rated = await personal(reportPath, workerCookie, { tiredness: 4 });
      expect(rated.statusCode).toBe(200);
      expect(
        await repo.driver.query(
          "SELECT worker_id FROM self_reports WHERE session_id=$1",
          [ownCompleted.id],
        ),
      ).toEqual([{ worker_id: fixtureId(1) }]);
      expect(
        (await repo.selfReports(fixtureId(1))).find(
          (x) => x.sessionId === ownCompleted.id,
        )?.tiredness,
      ).toBe(4);
      for (const response of [
        await personal(insightsPath, supervisorCookie),
        await personal(trendPath, supervisorCookie),
        await personal(reportPath, supervisorCookie, { tiredness: 1 }),
      ])
        expect(response.statusCode).toBe(403);
      const cleared = await personal(reportPath, workerCookie, {
        tiredness: null,
      });
      expect(cleared.json()).toEqual({ selfReport: null });
      expect(
        await repo.driver.query(
          "SELECT 1 FROM self_reports WHERE session_id=$1",
          [ownCompleted.id],
        ),
      ).toHaveLength(0);

      const protectedBefore = (await repo.list("breaks")).filter(
        (b) => b.kind === "protected",
      );
      const rest = await write(
        "rest-requests",
        { sessionId: null, kind: "additional_rest", requestedMinutes: 5 },
        "POST",
        workerCookie,
      );
      expect(rest.statusCode).toBe(201);
      const request = rest.json().request;
      const revision = await repo.revision();
      const invalidApproval = await write(
        `rest-requests/${request.id}`,
        {
          action: "approve",
          revision: 0,
          note: "Invalid interval fixture",
          restStartsAt: new Date(Date.now() + 1000).toISOString(),
          restEndsAt: new Date(Date.now() + 2000).toISOString(),
        },
        "PATCH",
      );
      expect(invalidApproval.statusCode).toBe(400);
      expect(await repo.revision()).toBe(revision);
      expect((await repo.get("rest_requests", request.id))?.status).toBe(
        "pending",
      );
      expect(
        (await repo.list("breaks")).filter((b) => b.kind === "additional"),
      ).toHaveLength(0);

      // Start after the worker's own protected break: a fixed now+1s start
      // overlaps it during part of the day and is rejected with 409.
      const ownProtected = protectedBefore.find(
        (b) => b.workerId === request.workerId,
      )!;
      const restStartsAt = new Date(
        Math.max(Date.now() + 1000, Date.parse(ownProtected.endsAt)),
      ).toISOString();
      const approved = await write(
        `rest-requests/${request.id}`,
        {
          action: "approve",
          revision: 0,
          note: "Approved PostgreSQL fixture",
          restStartsAt,
          restEndsAt: new Date(Date.parse(restStartsAt) + 300000).toISOString(),
        },
        "PATCH",
      );
      expect(approved.statusCode).toBe(200);
      expect((await repo.get("rest_requests", request.id))?.status).toBe(
        "approved",
      );
      expect(
        (await repo.list("breaks")).filter((b) => b.requestId === request.id),
      ).toHaveLength(1);
      const preview = await write("schedule/preview", {});
      expect(preview.statusCode).toBe(200);
      const proposal = preview.json();
      const committed = await write("schedule/commit", {
        baseRevision: proposal.baseRevision,
        assignments: proposal.assignments,
      });
      expect(committed.statusCode).toBe(200);
      expect(
        (await repo.list("breaks")).filter((b) => b.kind === "protected"),
      ).toEqual(protectedBefore);
      expect(
        (await repo.get("audit_events", committed.json().auditEventId))?.action,
      ).toBe("schedule_commit");
      const beforeStale = await repo.list("task_assignments");
      const stale = await write("schedule/commit", {
        baseRevision: proposal.baseRevision,
        assignments: [],
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("STALE_REVISION");
      expect(await repo.list("task_assignments")).toEqual(beforeStale);
    } finally {
      try {
        await application?.app.close();
      } finally {
        try {
          if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await admin.end();
        }
      }
    }
  },
  30000,
);
