// Authorization matrix: every /api route × {anonymous, worker A, worker B,
// supervisor}. A route added without a matrix row fails the coverage test.
// Expected statuses come from docs/API_CONTRACT.md: worker-owned records,
// supervisor access to physiology only with sharing consent, worker-only
// personal insights, supervisor-only scheduling and integrations.
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import cookiePlugin from "@fastify/cookie";
import { fixtureId } from "@siteguard/mock-data";
import type { Session } from "@siteguard/contracts";
import { registerRoutes } from "../src/routes.js";
import { loadConfig } from "../src/config.js";
import { openRepository } from "../src/db/repository.js";
import { MeasurementManager } from "../src/measurement/manager.js";
import { testApp, login, populatedSession } from "./helpers.js";

type Role = "anonymous" | "workerA" | "workerB" | "supervisor";
// Unauthorized roles first so an authorized mutation cannot mask a denial.
const ROLES: Role[] = ["anonymous", "workerB", "supervisor", "workerA"];
const A = fixtureId(1),
  B = fixtureId(2);
const UNSHARED = fixtureId(1001); // seeded completed session of worker A
const SHARED = fixtureId(8001);
const ACTIVE = fixtureId(9000); // populatedSession(): active, worker A
const REQUEST = fixtureId(8101);
const PROTECTED_A = fixtureId(101);

