// Safety and privacy invariants at API level (in-process, no browser).
import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";
import type { Assignment, RestRequest } from "@siteguard/contracts";
import {
  boot,
  close,
  client,
  loginAs,
  acceleratedMockSession,
  protectedBreaks,
  SESSION_BODY,
  type Harness,
} from "./support/in-process";

let h: Harness;
test.beforeEach(async () => {
  h = await boot();
});
test.afterEach(async () => close(h));

const minutes = (m: number) => new Date(Date.now() + m * 60000).toISOString();

test.describe("consent restrictions", () => {
  test("supervisor cannot read, stream, explain or complete an unshared session", async () => {
    const w = await loginAs(h, "worker");
    const sup = client(h, await loginAs(h, "supervisor"));
    const id = await acceleratedMockSession(h, w);
    for (const path of [
      `/api/sessions/${id}`,
      `/api/sessions/${id}/summary`,
      `/api/sessions/${id}/readings`,
      `/api/sessions/${id}/events`,
    ]) {
      const res = await sup.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.message).toContain("sharing consent");
    }
    const explain = await sup.post("/api/insights/explain", {
      kind: "session",
      sessionId: id,
    });
    expect(explain.status).toBe(403);
    const complete = await sup.post(`/api/sessions/${id}/complete`, {});
    expect(complete.status).toBe(403);
    // The session is still active: the supervisor could not stop it.
    expect((await h.repo.get("sessions", id))!.status).toBe("active");
  });

  test("shared consent allows reading but never supervisor writes", async () => {
    const w = await loginAs(h, "worker");
    const sup = client(h, await loginAs(h, "supervisor"));
    const id = await acceleratedMockSession(
      h,
      w,
      SESSION_BODY({ shareWithSupervisor: true }),
    );
    expect((await sup.get(`/api/sessions/${id}/summary`)).status).toBe(200);
    expect((await sup.post(`/api/sessions/${id}/complete`, {})).status).toBe(
      403,
    );
  });

  test("workers cannot reach another worker's sessions, history or requests", async () => {
    const w1 = await loginAs(h, "worker", fixtureId(1));
    const w2 = client(h, await loginAs(h, "worker", fixtureId(2)));
    const id = await acceleratedMockSession(h, w1);
    expect((await w2.get(`/api/sessions/${id}/summary`)).status).toBe(403);
    expect((await w2.get(`/api/sessions/${id}/readings`)).status).toBe(403);
    expect((await w2.get(`/api/workers/${fixtureId(1)}/history`)).status).toBe(
      403,
    );
    // Cannot link a request to someone else's session.
    const linked = await w2.post("/api/rest-requests", {
      sessionId: id,
      kind: "assistance",
      requestedMinutes: null,
    });
    expect(linked.status).toBe(403);
    // Cannot start a check-in on another worker's break.
    const foreign = await w2.post(
      "/api/sessions",
      SESSION_BODY({ breakId: fixtureId(101) }),
    );
    expect(foreign.status).toBe(403);
    // Own request list excludes worker 1's requests.
    await client(h, w1).post("/api/rest-requests", {
      sessionId: null,
      kind: "assistance",
      requestedMinutes: null,
    });
    const own = (await w2.get("/api/rest-requests")).body.requests;
    expect(own.every((r: RestRequest) => r.workerId === fixtureId(2))).toBe(
      true,
    );
  });

  test("supervisor cannot view worker history and unknown consent versions are rejected", async () => {
    const sup = client(h, await loginAs(h, "supervisor"));
    expect((await sup.get(`/api/workers/${fixtureId(1)}/history`)).status).toBe(
      403,
    );
    expect((await sup.post("/api/sessions", SESSION_BODY())).status).toBe(403);
    const w = client(h, await loginAs(h, "worker"));
    const v2 = await w.post(
      "/api/sessions",
      SESSION_BODY({ consentVersion: "v2" }),
    );
    expect(v2.status).toBe(400);
    expect(
      (await h.repo.list("sessions")).some((s) => s.status === "active"),
    ).toBe(false);
  });
});

