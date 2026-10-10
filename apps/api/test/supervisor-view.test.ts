// "What my supervisor sees" mirror and sharing withdrawal
// (docs/FEATURE_IDEAS.md, idea A1).
import { describe, it, expect, afterEach } from "vitest";
import { fixtureId } from "@siteguard/mock-data";
import {
  SupervisorViewResponseSchema,
  type Overview,
  type RestRequest,
} from "@siteguard/contracts";
import { testApp, login, populatedSession } from "./helpers.js";

const running: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => {
  for (const x of running.splice(0)) await x.app.close();
});
async function setup() {
  const x = await testApp();
  running.push(x);
  return x;
}
const PHYSIOLOGY_KEYS =
  /heartRateBpm|respiratoryRateBrpm|initialMedian|finalMedian|historicalMedianDelta|tiredness|robustZ|personal/;

describe("GET /api/workers/:id/supervisor-view", () => {
  it("mirrors exactly the overview records about this worker and nothing physiological", async () => {
    const { app, repo } = await setup();
    const shared = await populatedSession(repo, true);
    const worker = await login(app);
    // An assistance request linked to the shared session, plus a symptom report.
    const symptom = await app.inject({
      method: "POST",
      url: "/api/symptom-reports",
      headers: { cookie: worker },
      payload: {
        sessionId: shared.id,
        codes: ["dizzy"],
        note: "after lifting",
      },
    });
    expect(symptom.statusCode).toBe(201);

    const res = await app.inject({
      url: `/api/workers/${fixtureId(1)}/supervisor-view`,
      headers: { cookie: worker },
    });
    expect(res.statusCode).toBe(200);
    const { view } = SupervisorViewResponseSchema.parse(res.json());

    const supervisor = await login(app, "supervisor");
    const overview = (
      await app.inject({
        url: "/api/supervisor/overview",
        headers: { cookie: supervisor },
      })
    ).json() as Overview;
    const mine = <T extends { workerId: string }>(xs: T[]) =>
      xs.filter((x) => x.workerId === fixtureId(1));
    expect(view.breaks).toEqual(mine(overview.breaks));
    expect(view.assignments).toEqual(mine(overview.assignments));
    expect(view.availability).toEqual(mine(overview.availability));
    expect(view.requests).toEqual(mine(overview.requests));
    expect(view.symptomReports).toEqual(mine(overview.symptomReports));
    expect(view.breaks.length).toBeGreaterThan(0);
    expect(view.requests).toHaveLength(1);
    expect(view.symptomReports[0].note).toBe("after lifting");
    for (const t of view.tasks)
      expect(view.assignments.some((a) => a.taskId === t.id)).toBe(true);
    expect(view.sharedSessions).toEqual([
      {
        id: shared.id,
        source: "mock",
        status: "active",
        startedAt: shared.startedAt,
        endedAt: null,
        linkedToRequest: true,
      },
    ]);
    expect(overview.sharedSessionIds).toContain(shared.id);
    // Nothing about other workers, and no physiology at all.
    expect(JSON.stringify(view)).not.toMatch(PHYSIOLOGY_KEYS);
    for (const x of [
      ...view.breaks,
      ...view.requests,
      ...view.assignments,
      ...view.availability,
    ])
      expect(x.workerId).toBe(fixtureId(1));
  });

  it("lists shared sessions that are not linked to any request", async () => {
    const { app, repo } = await setup();
    const shared = await populatedSession(repo, true);
    const res = await app.inject({
      url: `/api/workers/${fixtureId(1)}/supervisor-view`,
      headers: { cookie: await login(app) },
    });
    const { view } = SupervisorViewResponseSchema.parse(res.json());
    expect(view.sharedSessions.map((s) => [s.id, s.linkedToRequest])).toEqual([
      [shared.id, false],
    ]);
  });

  it("is private to the worker: supervisors, other workers and anonymous callers are refused", async () => {
    const { app } = await setup();
    const url = `/api/workers/${fixtureId(1)}/supervisor-view`;
    expect(
      (
        await app.inject({
          url,
          headers: { cookie: await login(app, "supervisor") },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url,
          headers: { cookie: await login(app, "worker", fixtureId(2)) },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url })).statusCode).toBe(401);
  });
});