type Ctx = Awaited<ReturnType<typeof testApp>>;
interface Case {
  route: string; // "METHOD /api/path/:param" exactly as registered
  name: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
  active?: boolean;
  expected: Record<Role, number>;
}
const all = (s: number) => ({
  anonymous: s,
  workerA: s,
  workerB: s,
  supervisor: s,
});
const signedIn = (s: number) => ({ ...all(s), anonymous: 401 });
const ownerOnly = (s: number) => ({
  anonymous: 401,
  workerA: s,
  workerB: 403,
  supervisor: 403,
});
const ownerOrSharing = (s: number) => ({ ...ownerOnly(s), supervisor: s });
const supervisorOnly = (s: number) => ({
  anonymous: 401,
  workerA: 403,
  workerB: 403,
  supervisor: s,
});
const sessionBody = {
  breakId: PROTECTED_A,
  source: "mock",
  consentVersion: "v1",
  shareWithSupervisor: false,
  context: { workload: null, temperatureC: null },
};
const cases: Case[] = [
  {
    route: "GET /api/health",
    name: "health",
    url: "/api/health",
    expected: all(200),
  },
  {
    route: "GET /api/integrations",
    name: "integrations",
    url: "/api/integrations",
    expected: supervisorOnly(200),
  },
  {
    route: "GET /api/workers",
    name: "public demo roster",
    url: "/api/workers",
    expected: all(200),
  },
  {
    route: "POST /api/demo/login",
    name: "demo login",
    url: "/api/demo/login",
    payload: { role: "supervisor" },
    expected: all(200),
  },
  {
    route: "GET /api/demo/me",
    name: "me",
    url: "/api/demo/me",
    expected: signedIn(200),
  },
  {
    route: "GET /api/breaks",
    name: "breaks",
    url: "/api/breaks",
    expected: signedIn(200),
  },
  {
    route: "POST /api/sessions",
    name: "start session on A's break",
    url: "/api/sessions",
    payload: sessionBody,
    expected: ownerOnly(201),
  },
  {
    route: "GET /api/sessions/:id",
    name: "unshared session",
    url: `/api/sessions/${UNSHARED}`,
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/sessions/:id",
    name: "shared session",
    url: `/api/sessions/${SHARED}`,
    expected: ownerOrSharing(200),
  },
  {
    route: "GET /api/sessions/:id/readings",
    name: "unshared readings",
    url: `/api/sessions/${UNSHARED}/readings`,
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/sessions/:id/readings",
    name: "shared readings",
    url: `/api/sessions/${SHARED}/readings`,
    expected: ownerOrSharing(200),
  },
  {
    route: "POST /api/sessions/:id/frame",
    name: "camera frame requires owned active Presage session",
    url: `/api/sessions/${ACTIVE}/frame`,
    active: true,
    expected: ownerOnly(409),
  },
  {
    route: "POST /api/sessions/:id/readings",
    name: "ingest with cookies only",
    url: `/api/sessions/${ACTIVE}/readings`,
    payload: { readings: [] },
    active: true,
    expected: all(401),
  },
  {
    route: "POST /api/sessions/:id/complete",
    name: "complete",
    url: `/api/sessions/${ACTIVE}/complete`,
    payload: {},
    active: true,
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/sessions/:id/summary",
    name: "unshared summary",
    url: `/api/sessions/${UNSHARED}/summary`,
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/sessions/:id/summary",
    name: "shared summary",
    url: `/api/sessions/${SHARED}/summary`,
    expected: ownerOrSharing(200),
  },
  {
    route: "GET /api/sessions/:id/personal-insights",
    name: "insights unshared",
    url: `/api/sessions/${UNSHARED}/personal-insights`,
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/sessions/:id/personal-insights",
    name: "insights shared (still private)",
    url: `/api/sessions/${SHARED}/personal-insights`,
    expected: ownerOnly(200),
  },
  {
    route: "POST /api/sessions/:id/self-report",
    name: "self-report",
    url: `/api/sessions/${UNSHARED}/self-report`,
    payload: { tiredness: 3 },
    expected: ownerOnly(200),
  },
  {
    route: "POST /api/sessions/:id/self-report",
    name: "self-report on shared",
    url: `/api/sessions/${SHARED}/self-report`,
    payload: { tiredness: null },
    expected: ownerOnly(200),
  },
  {
    // Use the unshared session so later "shared" rows keep their sharing.
    route: "PATCH /api/sessions/:id/sharing",
    name: "withdraw sharing",
    url: `/api/sessions/${UNSHARED}/sharing`,
    payload: { shareWithSupervisor: false },
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/workers/:id/supervisor-view",
    name: "what supervisors can see",
    url: `/api/workers/${A}/supervisor-view`,
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/workers/:id/personal-trend",
    name: "personal trend",
    url: `/api/workers/${A}/personal-trend?source=mock`,
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/sessions/:id/events",
    name: "unshared stream",
    url: `/api/sessions/${UNSHARED}/events`,
    expected: ownerOnly(200),
  },
  {
    route: "GET /api/sessions/:id/events",
    name: "shared stream",
    url: `/api/sessions/${SHARED}/events`,
    expected: ownerOrSharing(200),
  },
  {
    route: "GET /api/workers/:id/history",
    name: "history",
    url: `/api/workers/${A}/history`,
    expected: ownerOnly(200),
  },
  {
    route: "POST /api/rest-requests",
    name: "rest request linked to A's session",
    url: "/api/rest-requests",
    payload: {
      sessionId: UNSHARED,
      kind: "additional_rest",
      requestedMinutes: 5,
    },
    expected: ownerOnly(201),
  },
  {
    route: "POST /api/symptom-reports",
    name: "symptom linked to A's session",
    url: "/api/symptom-reports",
    payload: {
      sessionId: UNSHARED,
      codes: ["dizzy"],
      note: "<script>x</script>",
    },
    expected: ownerOnly(201),
  },
  {
    route: "GET /api/rest-requests",
    name: "list requests",
    url: "/api/rest-requests",
    expected: signedIn(200),
  },
  {
    route: "PATCH /api/rest-requests/:id",
    name: "act on request",
    url: `/api/rest-requests/${REQUEST}`,
    payload: { action: "acknowledge", revision: 0, note: "Seen" },
    expected: supervisorOnly(200),
  },
  {
    route: "PATCH /api/breaks/:id",
    name: "move protected break",
    url: `/api/breaks/${PROTECTED_A}`,
    payload: {
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
      revision: 0,
    },
    expected: supervisorOnly(409),
  },
  {
    route: "GET /api/supervisor/overview",
    name: "overview",
    url: "/api/supervisor/overview",
    expected: supervisorOnly(200),
  },
  {
    route: "POST /api/schedule/preview",
    name: "preview",
    url: "/api/schedule/preview",
    payload: {},
    expected: supervisorOnly(200),
  },
  {
    route: "POST /api/schedule/commit",
    name: "commit",
    url: "/api/schedule/commit",
    payload: { baseRevision: 0, assignments: [] },
    expected: supervisorOnly(200),
  },
  {
    route: "POST /api/insights/explain",
    name: "explain unshared session",
    url: "/api/insights/explain",
    payload: { kind: "session", sessionId: UNSHARED },
    expected: ownerOnly(200),
  },
  {
    route: "POST /api/insights/explain",
    name: "explain shared session",
    url: "/api/insights/explain",
    payload: { kind: "session", sessionId: SHARED },
    expected: ownerOrSharing(200),
  },
  {
    route: "POST /api/insights/explain",
    name: "explain schedule",
    url: "/api/insights/explain",
    payload: { kind: "schedule", auditEventId: fixtureId(8999) },
    expected: supervisorOnly(404),
  },
  {
    route: "POST /api/demo/reset",
    name: "reset",
    url: "/api/demo/reset",
    payload: {},
    expected: supervisorOnly(200),
  },
];

async function prepare(ctx: Ctx, c: Case) {
  const base = (await ctx.repo.get("sessions", UNSHARED))!;
  const shared: Session = { ...base, id: SHARED, shareWithSupervisor: true };
  await ctx.repo.put("sessions", shared);
  await ctx.repo.put("rest_requests", {
    id: REQUEST,
    workerId: A,
    sessionId: null,
    kind: "additional_rest",
    requestedMinutes: 5,
    status: "pending",
    createdAt: new Date().toISOString(),
    restStartsAt: null,
    restEndsAt: null,
    revision: 0,
    note: null,
  });
  if (c.active) await populatedSession(ctx.repo);
  return {
    anonymous: undefined,
    workerA: await login(ctx.app, "worker", A),
    workerB: await login(ctx.app, "worker", B),
    supervisor: await login(ctx.app, "supervisor"),
  } satisfies Record<Role, string | undefined>;
}

