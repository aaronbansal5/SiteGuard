// Regression tests for findings in docs/SECURITY_REVIEW.md. Each test failed
// before its fix.
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fixtureId } from "@siteguard/mock-data";
import { CommitSchema } from "@siteguard/contracts";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { rateLimitKey } from "../src/client-ip.js";
import { testApp, login } from "./helpers.js";

const running: { app: { close(): Promise<unknown> } }[] = [];
afterEach(async () => {
  for (const x of running.splice(0)) await x.app.close();
});
async function setup() {
  const x = await testApp();
  running.push(x);
  return x;
}

describe("SR-0 cross-origin writes are rejected without running the handler", () => {
  it.each([
    "https://evil.example",
    "null",
    "http://localhost.evil.example",
    "https://localhost",
  ])("Origin %s: 403, no side effect", async (origin) => {
    const { app, repo } = await setup();
    const wc = await login(app);
    const before = await repo.list("rest_requests");
    const write = await app.inject({
      method: "POST",
      url: "/api/rest-requests",
      headers: { cookie: wc, origin, host: "localhost" },
      payload: { sessionId: null, kind: "assistance", requestedMinutes: null },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe("ORIGIN_REJECTED");
    expect(await repo.list("rest_requests")).toEqual(before);
    const loginAttempt = await app.inject({
      method: "POST",
      url: "/api/demo/login",
      headers: { origin, host: "localhost" },
      payload: { role: "supervisor" },
    });
    expect(loginAttempt.statusCode).toBe(403);
    expect(loginAttempt.headers["set-cookie"]).toBeUndefined();
  });
  it("same-origin writes still succeed", async () => {
    const { app } = await setup();
    const wc = await login(app);
    const write = await app.inject({
      method: "POST",
      url: "/api/rest-requests",
      headers: { cookie: wc, origin: "http://localhost", host: "localhost" },
      payload: { sessionId: null, kind: "assistance", requestedMinutes: null },
    });
    expect(write.statusCode).toBe(201);
  });
});

describe("SR-1 client request errors are 4xx, not dependency outages", () => {
  const cases = [
    {
      name: "malformed JSON",
      headers: { "content-type": "application/json" },
      payload: "{bad",
      status: 400,
      code: "VALIDATION",
    },
    {
      name: "empty JSON body",
      headers: { "content-type": "application/json" },
      payload: "",
      status: 400,
      code: "VALIDATION",
    },
    {
      name: "prototype poisoning",
      headers: { "content-type": "application/json" },
      payload:
        '{"__proto__":{"x":1},"sessionId":null,"kind":"assistance","requestedMinutes":null}',
      status: 400,
      code: "VALIDATION",
    },
    {
      name: "unsupported media type",
      headers: { "content-type": "application/xml" },
      payload: "<a/>",
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    },
    {
      name: "oversized body",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ x: "a".repeat(1024 * 1024 + 1) }),
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    },
  ];
  it.each(cases)("$name → $status $code", async (c) => {
    const { app } = await setup();
    const cookie = await login(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/rest-requests",
      headers: { cookie, ...c.headers },
      payload: c.payload,
    });
    expect(response.statusCode).toBe(c.status);
    const body = response.json();
    expect(body.error.code).toBe(c.code);
    expect(typeof body.error.requestId).toBe("string");
    // Generic message; no parser internals or stack details.
    expect(JSON.stringify(body)).not.toMatch(/FST_|stack|SyntaxError/);
  });
});

