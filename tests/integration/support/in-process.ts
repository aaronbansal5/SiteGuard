// In-process API harness for fast integration tests. It boots the real Fastify
// application (routes, repository, measurement manager, explainer) on an
// isolated in-memory SQLite database and talks to it through Fastify inject.
// No browser, Vite server or network listener is used, so these specs are
// independent of the Playwright webServer ports.
import { expect } from "vitest";
import { createAccountSession } from "../../../apps/api/src/auth-service.js";
import { createApp } from "../../../apps/api/src/app.js";
import type { Config } from "../../../apps/api/src/config.js";
import { fixtureId, mockReading } from "@siteguard/mock-data";
import type { ReadingEnvelope } from "@siteguard/contracts";

export const INTERNAL_TOKEN = "integration-internal-token";
export type Harness = Awaited<ReturnType<typeof createApp>>;

export async function boot(overrides: Partial<Config> = {}): Promise<Harness> {
  return createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    cookieSecret: "integration-secret-at-least-thirty-two-characters",
    measurementToken: INTERNAL_TOKEN,
    demoMode: true,
    hosted: false,
    bridgeToken: undefined,
    geminiKey: undefined,
    geminiModel: undefined,
    webDist: "/nonexistent/siteguard-web",
    ...overrides,
  });
}

export async function loginAs(
  h: Harness,
  role: "worker" | "supervisor",
  workerId = fixtureId(1),
) {
  const res = await h.app.inject({
    method: "POST",
    url: "/api/demo/login",
    payload: role === "worker" ? { role, workerId } : { role },
  });
  expect(res.statusCode).toBe(200);
  return res.headers["set-cookie"]!.toString().split(";")[0];
}

/** JSON request helper returning status and parsed body. */
export function client(h: Harness, cookie?: string) {
  const call = async (
    method: "GET" | "POST" | "PATCH",
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await h.app.inject({
      method,
      url,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(h.config.authMode === "oidc" ? { origin: h.config.appOrigin } : {}),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    let body: any = null;
    try {
      body = res.json();
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body };
  };
  return {
    get: (url: string) => call("GET", url),
    post: (
      url: string,
      payload: unknown = {},
      headers?: Record<string, string>,
    ) => call("POST", url, payload, headers),
    patch: (url: string, payload: unknown) => call("PATCH", url, payload),
  };
}

export const SESSION_BODY = (overrides: Record<string, unknown> = {}) => ({
  breakId: fixtureId(101),
  source: "mock",
  consentVersion: "v1",
  shareWithSupervisor: false,
  context: { workload: "heavy", temperatureC: 26 },
  ...overrides,
});

/**
 * Starts a real mock session through the API, then accelerates it: the live
 * synthetic source is stopped, the session start is moved 61 s into the past
 * and 60 synthetic readings are posted through the internal ingestion
 * endpoint. The real one-second cadence is exercised by demo.spec.ts; this
 * keeps API journeys fast while still using the ingestion contract.
 */
export async function acceleratedMockSession(
  h: Harness,
  workerCookie: string,
  body = SESSION_BODY(),
) {
  const api = client(h, workerCookie);
  const begin = await api.post("/api/sessions", body);
  expect(begin.status).toBe(201);
  const id: string = begin.body.session.id;
  await h.manager.stop(id);
  const startedAt = new Date(Date.now() - 61000).toISOString();
  await h.repo.transaction(async (tx) => {
    const s = (await tx.get("sessions", id))!;
    s.startedAt = startedAt;
    await tx.put("sessions", s);
  });
  const envelopes: ReadingEnvelope[] = Array.from({ length: 60 }, (_, i) => {
    const e = mockReading(startedAt, i);
    // Offset sequences so they cannot collide with the one or two readings
    // the live mock source persisted before it was stopped.
    return { ...e, sequence: 1000 + i };
  });
  const ingest = await client(h).post(
    `/api/sessions/${id}/readings`,
    { readings: envelopes },
    { authorization: `Bearer ${INTERNAL_TOKEN}` },
  );
  expect(ingest.status).toBe(200);
  expect(ingest.body.accepted).toBe(60);
  return id;
}

export async function protectedBreaks(h: Harness) {
  return (await h.repo.list("breaks"))
    .filter((b) => b.kind === "protected")
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function close(h: Harness) {
  try {
    await h.app.close();
  } catch {
    /* a test may have deliberately closed the database underneath */
  }
}

/** Provisioned test account; does not bypass deployed authentication routes. */
export async function loginAccount(
  h: Harness,
  role: "worker" | "supervisor",
  workerId = fixtureId(1),
) {
  const id = crypto.randomUUID();
  await h.repo.driver.query(
    "INSERT INTO auth_accounts (id,issuer,subject,email,site_id,role,worker_id,disabled,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id,
      h.config.oidcIssuer,
      id,
      `${id}@example.com`,
      h.config.siteId,
      role,
      role === "worker" ? workerId : null,
      0,
      new Date().toISOString(),
    ],
  );
  return `siteguard_session=${await createAccountSession(h.repo, id)}`;
}
