// Full worker → supervisor journey at API level (in-process, no browser).
// The real-time browser version lives in demo.spec.ts.
import { test, expect } from "@playwright/test";
import { fixtureId } from "@siteguard/mock-data";
import {
  SummarySchema,
  ExplanationSchema,
  type Break,
  type RestRequest,
} from "@siteguard/contracts";
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

test("API journey: check-in → summary → rest request → approval → protected coverage → explanations", async () => {
  const workerCookie = await loginAs(h, "worker");
  const supCookie = await loginAs(h, "supervisor");
  const worker = client(h, workerCookie);
  const sup = client(h, supCookie);

  // 1. Existing protected schedule.
  const breaksBefore = await protectedBreaks(h);
  expect(breaksBefore).toHaveLength(6);
  const ownBreaks = (await worker.get("/api/breaks")).body.breaks as Break[];
  expect(ownBreaks.every((b) => b.workerId === fixtureId(1))).toBe(true);

  // 2. Voluntary check-in with explicit sharing, synthetic source.
  const sessionId = await acceleratedMockSession(
    h,
    workerCookie,
    SESSION_BODY({ shareWithSupervisor: true }),
  );
  const done = await worker.post(`/api/sessions/${sessionId}/complete`, {});
  expect(done.status).toBe(200);
  expect(done.body.session.status).toBe("completed");
  const summary = SummarySchema.parse(done.body.summary);
  expect(summary.source).toBe("mock");
  expect(summary.pulse.status).toBe("available");
  expect(summary.breathing.status).toBe("available");
  // Seeded synthetic history: four same-source/context sessions.
  expect(summary.pulseComparison.status).toBe("available");
  expect(summary.pulseComparison.count).toBe(4);

  // 3. Factual explanation without Gemini credentials is deterministic.
  const sessionExplain = await worker.post("/api/insights/explain", {
    kind: "session",
    sessionId,
  });
  expect(sessionExplain.status).toBe(200);
  const se = ExplanationSchema.parse(sessionExplain.body);
  expect(se.origin).toBe("deterministic");
  expect(se.observations.join(" ")).toContain("synthetic sessions");
  expect(JSON.stringify(se)).not.toMatch(/safe to|cleared|diagnos|fatigue/i);

  // 4. History lists the new session with its source.
  const history = await worker.get(`/api/workers/${fixtureId(1)}/history`);
  expect(history.status).toBe(200);
  expect(history.body.sessions[0].id).toBe(sessionId);
  expect(history.body.sessions[0].source).toBe("mock");

  // 5. Worker requests five additional minutes linked to the session.
  const req = await worker.post("/api/rest-requests", {
    sessionId,
    kind: "additional_rest",
    requestedMinutes: 5,
  });
  expect(req.status).toBe(201);
  const request = req.body.request as RestRequest;

  // 6. Supervisor overview reflects the request; no physiology is exposed.
  const overview = await sup.get("/api/supervisor/overview");
  expect(overview.status).toBe(200);
  expect(
    overview.body.requests.some(
      (r: RestRequest) => r.id === request.id && r.status === "pending",
    ),
  ).toBe(true);
  expect(overview.body.sharedSessionIds).toContain(sessionId);
  expect(JSON.stringify(overview.body)).not.toMatch(
    /heartRate|respiratoryRate|initialMedian|readings/,
  );
  // Shared consent lets the supervisor open this one summary.
  expect((await sup.get(`/api/sessions/${sessionId}/summary`)).status).toBe(
    200,
  );

  // 7. Approval creates a separate additional-rest interval after the
  //    current protected break; protected breaks are untouched.
  const myProtected = breaksBefore.find((b) => b.workerId === fixtureId(1))!;
  const restStartsAt = myProtected.endsAt;
  const restEndsAt = new Date(
    Date.parse(restStartsAt) + 5 * 60000,
  ).toISOString();
  const approve = await sup.patch(`/api/rest-requests/${request.id}`, {
    action: "approve",
    revision: request.revision,
    note: "Approved after the protected break.",
    restStartsAt,
    restEndsAt,
  });
  expect(approve.status).toBe(200);
  expect(approve.body.request.status).toBe("approved");
  const additional = (await h.repo.list("breaks")).filter(
    (b) => b.kind === "additional",
  );
  expect(additional).toHaveLength(1);
  expect(additional[0].requestId).toBe(request.id);
  expect(await protectedBreaks(h)).toEqual(breaksBefore);

  // 8. Preview + commit coverage; protected breaks preserved.
  const preview = await sup.post("/api/schedule/preview", {});
  expect(preview.status).toBe(200);
  const commit = await sup.post("/api/schedule/commit", {
    baseRevision: preview.body.baseRevision,
    assignments: preview.body.assignments,
  });
  expect(commit.status).toBe(200);
  expect(await protectedBreaks(h)).toEqual(breaksBefore);
  // No committed assignment overlaps the approved rest of worker 1.
  for (const a of commit.body.assignments)
    if (a.workerId === fixtureId(1))
      expect(
        Date.parse(a.startsAt) < Date.parse(restEndsAt) &&
          Date.parse(restStartsAt) < Date.parse(a.endsAt),
      ).toBe(false);

  // 9. Schedule explanation is factual and names preserved protected breaks.
  const scheduleExplain = await sup.post("/api/insights/explain", {
    kind: "schedule",
    auditEventId: commit.body.auditEventId,
  });
  expect(scheduleExplain.status).toBe(200);
  expect(scheduleExplain.body.origin).toBe("deterministic");
  expect(scheduleExplain.body.observations.join(" ")).toContain(
    "6 protected breaks were preserved",
  );

  // 10. Worker sees the approved request on their own list.
  const mine = await worker.get("/api/rest-requests");
  expect(
    mine.body.requests.find((r: RestRequest) => r.id === request.id).status,
  ).toBe("approved");
});

