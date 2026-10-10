// Dependency failure behavior at API level (in-process, no browser):
// Presage bridge down/unhealthy/stop failure/disconnect, Gemini failures, and
// database failures. All external services are local fixtures or stubs; no
// real Presage, Gemini or PostgreSQL service is contacted.
import { test, expect, describe, beforeEach, afterEach } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureId } from "@siteguard/mock-data";
import { GEMINI_TIMEOUT_MS } from "../../apps/api/src/insights/explain.js";
import {
  boot,
  close,
  client,
  loginAs,
  loginAccount,
  acceleratedMockSession,
  SESSION_BODY,
  type Harness,
} from "./support/in-process";

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return { server, url: `http://127.0.0.1:${address.port}` };
}
async function stopServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function closedPort() {
  const { server, url } = await listen(() => {});
  await stopServer(server);
  return url;
}
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const PRESAGE = SESSION_BODY({
  source: "presage",
  context: { workload: "heavy", temperatureC: 26 },
});

describe("Presage bridge failures", () => {
  test("bridge down: session stays presage, is interrupted, completes with insufficient data and no synthetic substitution", async () => {
    const h = await boot({
      bridgeUrl: await closedPort(),
      bridgeToken: "fixture-bridge-token",
    });
    try {
      expect(
        (await client(h).get("/api/health")).body.measurementSources,
      ).toEqual({ mock: true, presage: true });
      const w = client(h, await loginAs(h, "worker"));
      const begin = await w.post("/api/sessions", PRESAGE);
      expect(begin.status).toBe(201);
      const id = begin.body.session.id;
      expect(begin.body.session.source).toBe("presage");
      const stored = (await h.repo.get("sessions", id))!;
      expect(stored.interruption).toBe("Measurement source failed to start.");
      expect(h.manager.status(id)).toMatchObject({
        type: "error",
        code: "SOURCE_UNAVAILABLE",
        retryable: false,
      });
      expect((h.manager.status(id) as { message: string }).message).toContain(
        "synthetic mode is a separate check-in",
      );
      // No readings at all, and certainly no mock readings, were written.
      await new Promise((r) => setTimeout(r, 1500));
      expect(await h.repo.readings(id)).toEqual([]);
      const done = await w.post(`/api/sessions/${id}/complete`, {});
      expect(done.status).toBe(200);
      expect(done.body.session.source).toBe("presage");
      expect(done.body.summary.source).toBe("presage");
      expect(done.body.summary.pulse.status).toBe("insufficient_data");
      expect(done.body.summary.breathing.status).toBe("insufficient_data");
      // Never compared with the seeded synthetic history.
      expect(done.body.summary.pulseComparison.count).toBe(0);
      // Measurement failure does not imply safety or danger.
      expect(JSON.stringify(done.body)).not.toMatch(/safe|danger|risk/i);
    } finally {
      await close(h);
    }
  });

  test("bridge reports unavailable: start fails explicitly without readings", async () => {
    const { server, url } = await listen((req, res) =>
      req.url === "/v1/health"
        ? json(res, 200, {
            protocolVersion: 1,
            source: "presage",
            status: "unavailable",
            reason: "camera busy",
          })
        : json(res, 500, {}),
    );
    const h = await boot({
      bridgeUrl: url,
      bridgeToken: "fixture-bridge-token",
    });
    try {
      const w = client(h, await loginAs(h, "worker"));
      const id = (await w.post("/api/sessions", PRESAGE)).body.session.id;
      expect(h.manager.status(id)).toMatchObject({
        code: "SOURCE_UNAVAILABLE",
      });
      expect(await h.repo.readings(id)).toEqual([]);
    } finally {
      await close(h);
      await stopServer(server);
    }
  });

  test("bridge stop failure keeps the session active and completion retryable", async () => {
    let stopOk = false;
    let stream: ServerResponse | undefined;
    const { server, url } = await listen((req, res) => {
      if (req.url === "/v1/health")
        return json(res, 200, {
          protocolVersion: 1,
          source: "presage",
          status: "ready",
          reason: null,
        });
      if (req.url === "/v1/sessions")
        return json(res, 201, { bridgeSessionId: "fx" });
      if (req.url?.startsWith("/v1/sessions/fx/events")) {
        stream = res;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(": open\n\n");
        return;
      }
      if (req.url === "/v1/sessions/fx/stop") {
        if (!stopOk) return json(res, 500, {});
        stream?.end();
        return json(res, 200, { status: "stopped" });
      }
      json(res, 404, {});
    });
    const h = await boot({
      bridgeUrl: url,
      bridgeToken: "fixture-bridge-token",
    });
    try {
      const w = client(h, await loginAs(h, "worker"));
      const id = (await w.post("/api/sessions", PRESAGE)).body.session.id;
      const first = await w.post(`/api/sessions/${id}/complete`, {});
      expect(first.status).toBe(503);
      expect(first.body.error.code).toBe("BRIDGE_STOP_FAILED");
      expect((await h.repo.get("sessions", id))!.status).toBe("active");
      stopOk = true;
      const retry = await w.post(`/api/sessions/${id}/complete`, {});
      expect(retry.status).toBe(200);
      expect(retry.body.session.status).toBe("completed");
    } finally {
      await close(h);
      await stopServer(server);
    }
  });

  test("bridge disconnect mid-stream is visible and reconnects from the last sequence", async () => {
    const afters: string[] = [];
    const reading = (seconds: number) => ({
      type: "reading",
      reading: {
        timestamp: new Date(Date.now() - seconds * 1000).toISOString(),
        heartRateBpm: 88,
        respiratoryRateBrpm: 17,
        quality: "valid",
        source: "presage",
      },
    });
    const { server, url } = await listen((req, res) => {
      if (req.url === "/v1/health")
        return json(res, 200, {
          protocolVersion: 1,
          source: "presage",
          status: "ready",
          reason: null,
        });
      if (req.url === "/v1/sessions")
        return json(res, 201, { bridgeSessionId: "fx" });
      if (req.url?.startsWith("/v1/sessions/fx/events")) {
        afters.push(new URL(req.url, url).searchParams.get("after")!);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        if (afters.length === 1) {
          // First connection: two readings, then the bridge drops.
          res.write(`id: 0\ndata: ${JSON.stringify(reading(0))}\n\n`);
          res.write(`id: 1\ndata: ${JSON.stringify(reading(0))}\n\n`);
          setTimeout(() => res.end(), 50);
        } else res.write(": reconnected\n\n");
        return;
      }
      if (req.url === "/v1/sessions/fx/stop")
        return json(res, 200, { status: "stopped" });
      json(res, 404, {});
    });
    const h = await boot({
      bridgeUrl: url,
      bridgeToken: "fixture-bridge-token",
    });
    try {
      const w = client(h, await loginAs(h, "worker"));
      const id = (await w.post("/api/sessions", PRESAGE)).body.session.id;
      await expect.poll(() => afters.length, { timeout: 8000 }).toBe(2);
      expect(afters).toEqual(["-1", "1"]);
      const s = (await h.repo.get("sessions", id))!;
      expect(s.interruption).toContain("interrupted");
      const readings = await h.repo.readings(id);
      expect(readings.map((e) => e.sequence)).toEqual([0, 1]);
      expect(readings.every((e) => e.reading.source === "presage")).toBe(true);
      expect((await w.post(`/api/sessions/${id}/complete`, {})).status).toBe(
        200,
      );
    } finally {
      await close(h);
      await stopServer(server);
    }
  });

  test("a presage session is refused on a hosted deployment", async () => {
    // loadConfig requires these from the environment (not overrides) when hosted.
    const saved = {
      COOKIE_SECRET: process.env.COOKIE_SECRET,
      MEASUREMENT_TOKEN: process.env.MEASUREMENT_TOKEN,
    };
    process.env.COOKIE_SECRET =
      "hosted-fixture-secret-at-least-thirty-two-chars";
    process.env.MEASUREMENT_TOKEN = "hosted-fixture-internal-token";
    let h: Harness;
    try {
      h = await boot({
        hosted: true,
        authMode: "oidc",
        appOrigin: "https://siteguard.example",
        oidcIssuer: "https://identity.example",
        oidcClientId: "test-client",
        bridgeToken: "fixture-bridge-token",
      });
    } finally {
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
      // Hosted cookies are Secure; inject over HTTP still carries them.
      const w = client(h, await loginAccount(h, "worker"));
      const res = await w.post("/api/sessions", PRESAGE);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("REAL_LOCAL_ONLY");
      expect(
        (await client(h).get("/api/health")).body.measurementSources.presage,
      ).toBe(false);
    } finally {
      await close(h);
    }
  });
});