describe("PATCH /api/sessions/:id/sharing", () => {
  it("withdraws supervisor access without touching requests or their staffing block", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo, true);
    const worker = await login(app),
      supervisor = await login(app, "supervisor");
    const created = await app.inject({
      method: "POST",
      url: "/api/rest-requests",
      headers: { cookie: worker },
      payload: { sessionId: s.id, kind: "assistance", requestedMinutes: null },
    });
    const request = created.json().request as RestRequest;
    const ack = await app.inject({
      method: "PATCH",
      url: `/api/rest-requests/${request.id}`,
      headers: { cookie: supervisor },
      payload: {
        action: "acknowledge",
        revision: request.revision,
        note: "On my way.",
      },
    });
    expect(ack.statusCode).toBe(200);
    const summaryUrl = `/api/sessions/${s.id}/summary`;
    expect(
      (await app.inject({ url: summaryUrl, headers: { cookie: supervisor } }))
        .statusCode,
    ).toBe(200);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${s.id}/sharing`,
      headers: { cookie: worker },
      payload: { shareWithSupervisor: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().session.shareWithSupervisor).toBe(false);

    // Supervisor access to observations ends everywhere.
    for (const url of [
      summaryUrl,
      `/api/sessions/${s.id}`,
      `/api/sessions/${s.id}/readings`,
    ]) {
      const denied = await app.inject({ url, headers: { cookie: supervisor } });
      expect(denied.statusCode).toBe(403);
    }
    const explain = await app.inject({
      method: "POST",
      url: "/api/insights/explain",
      headers: { cookie: supervisor },
      payload: { kind: "session", sessionId: s.id },
    });
    expect(explain.statusCode).toBe(403);

    // The request, its acknowledgment and the staffing block are unchanged.
    const overview = (
      await app.inject({
        url: "/api/supervisor/overview",
        headers: { cookie: supervisor },
      })
    ).json() as Overview;
    const after = overview.requests.find((r) => r.id === request.id)!;
    expect(after.status).toBe("acknowledged");
    expect(after.sessionId).toBe(s.id);
    expect(overview.sharedSessionIds).not.toContain(s.id);
    const preview = (
      await app.inject({
        method: "POST",
        url: "/api/schedule/preview",
        headers: { cookie: supervisor },
        payload: {},
      })
    ).json() as { assignments: { workerId: string; startsAt: string }[] };
    expect(
      preview.assignments.some(
        (a) =>
          a.workerId === fixtureId(1) &&
          Date.parse(a.startsAt) >= Date.parse(request.createdAt),
      ),
    ).toBe(false);

    // The worker still owns and sees everything.
    expect(
      (await app.inject({ url: summaryUrl, headers: { cookie: worker } }))
        .statusCode,
    ).toBe(200);
    const view = SupervisorViewResponseSchema.parse(
      (
        await app.inject({
          url: `/api/workers/${fixtureId(1)}/supervisor-view`,
          headers: { cookie: worker },
        })
      ).json(),
    ).view;
    expect(view.sharedSessions).toEqual([]);
    expect(view.requests.map((r) => r.id)).toEqual([request.id]);

    // Audited as a worker action, and idempotent.
    const audits = await repo.list("audit_events");
    const withdrawn = audits.filter(
      (a) => a.action === "session_sharing_withdrawn",
    );
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({ actor: "worker", entityId: s.id });
    const again = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${s.id}/sharing`,
      headers: { cookie: worker },
      payload: { shareWithSupervisor: false },
    });
    expect(again.statusCode).toBe(200);
    expect(
      (await repo.list("audit_events")).filter(
        (a) => a.action === "session_sharing_withdrawn",
      ),
    ).toHaveLength(1);
  });

  it("only the owning worker can withdraw, and sharing cannot be granted here", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo, false);
    const url = `/api/sessions/${s.id}/sharing`;
    const grant = await app.inject({
      method: "PATCH",
      url,
      headers: { cookie: await login(app) },
      payload: { shareWithSupervisor: true },
    });
    expect(grant.statusCode).toBe(400);
    expect((await repo.get("sessions", s.id))?.shareWithSupervisor).toBe(false);
    for (const cookie of [
      await login(app, "supervisor"),
      await login(app, "worker", fixtureId(2)),
    ]) {
      const res = await app.inject({
        method: "PATCH",
        url,
        headers: { cookie },
        payload: { shareWithSupervisor: false },
      });
      expect(res.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "PATCH",
          url,
          payload: { shareWithSupervisor: false },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("ends a supervisor's live stream at the next heartbeat after withdrawal", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo, true);
    const supervisor = await login(app, "supervisor"),
      worker = await login(app);
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${base}/api/sessions/${s.id}/events`, {
      headers: { cookie: supervisor },
    });
    try {
      expect(response.status).toBe(200);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/sessions/${s.id}/sharing`,
        headers: { cookie: worker },
        payload: { shareWithSupervisor: false },
      });
      expect(res.statusCode).toBe(200);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value);
      }
      expect(output).toContain('"code":"SHARING_WITHDRAWN"');
      expect((await repo.get("sessions", s.id))?.status).toBe("active");
      reader.releaseLock();
    } finally {
      await response.body?.cancel();
    }
  }, 15000);
});