describe("SR-2 schedule commit size is bounded", () => {
  it("rejects more than 500 assignments before any planning work", async () => {
    const { app, repo } = await setup();
    const sc = await login(app, "supervisor");
    const s = await repo.schedule();
    const task = s.tasks[0];
    const workerId = fixtureId(6);
    const assignments = Array.from({ length: 501 }, (_, i) => {
      const start = Date.now() + 1000 + i * 1000;
      return {
        id: randomUUID(),
        taskId: task.id,
        workerId,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 1000).toISOString(),
      };
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/schedule/commit",
      headers: { cookie: sc },
      payload: { baseRevision: s.scheduleRevision, assignments },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION");
    expect(await repo.list("task_assignments")).toEqual(s.assignments);
    expect(
      CommitSchema.safeParse({
        baseRevision: 0,
        assignments: assignments.slice(0, 500),
      }).success,
    ).toBe(true);
  });
  it("the planner's own proposal for the demo roster stays far below the bound", async () => {
    const { app } = await setup();
    const sc = await login(app, "supervisor");
    const preview = await app.inject({
      method: "POST",
      url: "/api/schedule/preview",
      headers: { cookie: sc },
      payload: {},
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().assignments.length).toBeLessThan(100);
  });
});

describe("SR-3 moving approved rest cannot overlap a protected break", () => {
  it("returns 409 and leaves both breaks unchanged", async () => {
    const { app, repo } = await setup();
    const workerId = fixtureId(2);
    const wc = await login(app, "worker", workerId),
      sc = await login(app, "supervisor");
    const prot = (await repo.list("breaks")).find(
      (b) => b.workerId === workerId && b.kind === "protected",
    )!;
    const request = (
      await app.inject({
        method: "POST",
        url: "/api/rest-requests",
        headers: { cookie: wc },
        payload: {
          sessionId: null,
          kind: "additional_rest",
          requestedMinutes: 5,
        },
      })
    ).json().request;
    const start = new Date(Date.parse(prot.endsAt) + 60000).toISOString(),
      end = new Date(Date.parse(start) + 300000).toISOString();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/rest-requests/${request.id}`,
          headers: { cookie: sc },
          payload: {
            action: "approve",
            revision: 0,
            restStartsAt: start,
            restEndsAt: end,
            note: "Approved",
          },
        })
      ).statusCode,
    ).toBe(200);
    const additional = (await repo.list("breaks")).find(
      (b) => b.kind === "additional",
    )!;
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/breaks/${additional.id}`,
      headers: { cookie: sc },
      payload: {
        startsAt: new Date(Date.parse(prot.startsAt) + 60000).toISOString(),
        endsAt: new Date(Date.parse(prot.startsAt) + 360000).toISOString(),
        revision: 0,
      },
    });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().error.code).toBe("REST_OVERLAPS_PROTECTED");
    expect(await repo.get("breaks", additional.id)).toEqual(additional);
    expect(await repo.get("breaks", prot.id)).toEqual(prot);
  });
});