describe("Gemini failures fall back to deterministic facts", () => {
  const realFetch = globalThis.fetch;
  let geminiCalls: { url: string; body: string }[] = [];
  let respond: () => Promise<Response>;
  beforeEach(() => {
    geminiCalls = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("generativelanguage.googleapis.com")) {
        geminiCalls.push({ url, body: String(init?.body ?? "") });
        return respond();
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const geminiText = (text: string) =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: { role: "model", parts: [{ text }] },
            finishReason: "STOP",
            index: 0,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  async function explainCompletedSession(h: Harness) {
    const cookie = await loginAs(h, "worker");
    const id = await acceleratedMockSession(h, cookie);
    const w = client(h, cookie);
    await w.post(`/api/sessions/${id}/complete`, {});
    const started = Date.now();
    const res = await w.post("/api/insights/explain", {
      kind: "session",
      sessionId: id,
    });
    return { res, elapsed: Date.now() - started };
  }

  for (const [label, make] of [
    ["network error", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "HTTP 500",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 500 } }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    ],
    ["non-JSON text", () => Promise.resolve(geminiText("The worker is fine."))],
    [
      "unsupported fact id",
      () =>
        Promise.resolve(
          geminiText(
            JSON.stringify({
              selections: [{ factId: "medical_clearance", variant: 0 }],
            }),
          ),
        ),
    ],
  ] as const) {
    test(`${label} → deterministic explanation`, async () => {
      respond = make;
      const h = await boot({
        geminiKey: "fixture-key-not-real",
        geminiModel: "fixture-model",
      });
      try {
        expect((await client(h).get("/api/health")).body.insightsMode).toBe(
          "configured",
        );
        const { res } = await explainCompletedSession(h);
        expect(res.status).toBe(200);
        expect(res.body.origin).toBe("deterministic");
        expect(res.body.observations.length).toBeGreaterThan(0);
        expect(geminiCalls.length).toBeGreaterThan(0);
      } finally {
        await close(h);
      }
    });
  }

  test("hung Gemini call times out to deterministic facts within the adapter deadline", async () => {
    respond = () => new Promise<Response>(() => {});
    const h = await boot({
      geminiKey: "fixture-key-not-real",
      geminiModel: "fixture-model",
    });
    try {
      const { res, elapsed } = await explainCompletedSession(h);
      expect(res.body.origin).toBe("deterministic");
      expect(elapsed).toBeLessThan(GEMINI_TIMEOUT_MS + 3000);
    } finally {
      await close(h);
    }
  });

  test("fixture Gemini selection is rendered from server facts only (control; not live verification)", async () => {
    respond = () =>
      Promise.resolve(
        geminiText(
          JSON.stringify({
            selections: [
              // Every server fact once (a partial selection may be rejected).
              { factId: "breathing", variant: 0 },
              { factId: "breathing_history", variant: 0 },
              { factId: "pulse", variant: 0 },
              { factId: "pulse_history", variant: 0 },
            ],
          }),
        ),
      );
    const h = await boot({
      geminiKey: "fixture-key-not-real",
      geminiModel: "fixture-model",
    });
    try {
      // Add a symptom note that must never be sent to Gemini.
      const cookie = await loginAs(h, "worker");
      await client(h, cookie).post("/api/symptom-reports", {
        sessionId: null,
        codes: ["other"],
        note: "PRIVATE-NOTE-MARKER",
      });
      const { res } = await explainCompletedSession(h);
      expect(res.body.origin).toBe("gemini");
      expect(res.body.observations[0]).toMatch(/^Breathing rate changed by/);
      const sent = geminiCalls.map((c) => c.body).join("\n");
      expect(sent).not.toContain("PRIVATE-NOTE-MARKER");
      expect(sent).not.toContain("W-01");
      expect(sent).not.toContain(fixtureId(1));
      expect(sent).not.toContain("heartRateBpm");
    } finally {
      await close(h);
    }
  });
});

