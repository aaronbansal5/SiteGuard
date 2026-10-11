import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureId } from "@siteguard/mock-data";
import { sessionSummary } from "../src/domain/sessions.js";
import { evaluateRestSupport } from "../src/research/rest-support.js";
import { login, populatedSession, testApp } from "./helpers.js";

const running: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const ctx of running.splice(0)) await ctx.app.close();
});

async function setup(share = false, completed = true) {
  const ctx = await testApp();
  running.push(ctx);
  const active = await populatedSession(ctx.repo, share);
  const session = completed
    ? {
        ...active,
        status: "completed" as const,
        endedAt: new Date(Date.parse(active.startedAt) + 60000).toISOString(),
      }
    : active;
  await ctx.repo.put("sessions", session);
  return { ...ctx, session, url: `/api/sessions/${session.id}/rest-support` };
}

describe("worker-only research rest-support API", () => {
  it("returns the direct model result from the completed summary and eligible history", async () => {
    const { app, repo, session, url } = await setup();
    const cookie = await login(app);
    const summary = await sessionSummary(repo, session.id);
    expect(summary.pulse.status).toBe("available");
    expect(summary.pulseComparison.count).toBe(4);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("External inference must not be called"));
    const breaksBefore = await repo.list("breaks");
    const requestsBefore = await repo.list("rest_requests");
    const res = await app.inject({ url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(evaluateRestSupport(summary));
    expect(res.json()).toMatchObject({
      experimental: true,
      confidence: null,
      evidence: { source: "mock", synthetic: true },
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).not.toContain(session.id);
    expect(res.body).not.toContain(session.workerId);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await repo.list("breaks")).toEqual(breaksBefore);
    expect(await repo.list("rest_requests")).toEqual(requestsBefore);
    expect(await repo.get("sessions", session.id)).toEqual(session);
  });

  it("returns insufficient evidence for a completed Presage session without usable readings", async () => {
    const { app, repo, session } = await setup();
    const real = {
      ...session,
      id: fixtureId(9001),
      source: "presage" as const,
    };
    await repo.put("sessions", real);
    const cookie = await login(app);
    const res = await app.inject({
      url: `/api/sessions/${real.id}/rest-support`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      signal: "insufficient_evidence",
      confidence: null,
      evidence: {
        source: "presage",
        synthetic: false,
        pulse: null,
        breathing: null,
      },
    });
    expect(res.json().evidence.issues.length).toBeGreaterThan(0);
  });

  it("rejects active sessions before loading their summary", async () => {
    const { app, repo, url } = await setup(false, false);
    const cookie = await login(app);
    const readings = vi.spyOn(repo, "readings");
    const res = await app.inject({ url, headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SESSION_ACTIVE");
    expect(readings).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps research results owner-only with sharing=%s",
    async (share) => {
      const { app, repo, url } = await setup(share);
      const other = await login(app, "worker", fixtureId(2));
      const supervisor = await login(app, "supervisor");
      const readings = vi.spyOn(repo, "readings");
      for (const [headers, status] of [
        [{}, 401],
        [{ cookie: "siteguard=invalid" }, 401],
        [{ authorization: "Bearer internal-test-token" }, 401],
        [{ cookie: other }, 403],
        [{ cookie: supervisor }, 403],
      ] as const) {
        const res = await app.inject({ url, headers });
        expect(res.statusCode).toBe(status);
        expect(res.json()).not.toHaveProperty("evidence");
        expect(res.body).not.toContain("modelVersion");
      }
      expect(readings).not.toHaveBeenCalled();
    },
  );

  it("validates session IDs and returns 404 for an owner's missing session", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    for (const [id, status, code] of [
      ["invalid", 400, "VALIDATION"],
      [fixtureId(9999), 404, "NOT_FOUND"],
    ] as const) {
      const res = await app.inject({
        url: `/api/sessions/${id}/rest-support`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(status);
      expect(res.json().error.code).toBe(code);
    }
  });

  it("keeps shared summaries and Gemini explanations free of private research results", async () => {
    const { app, session } = await setup(true);
    const cookie = await login(app, "supervisor");
    const responses = [
      await app.inject({
        url: `/api/sessions/${session.id}/summary`,
        headers: { cookie },
      }),
      await app.inject({
        method: "POST",
        url: "/api/insights/explain",
        headers: { cookie },
        payload: { kind: "session", sessionId: session.id },
      }),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      for (const field of [
        "modelVersion",
        "uncertainty",
        "consider_additional_rest",
        "no_additional_signal",
      ])
        expect(res.body).not.toContain(field);
    }
  });
});