test.describe("assistance without measurement", () => {
  test("assistance and symptoms work with no session and no readings", async () => {
    const worker = client(h, await loginAs(h, "worker", fixtureId(3)));
    const sup = client(h, await loginAs(h, "supervisor"));
    const sessionsBefore = (await h.repo.list("sessions")).length;

    const assist = await worker.post("/api/rest-requests", {
      sessionId: null,
      kind: "assistance",
      requestedMinutes: null,
    });
    expect(assist.status).toBe(201);
    expect(assist.body.request.sessionId).toBeNull();
    expect(assist.body.request.status).toBe("pending");

    // A symptom report links to the same open assistance request.
    const symptom = await worker.post("/api/symptom-reports", {
      sessionId: null,
      codes: ["dizzy", "headache"],
      note: "Felt light-headed",
    });
    expect(symptom.status).toBe(201);
    expect(symptom.body.request.id).toBe(assist.body.request.id);
    expect(symptom.body.report.assistanceRequestId).toBe(
      assist.body.request.id,
    );

    // No measurement session was created as a side effect.
    expect((await h.repo.list("sessions")).length).toBe(sessionsBefore);

    const overview = await sup.get("/api/supervisor/overview");
    expect(
      overview.body.requests.filter(
        (r: RestRequest) =>
          r.workerId === fixtureId(3) && r.kind === "assistance",
      ),
    ).toHaveLength(1);
    expect(
      overview.body.symptomReports.some(
        (s: { workerId: string }) => s.workerId === fixtureId(3),
      ),
    ).toBe(true);

    // The planner excludes the worker from staffing after the request.
    const preview = await sup.post("/api/schedule/preview", {});
    const created = Date.parse(assist.body.request.createdAt);
    expect(
      preview.body.assignments.some(
        (a: Assignment) =>
          a.workerId === fixtureId(3) && Date.parse(a.endsAt) > created,
      ),
    ).toBe(false);
  });

  test("assistance requests reject minutes; rest requests require bounded minutes", async () => {
    const worker = client(h, await loginAs(h, "worker"));
    for (const body of [
      { sessionId: null, kind: "assistance", requestedMinutes: 5 },
      { sessionId: null, kind: "additional_rest", requestedMinutes: null },
      { sessionId: null, kind: "additional_rest", requestedMinutes: 0 },
      { sessionId: null, kind: "additional_rest", requestedMinutes: 121 },
    ])
      expect((await worker.post("/api/rest-requests", body)).status).toBe(400);
  });
});