describe("database failures", () => {
  test("unreachable PostgreSQL refuses to start instead of falling back to SQLite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "siteguard-dbfail-"));
    const sqlitePath = join(dir, "should-not-exist.sqlite");
    const port = new URL(await closedPort()).port;
    try {
      await expect(
        boot({
          databaseUrl: `postgres://user:pass@127.0.0.1:${port}/siteguard`,
          sqlitePath,
        }),
      ).rejects.toThrow();
      expect(existsSync(sqlitePath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("database lost at runtime → explicit 503, no false success, no internals leaked", async () => {
    const h = await boot();
    try {
      const cookie = await loginAs(h, "worker");
      const before = await client(h).get("/api/health");
      expect(before.body.database).toBe("sqlite");
      await h.repo.driver.close();
      const health = await client(h).get("/api/health");
      expect(health.status).toBe(503);
      expect(health.body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
      const write = await client(h, cookie).post("/api/rest-requests", {
        sessionId: null,
        kind: "assistance",
        requestedMinutes: null,
      });
      expect(write.status).toBe(503);
      expect(write.body.error.message).toContain("not confirmed");
      expect(JSON.stringify(write.body)).not.toMatch(
        /sqlite|database is|stack/i,
      );
    } finally {
      await close(h);
    }
  });

  test("storage failure during a live mock session is reported, not hidden or source-switched", async () => {
    const h = await boot();
    try {
      const w = client(h, await loginAs(h, "worker"));
      const id = (await w.post("/api/sessions", SESSION_BODY())).body.session
        .id;
      await h.repo.driver.close();
      await expect
        .poll(() => (h.manager.status(id) as { code?: string })?.code, {
          timeout: 5000,
        })
        .toBe("MEASUREMENT_STORAGE");
      expect((h.manager.status(id) as { message: string }).message).toContain(
        "No safety conclusion",
      );
    } finally {
      await close(h);
    }
  });
});
