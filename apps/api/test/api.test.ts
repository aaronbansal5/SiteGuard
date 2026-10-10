import { describe, it, expect, afterEach } from "vitest";
import { fixtureId, mockReading } from "@siteguard/mock-data";
import { testApp, login, populatedSession } from "./helpers.js";
import { SummaryResponseSchema } from "@siteguard/contracts";
const running: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => {
  for (const x of running.splice(0)) await x.app.close();
});
async function setup() {
  const x = await testApp();
  running.push(x);
  return x;
}
describe("API and transactional invariants", () => {
  it("enforces identity and worker isolation", async () => {
    const { app } = await setup();
    expect((await app.inject("/api/breaks")).statusCode).toBe(401);
    const cookie = await login(app);
    expect(
      (
        await app.inject({
          url: `/api/workers/${fixtureId(2)}/history`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    const forged = await app.inject({
      url: "/api/breaks",
      headers: { cookie: "siteguard=fake" },
    });
    expect(forged.statusCode).toBe(401);
  });
  it("rejects a correctly signed but expired identity", async () => {
    const { app } = await setup();
    const value = JSON.stringify({
      identity: { role: "supervisor" },
      expiresAt: Date.now() - 1,
    });
    const cookie = `siteguard=${encodeURIComponent(app.signCookie(value))}`;
    expect(
      (
        await app.inject({
          url: "/api/supervisor/overview",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("rejects same-host writes using a different origin scheme", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/demo/login",
      headers: { host: "localhost", origin: "https://localhost" },
      payload: { role: "supervisor" },
    });
    expect(response.statusCode).toBe(403);
  });
  it("limits public demo logins and returns a retry hint", async () => {
    const { app } = await setup();
    for (let i = 0; i < 30; i++)
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/demo/login",
            payload: { role: "supervisor" },
          })
        ).statusCode,
      ).toBe(200);
    const response = await app.inject({
      method: "POST",
      url: "/api/demo/login",
      payload: { role: "supervisor" },
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("60");
  });
  it("completes a populated session idempotently and validates summary response", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo);
    const cookie = await login(app);
    const req = {
      method: "POST" as const,
      url: `/api/sessions/${s.id}/complete`,
      headers: { cookie },
      payload: {},
    };
    const first = await app.inject(req),
      second = await app.inject(req);
    expect(first.statusCode).toBe(200);
    expect(second.json().session.endedAt).toBe(first.json().session.endedAt);
    const response = await app.inject({
      url: `/api/sessions/${s.id}/summary`,
      headers: { cookie },
    });
    const v = SummaryResponseSchema.parse(response.json());
    expect(v.summary.pulse.status).toBe("available");
    expect(v.summary.pulseComparison.count).toBe(4);
  });
  it("respects sharing consent and hides physiology in overview", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo);
    const cookie = await login(app, "supervisor");
    expect(
      (
        await app.inject({
          url: `/api/sessions/${s.id}/summary`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    await repo.put("sessions", { ...s, shareWithSupervisor: true });
    expect(
      (
        await app.inject({
          url: `/api/sessions/${s.id}/summary`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    const o = await app.inject({
      url: "/api/supervisor/overview",
      headers: { cookie },
    });
    expect(o.body).not.toContain("heartRate");
    expect(o.body).not.toContain("summary");
  });
  it("rejects protected break changes", async () => {
    const { app, repo } = await setup();
    const cookie = await login(app, "supervisor"),
      b = (await repo.list("breaks"))[0];
    const res = await app.inject({
      method: "PATCH",
      url: `/api/breaks/${b.id}`,
      headers: { cookie },
      payload: { startsAt: b.startsAt, endsAt: b.endsAt, revision: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("PROTECTED_BREAK");
  });
  it("reports symptoms without a session and keeps assistance after acknowledgment/planning", async () => {
    const { app, repo } = await setup();
    const wc = await login(app),
      sc = await login(app, "supervisor");
    const report = await app.inject({
      method: "POST",
      url: "/api/symptom-reports",
      headers: { cookie: wc },
      payload: { sessionId: null, codes: ["dizzy"], note: null },
    });
    expect(report.statusCode).toBe(201);
    const request = report.json().request;
    const acknowledged = await app.inject({
      method: "PATCH",
      url: `/api/rest-requests/${request.id}`,
      headers: { cookie: sc },
      payload: {
        action: "acknowledge",
        revision: 0,
        note: "Human follow-up pending.",
      },
    });
    expect(acknowledged.statusCode).toBe(200);
    const p = (
      await app.inject({
        method: "POST",
        url: "/api/schedule/preview",
        headers: { cookie: sc },
        payload: {},
      })
    ).json();
    expect(
      p.assignments
        .filter(
          (a: { workerId: string; endsAt: string }) =>
            a.workerId === fixtureId(1),
        )
        .every(
          (a: { endsAt: string }) =>
            Date.parse(a.endsAt) <= Date.parse(request.createdAt),
        ),
    ).toBe(true);
    await app.inject({
      method: "POST",
      url: "/api/schedule/commit",
      headers: { cookie: sc },
      payload: { baseRevision: p.baseRevision, assignments: p.assignments },
    });
    expect((await repo.get("rest_requests", request.id))!.status).toBe(
      "acknowledged",
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/rest-requests/${request.id}`,
          headers: { cookie: sc },
          payload: { action: "decline", revision: 1, note: "Decline" },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("approves rest, preserves protected breaks, and prevents rest shrinkage", async () => {
    const { app, repo } = await setup();
    const wc = await login(app),
      sc = await login(app, "supervisor");
    const before = (await repo.list("breaks")).filter(
      (b) => b.kind === "protected",
    );
    const result = await app.inject({
      method: "POST",
      url: "/api/rest-requests",
      headers: { cookie: wc },
      payload: {
        sessionId: null,
        kind: "additional_rest",
        requestedMinutes: 5,
      },
    });
    const request = result.json().request;
    const start = new Date(Date.now() + 1000).toISOString(),
      end = new Date(Date.parse(start) + 300000).toISOString();
    const approved = await app.inject({
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
    });
    expect(approved.statusCode).toBe(200);
    expect(
      (await repo.list("breaks")).filter((b) => b.kind === "protected"),
    ).toEqual(before);
    const b = (await repo.list("breaks")).find((b) => b.kind === "additional")!;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/breaks/${b.id}`,
          headers: { cookie: sc },
          payload: {
            startsAt: start,
            endsAt: new Date(Date.parse(start) + 60000).toISOString(),
            revision: 0,
          },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("rejects stale proposals after a new worker request", async () => {
    const { app } = await setup();
    const sc = await login(app, "supervisor"),
      wc = await login(app);
    const p = (
      await app.inject({
        method: "POST",
        url: "/api/schedule/preview",
        headers: { cookie: sc },
        payload: {},
      })
    ).json();
    await app.inject({
      method: "POST",
      url: "/api/rest-requests",
      headers: { cookie: wc },
      payload: { sessionId: null, kind: "assistance", requestedMinutes: null },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/schedule/commit",
      headers: { cookie: sc },
      payload: { baseRevision: p.baseRevision, assignments: p.assignments },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("STALE_REVISION");
  });
  it("requires internal ingestion token and rejects writes after completion", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo);
    const payload = { readings: [mockReading(s.startedAt, 60)] };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/sessions/${s.id}/readings`,
          payload,
        })
      ).statusCode,
    ).toBe(401);
    const token = { authorization: "Bearer internal-test-token" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/sessions/${s.id}/readings`,
          headers: token,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    const cookie = await login(app);
    await app.inject({
      method: "POST",
      url: `/api/sessions/${s.id}/complete`,
      headers: { cookie },
      payload: {},
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/sessions/${s.id}/readings`,
          headers: token,
          payload,
        })
      ).statusCode,
    ).toBe(409);
  });
  it("enforces active breaks, one active session, and explicit Presage failure", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    const base = {
      breakId: fixtureId(101),
      source: "presage",
      consentVersion: "v1",
      shareWithSupervisor: false,
      context: { workload: null, temperatureC: null },
    };
    const started = await app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: base,
    });
    expect(started.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/sessions",
          headers: { cookie },
          payload: base,
        })
      ).statusCode,
    ).toBe(409);
    const sid = started.json().session.id;
    const saved = (
      await app.inject({ url: `/api/sessions/${sid}`, headers: { cookie } })
    ).json();
    expect(saved.session.source).toBe("presage");
    expect(saved.session.interruption).toContain("failed");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/sessions/${sid}/complete`,
          headers: { cookie },
          payload: {},
        })
      ).json().summary.pulse.status,
    ).toBe("insufficient_data");
  });
  it("rejects cross-origin writes and unexpected fields", async () => {
    const { app } = await setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/demo/login",
          headers: { origin: "https://evil.example" },
          payload: { role: "supervisor" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/demo/login",
          payload: { role: "supervisor", admin: true },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("paginates history without duplicates and validates cursor", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    const first = (
      await app.inject({
        url: `/api/workers/${fixtureId(1)}/history?limit=2`,
        headers: { cookie },
      })
    ).json();
    expect(first.sessions).toHaveLength(2);
    const second = (
      await app.inject({
        url: `/api/workers/${fixtureId(1)}/history?limit=2&before=${first.nextCursor}`,
        headers: { cookie },
      })
    ).json();
    expect(second.sessions).toHaveLength(2);
    expect(
      new Set([...first.sessions, ...second.sessions].map((s) => s.id)).size,
    ).toBe(4);
    expect(
      (
        await app.inject({
          url: `/api/workers/${fixtureId(1)}/history?before=garbage`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("reset refuses real data and active sessions", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo);
    const cookie = await login(app, "supervisor");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/demo/reset",
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    await repo.put("sessions", {
      ...s,
      source: "presage",
      status: "completed",
      endedAt: new Date().toISOString(),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/demo/reset",
          headers: { cookie },
          payload: {},
        })
      ).json().error.code,
    ).toBe("REAL_DATA_PRESENT");
  });
});