async function statusFor(
  ctx: Ctx,
  c: Case,
  cookie: string | undefined,
  base: string | undefined,
) {
  const method = c.route.split(" ")[0];
  const headers = { ...(cookie ? { cookie } : {}), ...c.headers };
  if (c.route.endsWith("/events")) {
    // SSE stays open on success: read only the status, then disconnect.
    const controller = new AbortController();
    const response = await fetch(base + c.url, {
      headers,
      signal: controller.signal,
    });
    controller.abort();
    return response.status;
  }
  const response = await ctx.app.inject({
    method: method as "GET",
    url: c.url,
    headers,
    ...(c.payload === undefined ? {} : { payload: c.payload as object }),
  });
  return response.statusCode;
}

describe("authorization matrix", () => {
  it.each(cases)("$route — $name", async (c) => {
    const ctx = await testApp();
    try {
      const cookies = await prepare(ctx, c);
      const base = c.route.endsWith("/events")
        ? await ctx.app.listen({ host: "127.0.0.1", port: 0 })
        : undefined;
      const actual: Partial<Record<Role, number>> = {};
      for (const role of ROLES)
        actual[role] = await statusFor(ctx, c, cookies[role], base);
      expect(actual).toEqual(c.expected);
    } finally {
      await ctx.app.close();
    }
  });

  it("workers only ever see their own breaks and requests; supervisors see all", async () => {
    const ctx = await testApp();
    try {
      const cookies = await prepare(ctx, cases[0]);
      for (const [role, own] of [
        ["workerA", A],
        ["workerB", B],
      ] as const) {
        const breaks = (
          await ctx.app.inject({
            url: "/api/breaks",
            headers: { cookie: cookies[role] },
          })
        ).json().breaks as { workerId: string }[];
        expect(breaks.length).toBeGreaterThan(0);
        expect(breaks.every((b) => b.workerId === own)).toBe(true);
        const requests = (
          await ctx.app.inject({
            url: "/api/rest-requests",
            headers: { cookie: cookies[role] },
          })
        ).json().requests as { workerId: string }[];
        expect(requests.every((r) => r.workerId === own)).toBe(true);
      }
      const all = (
        await ctx.app.inject({
          url: "/api/rest-requests",
          headers: { cookie: cookies.supervisor },
        })
      ).json().requests as { id: string }[];
      expect(all.map((r) => r.id)).toContain(REQUEST);
      // Overview exposes no physiology, personal insights or self-reports.
      const overview = (
        await ctx.app.inject({
          url: "/api/supervisor/overview",
          headers: { cookie: cookies.supervisor },
        })
      ).body;
      for (const field of ["heartRateBpm", "tiredness", "baseline", "readings"])
        expect(overview).not.toContain(field);
    } finally {
      await ctx.app.close();
    }
  });

  it("the internal ingest credential is required and sufficient for ingest only", async () => {
    const ctx = await testApp();
    try {
      await populatedSession(ctx.repo);
      const auth = { authorization: "Bearer internal-test-token" };
      expect(
        (
          await ctx.app.inject({
            method: "POST",
            url: `/api/sessions/${ACTIVE}/readings`,
            headers: { authorization: "Bearer internal-test-tokeX" },
            payload: { readings: [] },
          })
        ).statusCode,
      ).toBe(401);
      // Bearer token grants no browser-identity access.
      for (const url of [
        `/api/sessions/${ACTIVE}`,
        "/api/supervisor/overview",
        `/api/workers/${A}/history`,
      ])
        expect((await ctx.app.inject({ url, headers: auth })).statusCode).toBe(
          401,
        );
    } finally {
      await ctx.app.close();
    }
  });

  it("every registered /api route has a matrix row", async () => {
    const config = loadConfig({
      sqlitePath: ":memory:",
      databaseUrl: undefined,
      cookieSecret: "test-secret-at-least-thirty-two-characters",
      measurementToken: "internal-test-token",
      bridgeToken: undefined,
      webDist: "/nonexistent/siteguard-web",
    });
    const app = Fastify();
    await app.register(cookiePlugin, { secret: config.cookieSecret });
    const registered = new Set<string>();
    app.addHook("onRoute", (route) => {
      for (const method of [route.method].flat())
        if (method !== "HEAD") registered.add(`${method} ${route.url}`);
    });
    const repo = await openRepository(config);
    const manager = new MeasurementManager(repo, config);
    try {
      await registerRoutes(app, repo, config, manager);
      await app.ready();
      const covered = new Set(cases.map((c) => c.route));
      expect([...registered].filter((r) => !covered.has(r))).toEqual([]);
      expect([...covered].filter((r) => !registered.has(r))).toEqual([]);
    } finally {
      await app.close();
      await manager.close();
      await repo.close();
    }
  });
});
