import { test, expect, beforeEach, afterEach } from "vitest";
import { fixtureId } from "@siteguard/mock-data";
import { createAccountSession } from "../src/auth-service.js";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
type Harness = Awaited<ReturnType<typeof createApp>>;
const boot = (overrides: Partial<Config>) =>
  createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    demoMode: true,
    hosted: false,
    cookieSecret: "qa-auth-secret-at-least-thirty-two-characters",
    measurementToken: "qa-internal-token",
    bridgeToken: undefined,
    geminiKey: undefined,
    webDist: "/nonexistent",
    ...overrides,
  });
const close = (h: Harness) => h.app.close();
const client = (h: Harness, cookie: string) => {
  const call = async (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await h.app.inject({
      method,
      url,
      headers: { cookie, ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: response.statusCode, body: response.json() };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (url: string, payload: unknown, headers?: Record<string, string>) =>
      call("POST", url, payload, headers),
  };
};

let h: Harness;
beforeEach(async () => {
  h = await boot({
    authMode: "oidc",
    siteId: "site-a",
    appOrigin: "https://siteguard.example",
    oidcIssuer: "https://identity.example",
    oidcClientId: "test-client",
  });
});
afterEach(async () => close(h));

async function account(
  role: "worker" | "supervisor",
  workerId: string | null = null,
  siteId = "site-a",
) {
  const id = crypto.randomUUID();
  await h.repo.driver.query(
    "INSERT INTO auth_accounts (id,issuer,subject,email,site_id,role,worker_id,disabled,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id,
      "https://identity.example",
      id,
      `${id}@example.com`,
      siteId,
      role,
      workerId,
      0,
      new Date().toISOString(),
    ],
  );
  const secret = await createAccountSession(h.repo, id);
  const api = client(h, `siteguard_session=${secret}`);
  return {
    id,
    secret,
    api: {
      ...api,
      post: (url: string, payload: unknown = {}) =>
        api.post(url, payload, { origin: "https://siteguard.example" }),
    },
  };
}

test("OIDC mode rejects demo self-escalation, role injection and worker manager actions", async () => {
  const w = await account("worker", fixtureId(1));
  expect(
    (await w.api.post("/api/demo/login", { role: "supervisor" })).status,
  ).toBe(403);
  expect((await w.api.get("/api/supervisor/overview")).status).toBe(403);
  expect((await w.api.post("/api/schedule/preview", {})).status).toBe(403);
  expect(
    (
      await w.api.post("/api/auth/invitations", {
        email: "other@example.com",
        workerId: fixtureId(2),
      })
    ).status,
  ).toBe(403);
  const me = await w.api.get("/api/auth/me");
  expect(me.status).toBe(200);
  expect(me.body.identity).toEqual({ role: "worker", workerId: fixtureId(1) });
  expect((await w.api.get(`/api/workers/${fixtureId(2)}/history`)).status).toBe(
    403,
  );
});

test("opaque sessions enforce expiry, disabled accounts, configured site and revocation", async () => {
  const w = await account("worker", fixtureId(1));
  expect((await w.api.get("/api/breaks")).status).toBe(200);
  await w.api.post("/api/auth/logout", {});
  expect((await w.api.get("/api/breaks")).status).toBe(401);
  const expired = await account("worker", fixtureId(2));
  await h.repo.driver.query(
    "UPDATE auth_sessions SET expires_at=$1 WHERE account_id=$2",
    [new Date(Date.now() - 1000).toISOString(), expired.id],
  );
  expect((await expired.api.get("/api/breaks")).status).toBe(401);
  const disabled = await account("worker", fixtureId(3));
  await h.repo.driver.query("UPDATE auth_accounts SET disabled=1 WHERE id=$1", [
    disabled.id,
  ]);
  expect((await disabled.api.get("/api/breaks")).status).toBe(401);
  const foreign = await account("supervisor", null, "site-b");
  expect((await foreign.api.get("/api/supervisor/overview")).status).toBe(401);
});

test("worker assistance requires no measurement and managers cannot expand invitation permissions", async () => {
  const w = await account("worker", fixtureId(1));
  const manager = await account("supervisor");
  const count = (await h.repo.list("sessions")).length;
  const report = await w.api.post("/api/symptom-reports", {
    sessionId: null,
    codes: ["dizzy"],
    note: null,
  });
  expect(report.status).toBe(201);
  expect((await h.repo.list("sessions")).length).toBe(count);
  const overview = await manager.api.get("/api/supervisor/overview");
  expect(overview.status).toBe(200);
  expect(
    overview.body.requests.some(
      (r: { id: string }) => r.id === report.body.request.id,
    ),
  ).toBe(true);
  expect(
    (
      await manager.api.post("/api/auth/invitations", {
        email: "new@example.com",
        workerId: fixtureId(2),
        role: "supervisor",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await manager.api.post("/api/auth/invitations", {
        email: "new@example.com",
        workerId: fixtureId(2),
        siteId: "site-b",
      })
    ).status,
  ).toBe(400);
  const privateSession = (await h.repo.list("sessions")).find(
    (s) => !s.shareWithSupervisor,
  )!;
  expect(
    (await manager.api.get(`/api/sessions/${privateSession.id}/summary`))
      .status,
  ).toBe(403);
});