describe("SR-4 rate-limit identity behind a reverse proxy and over IPv6", () => {
  async function app(clientIpHeader?: string) {
    const x = await createApp({
      sqlitePath: ":memory:",
      databaseUrl: undefined,
      cookieSecret: "test-secret-at-least-thirty-two-characters",
      measurementToken: "internal-test-token",
      bridgeToken: undefined,
      webDist: "/nonexistent/siteguard-web",
      clientIpHeader,
    });
    running.push(x);
    return x.app;
  }
  const loginFrom = (
    a: Awaited<ReturnType<typeof app>>,
    remoteAddress: string,
    headers: Record<string, string> = {},
  ) =>
    a.inject({
      method: "POST",
      url: "/api/demo/login",
      remoteAddress,
      headers,
      payload: { role: "supervisor" },
    });
  it("with CLIENT_IP_HEADER, distinct clients behind one proxy get separate quotas", async () => {
    const a = await app("fly-client-ip");
    const proxy = "172.16.0.2";
    for (let i = 0; i < 30; i++)
      expect(
        (await loginFrom(a, proxy, { "fly-client-ip": "203.0.113.1" }))
          .statusCode,
      ).toBe(200);
    expect(
      (await loginFrom(a, proxy, { "fly-client-ip": "203.0.113.1" }))
        .statusCode,
    ).toBe(429);
    expect(
      (await loginFrom(a, proxy, { "fly-client-ip": "203.0.113.2" }))
        .statusCode,
    ).toBe(200);
  });
  it("without CLIENT_IP_HEADER ignores forwarding headers (no spoofed quota keys)", async () => {
    const a = await app();
    for (let i = 0; i < 30; i++)
      expect(
        (
          await loginFrom(a, "10.0.0.1", {
            "fly-client-ip": `203.0.113.${i}`,
            "x-forwarded-for": `198.51.100.${i}`,
          })
        ).statusCode,
      ).toBe(200);
    expect((await loginFrom(a, "10.0.0.1")).statusCode).toBe(429);
  });
  it("one IPv6 /64 shares a single quota", async () => {
    const a = await app();
    for (let i = 0; i < 30; i++)
      expect(
        (await loginFrom(a, `2001:db8:1:2::${(i + 1).toString(16)}`))
          .statusCode,
      ).toBe(200);
    expect((await loginFrom(a, "2001:db8:1:2:ffff::1")).statusCode).toBe(429);
    expect((await loginFrom(a, "2001:db8:1:3::1")).statusCode).toBe(200);
  });
  it("normalizes addresses into stable keys", () => {
    expect(rateLimitKey("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(rateLimitKey("192.0.2.7")).toBe("192.0.2.7");
    expect(rateLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitKey("2001:0db8:0000:0000:1:2:3:4")).toBe(
      "2001:db8:0:0::/64",
    );
    expect(rateLimitKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitKey("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
  });
  it("validates CLIENT_IP_HEADER", () => {
    for (const bad of ["cookie", "bad header", "x".repeat(65)])
      expect(() => loadConfig({ clientIpHeader: bad })).toThrow(
        "CLIENT_IP_HEADER",
      );
    expect(loadConfig({}).clientIpHeader).toBeUndefined();
  });
});

describe("SR-5 verify:tiger never prints DATABASE_URL credentials", () => {
  it("reports a malformed URL without echoing it", () => {
    const secret = "s3cret-pw-must-not-print";
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "apps/api/src/db/verify.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: `postgres://user:${secret}@bad host:5432/db`,
        },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout + result.stderr).toContain("DATABASE_URL");
  });
});

describe("SR-6 Docker build context excludes nested secrets", () => {
  it("root .dockerignore excludes .env files and local data at any depth", () => {
    const patterns = readFileSync(resolve(".dockerignore"), "utf8")
      .split("\n")
      .map((l) => l.trim());
    for (const p of ["**/.env", "**/.env.*", "**/.data", "**/*.sqlite*"])
      expect(patterns).toContain(p);
  });
});

describe("hardening checks (already correct; kept as regression guards)", () => {
  it("concurrent schedule commits on one base revision: exactly one wins", async () => {
    const { app, repo } = await setup();
    const sc = await login(app, "supervisor");
    const preview = (
      await app.inject({
        method: "POST",
        url: "/api/schedule/preview",
        headers: { cookie: sc },
        payload: {},
      })
    ).json();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: "POST",
          url: "/api/schedule/commit",
          headers: { cookie: sc },
          payload: {
            baseRevision: preview.baseRevision,
            assignments: preview.assignments,
          },
        }),
      ),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, ...Array(7).fill(409)]);
    expect(await repo.revision()).toBe(preview.baseRevision + 1);
    const audits = (await repo.list("audit_events")).filter(
      (a) => a.action === "schedule_commit",
    );
    expect(audits).toHaveLength(1);
  });
  it("concurrent check-in starts for one worker create one active session", async () => {
    const { app, repo } = await setup();
    const wc = await login(app);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        app.inject({
          method: "POST",
          url: "/api/sessions",
          headers: { cookie: wc },
          payload: {
            breakId: fixtureId(101),
            source: "mock",
            consentVersion: "v1",
            shareWithSupervisor: false,
            context: { workload: null, temperatureC: null },
          },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([
      201,
      ...Array(5).fill(409),
    ]);
    expect(
      (await repo.list("sessions")).filter((s) => s.status === "active"),
    ).toHaveLength(1);
  });
  it("concurrent supervisor actions on one request revision: exactly one applies", async () => {
    const { app } = await setup();
    const wc = await login(app),
      sc = await login(app, "supervisor");
    const request = (
      await app.inject({
        method: "POST",
        url: "/api/rest-requests",
        headers: { cookie: wc },
        payload: {
          sessionId: null,
          kind: "assistance",
          requestedMinutes: null,
        },
      })
    ).json().request;
    const results = await Promise.all(
      ["acknowledge", "resolve", "acknowledge", "resolve"].map((action) =>
        app.inject({
          method: "PATCH",
          url: `/api/rest-requests/${request.id}`,
          headers: { cookie: sc },
          payload: { action, revision: 0, note: "Handled" },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([
      200, 409, 409, 409,
    ]);
  });
  it.each([
    "'; DROP TABLE rest_requests; --",
    "\u0000nul\u0000",
    "\ud800 lone surrogate",
    "<img src=x onerror=alert(1)>",
    "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 ‮RTL override",
    '{"__proto__":{"polluted":true}}',
  ])("stores hostile note text verbatim without errors: %j", async (note) => {
    const { app, repo } = await setup();
    const wc = await login(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/symptom-reports",
      headers: { cookie: wc },
      payload: { sessionId: null, codes: ["other"], note },
    });
    expect(created.statusCode).toBe(201);
    const stored = await repo.get("symptom_reports", created.json().report.id);
    // JSON escapes keep even a lone surrogate intact end to end.
    expect(stored?.note).toBe(note);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(await repo.list("rest_requests")).not.toHaveLength(0);
  });
  it.each([
    ["non-UUID id", "/api/sessions/not-a-uuid"],
    ["traversal id", "/api/sessions/..%2F..%2Fdemo%2Freset"],
    ["SQL in id", "/api/sessions/1'%20OR%20'1'='1"],
    [
      "oversized cursor",
      `/api/workers/${fixtureId(1)}/history?before=${"A".repeat(5000)}`,
    ],
  ])("rejects %s with 400 and no internals", async (_name, url) => {
    const { app } = await setup();
    const wc = await login(app);
    const response = await app.inject({ url, headers: { cookie: wc } });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(/SELECT|sqlite|stack/i);
  });
  it("demo login cookie is HttpOnly, SameSite=Strict and signed", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/demo/login",
      payload: { role: "supervisor" },
    });
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const value = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
    // Tampering the identity breaks the signature.
    const tampered = value.replace("supervisor", "worker");
    expect(
      (
        await app.inject({
          url: "/api/demo/me",
          headers: { cookie: `siteguard=${encodeURIComponent(tampered)}` },
        })
      ).statusCode,
    ).toBe(401);
  });
});