test.describe("protected and required breaks", () => {
  test("protected breaks cannot move, shrink or extend through the API", async () => {
    const sup = client(h, await loginAs(h, "supervisor"));
    const before = await protectedBreaks(h);
    const b = before[1];
    const shift = (iso: string, m: number) =>
      new Date(Date.parse(iso) + m * 60000).toISOString();
    for (const [label, body] of [
      ["move", { startsAt: shift(b.startsAt, 5), endsAt: shift(b.endsAt, 5) }],
      ["shrink", { startsAt: b.startsAt, endsAt: shift(b.endsAt, -5) }],
      ["extend", { startsAt: b.startsAt, endsAt: shift(b.endsAt, 5) }],
      ["unchanged", { startsAt: b.startsAt, endsAt: b.endsAt }],
    ] as const) {
      const res = await sup.patch(`/api/breaks/${b.id}`, {
        ...body,
        revision: b.revision,
      });
      expect(res.status, label).toBe(409);
      expect(res.body.error.code, label).toBe("PROTECTED_BREAK");
    }
    expect(await protectedBreaks(h)).toEqual(before);
  });

  test("a committed assignment cannot overlap a protected break", async () => {
    const sup = client(h, await loginAs(h, "supervisor"));
    const before = await protectedBreaks(h);
    const assignmentsBefore = await h.repo.list("task_assignments");
    const w2Break = before.find((b) => b.workerId === fixtureId(2))!;
    const preview = await sup.post("/api/schedule/preview", {});
    const commit = await sup.post("/api/schedule/commit", {
      baseRevision: preview.body.baseRevision,
      assignments: [
        {
          id: crypto.randomUUID(),
          taskId: fixtureId(201),
          workerId: fixtureId(2),
          startsAt: w2Break.startsAt,
          endsAt: w2Break.endsAt,
        },
      ],
    });
    expect(commit.status).toBe(409);
    expect(commit.body.error.code).toBe("ASSIGNMENT_CONFLICT");
    expect(await h.repo.list("task_assignments")).toEqual(assignmentsBefore);
    expect(await protectedBreaks(h)).toEqual(before);
  });

  test("approved rest cannot shrink, be shorter than requested, or move into the past", async () => {
    const worker = client(h, await loginAs(h, "worker"));
    const sup = client(h, await loginAs(h, "supervisor"));
    const req = (
      await worker.post("/api/rest-requests", {
        sessionId: null,
        kind: "additional_rest",
        requestedMinutes: 10,
      })
    ).body.request as RestRequest;
    const short = await sup.patch(`/api/rest-requests/${req.id}`, {
      action: "approve",
      revision: 0,
      note: "Too short",
      restStartsAt: minutes(20),
      restEndsAt: minutes(25),
    });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe("REST_INTERVAL");
    const ok = await sup.patch(`/api/rest-requests/${req.id}`, {
      action: "approve",
      revision: 0,
      note: "Approved",
      restStartsAt: minutes(20),
      restEndsAt: minutes(30),
    });
    expect(ok.status).toBe(200);
    const rest = (await h.repo.list("breaks")).find(
      (b) => b.requestId === req.id,
    )!;
    const shrink = await sup.patch(`/api/breaks/${rest.id}`, {
      startsAt: rest.startsAt,
      endsAt: minutes(27),
      revision: rest.revision,
    });
    expect(shrink.status).toBe(409);
    expect(shrink.body.error.code).toBe("REST_MINIMUM");
    const past = await sup.patch(`/api/breaks/${rest.id}`, {
      startsAt: minutes(-30),
      endsAt: minutes(-20),
      revision: rest.revision,
    });
    expect(past.status).toBe(409);
    // A later move that keeps the full duration is allowed.
    const moved = await sup.patch(`/api/breaks/${rest.id}`, {
      startsAt: minutes(40),
      endsAt: minutes(50),
      revision: rest.revision,
    });
    expect(moved.status).toBe(200);
  });

  // Possible application bug (reported to main app owner, not fixed here):
  // PATCH /rest-requests approve accepts an "additional" rest interval placed
  // entirely inside the worker's existing protected break. PROJECT_SPEC says
  // approval "creates separate additional rest"; an interval that coincides
  // with the protected break adds no rest at all. The UI places rest after the
  // protected break, but the API does not enforce it.
  test.fixme("approved additional rest must not be absorbed inside the protected break", async () => {
    const worker = client(h, await loginAs(h, "worker"));
    const sup = client(h, await loginAs(h, "supervisor"));
    const req = (
      await worker.post("/api/rest-requests", {
        sessionId: null,
        kind: "additional_rest",
        requestedMinutes: 5,
      })
    ).body.request as RestRequest;
    const own = (await protectedBreaks(h)).find(
      (b) => b.workerId === fixtureId(1),
    )!;
    const res = await sup.patch(`/api/rest-requests/${req.id}`, {
      action: "approve",
      revision: 0,
      note: "Inside protected break",
      restStartsAt: new Date(Date.now() + 60000).toISOString(),
      restEndsAt: new Date(Date.now() + 6 * 60000).toISOString(),
    });
    // Expected: rejected (409) because it overlaps protected break `own`.
    expect(Date.parse(own.endsAt)).toBeGreaterThan(Date.now() + 6 * 60000);
    expect(res.status).toBe(409);
  });
});