test("synthetic source is labeled on every reading, summary and history record", async () => {
  const workerCookie = await loginAs(h, "worker");
  const worker = client(h, workerCookie);
  const sessionId = await acceleratedMockSession(h, workerCookie);
  await worker.post(`/api/sessions/${sessionId}/complete`, {});

  const readings = (await worker.get(`/api/sessions/${sessionId}/readings`))
    .body.readings;
  expect(readings.length).toBeGreaterThanOrEqual(60);
  expect(
    readings.every(
      (e: { reading: { source: string } }) => e.reading.source === "mock",
    ),
  ).toBe(true);

  const history = (await worker.get(`/api/workers/${fixtureId(1)}/history`))
    .body.sessions;
  expect(history.length).toBe(5);
  for (const s of history) {
    expect(s.source).toBe("mock");
    expect(s.summary.source).toBe("mock");
  }

  // Health never advertises a real source that is not configured.
  const health = await client(h).get("/api/health");
  expect(health.body.measurementSources).toEqual({
    mock: true,
    presage: false,
  });
});

test("a presage-labeled reading cannot be ingested into a synthetic session", async () => {
  const workerCookie = await loginAs(h, "worker");
  const begin = await client(h, workerCookie).post(
    "/api/sessions",
    SESSION_BODY(),
  );
  const id = begin.body.session.id;
  await h.manager.stop(id);
  const res = await client(h).post(
    `/api/sessions/${id}/readings`,
    {
      readings: [
        {
          sequence: 5000,
          reading: {
            timestamp: new Date().toISOString(),
            heartRateBpm: 90,
            respiratoryRateBrpm: 18,
            quality: "valid",
            source: "presage",
          },
        },
      ],
    },
    { authorization: "Bearer integration-internal-token" },
  );
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe("SOURCE_MISMATCH");
  const stored = await h.repo.readings(id);
  expect(stored.every((e) => e.reading.source === "mock")).toBe(true);
});