test.describe("unresolved assistance", () => {
  test("acknowledgment and scheduling never clear assistance; only explicit resolve does", async () => {
    const worker = client(h, await loginAs(h, "worker", fixtureId(2)));
    const sup = client(h, await loginAs(h, "supervisor"));
    const report = await worker.post("/api/symptom-reports", {
      sessionId: null,
      codes: ["nauseated"],
      note: null,
    });
    const request = report.body.request as RestRequest;

    for (const action of ["approve", "decline"])
      expect(
        (
          await sup.patch(`/api/rest-requests/${request.id}`, {
            action,
            revision: 0,
            note: "Should be refused",
            restStartsAt: minutes(1),
            restEndsAt: minutes(30),
          })
        ).body.error.code,
        action,
      ).toBe("ASSISTANCE_PROTECTED");

    const ack = await sup.patch(`/api/rest-requests/${request.id}`, {
      action: "acknowledge",
      revision: 0,
      note: "Supervisor walking over.",
    });
    expect(ack.status).toBe(200);
    expect(ack.body.request.status).toBe("acknowledged");

    // Run the planner twice and commit; the request is untouched.
    for (let i = 0; i < 2; i++) {
      const preview = await sup.post("/api/schedule/preview", {});
      expect(
        preview.body.assignments.some(
          (a: Assignment) =>
            a.workerId === fixtureId(2) &&
            Date.parse(a.endsAt) > Date.parse(request.createdAt),
        ),
      ).toBe(false);
      const commit = await sup.post("/api/schedule/commit", {
        baseRevision: preview.body.baseRevision,
        assignments: preview.body.assignments,
      });
      expect(commit.status).toBe(200);
    }
    const stored = (await h.repo.get("rest_requests", request.id))!;
    expect(stored.status).toBe("acknowledged");
    expect(stored.revision).toBe(1);

    // A hand-built commit assigning the worker is rejected.
    const preview = await sup.post("/api/schedule/preview", {});
    const forced = await sup.post("/api/schedule/commit", {
      baseRevision: preview.body.baseRevision,
      assignments: [
        {
          id: crypto.randomUUID(),
          taskId: fixtureId(201),
          workerId: fixtureId(2),
          startsAt: minutes(1),
          endsAt: minutes(5),
        },
      ],
    });
    expect(forced.status).toBe(409);
    expect(forced.body.error.code).toBe("ASSIGNMENT_CONFLICT");

    // A second symptom reuses the still-open request instead of resetting it.
    const second = await worker.post("/api/symptom-reports", {
      sessionId: null,
      codes: ["other"],
      note: null,
    });
    expect(second.body.request.id).toBe(request.id);
    expect(second.body.request.status).toBe("acknowledged");

    // Resolution needs an explicit, non-empty note.
    expect(
      (
        await sup.patch(`/api/rest-requests/${request.id}`, {
          action: "resolve",
          revision: 1,
          note: "   ",
        })
      ).status,
    ).toBe(400);
    const resolved = await sup.patch(`/api/rest-requests/${request.id}`, {
      action: "resolve",
      revision: 1,
      note: "Spoke with worker; first aider attended.",
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.request.status).toBe("resolved");
    const audit = await h.repo.list("audit_events");
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["request_acknowledge", "request_resolve"]),
    );
  });
});

test.describe("stale schedule commits", () => {
  test("a commit based on an old revision is rejected and changes nothing", async () => {
    const sup = client(h, await loginAs(h, "supervisor"));
    const worker = client(h, await loginAs(h, "worker", fixtureId(4)));
    const assignmentsBefore = await h.repo.list("task_assignments");
    const preview = await sup.post("/api/schedule/preview", {});
    expect(
      preview.body.assignments.some(
        (a: Assignment) => a.workerId === fixtureId(4),
      ),
    ).toBe(true);
    // A newer worker need arrives after the preview.
    await worker.post("/api/rest-requests", {
      sessionId: null,
      kind: "assistance",
      requestedMinutes: null,
    });
    const stale = await sup.post("/api/schedule/commit", {
      baseRevision: preview.body.baseRevision,
      assignments: preview.body.assignments,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_REVISION");
    expect(await h.repo.list("task_assignments")).toEqual(assignmentsBefore);
  });

  test("two commits from the same preview: first wins, second is stale", async () => {
    const sup = client(h, await loginAs(h, "supervisor"));
    const preview = await sup.post("/api/schedule/preview", {});
    const body = {
      baseRevision: preview.body.baseRevision,
      assignments: preview.body.assignments,
    };
    const [a, b] = await Promise.all([
      sup.post("/api/schedule/commit", body),
      sup.post("/api/schedule/commit", body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  test("a stale request revision cannot be acted upon", async () => {
    const worker = client(h, await loginAs(h, "worker"));
    const sup = client(h, await loginAs(h, "supervisor"));
    const req = (
      await worker.post("/api/symptom-reports", {
        sessionId: null,
        codes: ["dizzy"],
        note: null,
      })
    ).body.request as RestRequest;
    await sup.patch(`/api/rest-requests/${req.id}`, {
      action: "acknowledge",
      revision: 0,
      note: "On my way",
    });
    const stale = await sup.patch(`/api/rest-requests/${req.id}`, {
      action: "resolve",
      revision: 0,
      note: "Resolved from a stale view",
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_REVISION");
    expect((await h.repo.get("rest_requests", req.id))!.status).toBe(
      "acknowledged",
    );
  });
});
