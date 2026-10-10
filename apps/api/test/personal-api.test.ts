import { describe, it, expect, afterEach } from "vitest";
import { fixtureId, mockReading } from "@siteguard/mock-data";
import {
  PersonalInsightsResponseSchema,
  PersonalTrendResponseSchema,
  SelfReportResponseSchema,
  PERSONAL_MODEL as P,
  type Session,
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
type Repo = Awaited<ReturnType<typeof testApp>>["repo"];

/** A completed session with 60 one-second readings of the given source. */
async function completedSession(
  repo: Repo,
  n: number,
  source: Session["source"],
  minutesAgo: number,
  workerId = fixtureId(1),
) {
  const startedAt = new Date(Date.now() - minutesAgo * 60000).toISOString();
  const s: Session = {
    id: fixtureId(7000 + n),
    workerId,
    breakId: fixtureId(100 + Number(workerId.slice(-2))),
    source,
    status: "active",
    startedAt,
    endedAt: null,
    context: { workload: "heavy", temperatureC: 26 },
    consentVersion: "v1",
    shareWithSupervisor: true,
    interruption: null,
  };
  await repo.put("sessions", s);
  await repo.ingest(
    s.id,
    Array.from({ length: 60 }, (_, i) => {
      const e = mockReading(startedAt, i, n, 1 + (n % 3) * 0.1);
      return { ...e, reading: { ...e.reading, source } };
    }),
  );
  const done = {
    ...s,
    status: "completed" as const,
    endedAt: new Date(Date.parse(startedAt) + 60000).toISOString(),
  };
  await repo.put("sessions", done);
  return done;
}

// Terms that must never reach a supervisor response.
const PERSONAL_TERMS = [
  "robustZ",
  "usualMedian",
  "tiredness",
  "selfReport",
  "slopePerSession",
  "looMae",
  "settled_",
  "settling_",
  "within_usual",
];

describe("worker-only personal insights", () => {
  it("returns a schema-valid baseline, trend and synthetic-labeled estimate for the owner", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo);
    const cookie = await login(app);
    await app.inject({
      method: "POST",
      url: `/api/sessions/${s.id}/complete`,
      headers: { cookie },
      payload: {},
    });
    const res = await app.inject({
      url: `/api/sessions/${s.id}/personal-insights`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { insights } = PersonalInsightsResponseSchema.parse(res.json());
    expect(insights.experimental).toBe(true);
    expect(insights.synthetic).toBe(true);
    expect(insights.pulse.baseline.status).toBe("available");
    expect(insights.pulse.baseline.priorCount).toBeGreaterThanOrEqual(
      P.baselineMinSessions,
    );
    expect(insights.pulse.baseline.classification).toBe("within_usual");
    expect(insights.breathing.baseline.status).toBe("available");
    expect(insights.pulse.trend.status).toBe("available");
    // The seed carries clearly synthetic self-reports, and says so.
    expect(insights.tiredness.labeledCount).toBeGreaterThanOrEqual(
      P.selfReportMinSessions,
    );
    expect(insights.tiredness.includesSyntheticReports).toBe(true);
    expect(insights.limitations.join(" ")).toContain("synthetic");
    expect(insights.limitations.join(" ")).toContain("Not medical advice");
    expect(res.body).not.toMatch(/risk|diagnos|safe to|cleared/i);
  });

  it("isolates sources and reports insufficient_data for a new presage history", async () => {
    const { app, repo } = await setup();
    const cookie = await login(app);
    for (let n = 1; n <= P.baselineMinSessions - 1; n++)
      await completedSession(repo, n, "presage", 100 - n * 10);
    const current = await completedSession(repo, 50, "presage", 2);
    const res = await app.inject({
      url: `/api/sessions/${current.id}/personal-insights`,
      headers: { cookie },
    });
    const { insights } = PersonalInsightsResponseSchema.parse(res.json());
    expect(insights.source).toBe("presage");
    expect(insights.synthetic).toBe(false);
    // Only the 4 prior presage sessions count; 12 seeded mock sessions do not.
    expect(insights.pulse.baseline.priorCount).toBe(P.baselineMinSessions - 1);
    expect(insights.pulse.baseline.status).toBe("insufficient_data");
    expect(insights.pulse.baseline.reason).toBe("not_enough_prior_sessions");
    expect(insights.pulse.baseline.classification).toBeNull();
    expect(insights.tiredness.status).toBe("insufficient_data");
    expect(insights.tiredness.reason).toBe("not_enough_labeled_sessions");
    expect(insights.tiredness.includesSyntheticReports).toBe(false);
    expect(insights.limitations.join(" ")).not.toContain("synthetic");

    // One more prior presage session crosses the documented minimum.
    await completedSession(repo, 5, "presage", 50);
    const next = PersonalInsightsResponseSchema.parse(
      (
        await app.inject({
          url: `/api/sessions/${current.id}/personal-insights`,
          headers: { cookie },
        })
      ).json(),
    ).insights;
    expect(next.pulse.baseline.priorCount).toBe(P.baselineMinSessions);
    expect(next.pulse.baseline.status).toBe("available");

    const trend = await app.inject({
      url: `/api/workers/${fixtureId(1)}/personal-trend?source=presage`,
      headers: { cookie },
    });
    const t = PersonalTrendResponseSchema.parse(trend.json()).trend;
    expect(t.source).toBe("presage");
    expect(t.pulse.count).toBe(P.baselineMinSessions + 1);
  });

  it("reports insufficient trend data when a worker has too few sessions", async () => {
    const { app } = await setup();
    const cookie = await login(app);
    const res = await app.inject({
      url: `/api/workers/${fixtureId(1)}/personal-trend?source=presage`,
      headers: { cookie },
    });
    const { trend } = PersonalTrendResponseSchema.parse(res.json());
    expect(trend.pulse.status).toBe("insufficient_data");
    expect(trend.pulse.reason).toBe("not_enough_sessions");
    expect(trend.pulse.count).toBe(0);
    const mock = PersonalTrendResponseSchema.parse(
      (
        await app.inject({
          url: `/api/workers/${fixtureId(1)}/personal-trend?source=mock`,
          headers: { cookie },
        })
      ).json(),
    ).trend;
    expect(mock.pulse.status).toBe("available");
    expect(mock.synthetic).toBe(true);
    expect(
      (
        await app.inject({
          url: `/api/workers/${fixtureId(1)}/personal-trend`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("stores a voluntary self-report only for the owner's completed session", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo);
    const cookie = await login(app);
    const rate = (tiredness: unknown, c = cookie) =>
      app.inject({
        method: "POST",
        url: `/api/sessions/${s.id}/self-report`,
        headers: { cookie: c },
        payload: { tiredness },
      });
    expect((await rate(3)).statusCode).toBe(409);
    await app.inject({
      method: "POST",
      url: `/api/sessions/${s.id}/complete`,
      headers: { cookie },
      payload: {},
    });
    for (const bad of [0, 6, 2.5, "4"])
      expect((await rate(bad)).statusCode).toBe(400);
    const other = await login(app, "worker", fixtureId(2));
    expect((await rate(2, other)).statusCode).toBe(403);
    const ok = await rate(4);
    expect(ok.statusCode).toBe(200);
    const saved = SelfReportResponseSchema.parse(ok.json()).selfReport!;
    expect(saved).toMatchObject({ tiredness: 4, origin: "worker" });
    const insights = PersonalInsightsResponseSchema.parse(
      (
        await app.inject({
          url: `/api/sessions/${s.id}/personal-insights`,
          headers: { cookie },
        })
      ).json(),
    ).insights;
    expect(insights.selfReport?.tiredness).toBe(4);
    // The current session's own rating is never used to estimate itself.
    expect(insights.tiredness.labeledCount).toBe(
      (await repo.selfReports(fixtureId(1))).length - 1,
    );
    expect(SelfReportResponseSchema.parse((await rate(null)).json())).toEqual({
      selfReport: null,
    });
    expect(
      (await repo.selfReports(fixtureId(1))).some((r) => r.sessionId === s.id),
    ).toBe(false);
  });

  it("never exposes personal insights or self-reports to supervisors or other workers", async () => {
    const { app, repo } = await setup();
    const s = await populatedSession(repo, true);
    const wc = await login(app);
    await app.inject({
      method: "POST",
      url: `/api/sessions/${s.id}/complete`,
      headers: { cookie: wc },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/sessions/${s.id}/self-report`,
      headers: { cookie: wc },
      payload: { tiredness: 5 },
    });
    // A request linked to the shared session puts it in the overview.
    await app.inject({
      method: "POST",
      url: "/api/rest-requests",
      headers: { cookie: wc },
      payload: {
        sessionId: s.id,
        kind: "additional_rest",
        requestedMinutes: 5,
      },
    });
    const sc = await login(app, "supervisor");
    for (const url of [
      `/api/sessions/${s.id}/personal-insights`,
      `/api/workers/${fixtureId(1)}/personal-trend?source=mock`,
    ])
      expect(
        (await app.inject({ url, headers: { cookie: sc } })).statusCode,
      ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/sessions/${s.id}/self-report`,
          headers: { cookie: sc },
          payload: { tiredness: 1 },
        })
      ).statusCode,
    ).toBe(403);
    const other = await login(app, "worker", fixtureId(2));
    for (const url of [
      `/api/sessions/${s.id}/personal-insights`,
      `/api/workers/${fixtureId(1)}/personal-trend?source=mock`,
    ])
      expect(
        (await app.inject({ url, headers: { cookie: other } })).statusCode,
      ).toBe(403);

    // Everything a supervisor can legitimately read stays free of it, even
    // for a session the worker chose to share.
    const supervisorReads = [
      await app.inject({
        url: "/api/supervisor/overview",
        headers: { cookie: sc },
      }),
      await app.inject({
        url: `/api/sessions/${s.id}`,
        headers: { cookie: sc },
      }),
      await app.inject({
        url: `/api/sessions/${s.id}/summary`,
        headers: { cookie: sc },
      }),
      await app.inject({ url: "/api/rest-requests", headers: { cookie: sc } }),
      await app.inject({
        method: "POST",
        url: "/api/insights/explain",
        headers: { cookie: sc },
        payload: { kind: "session", sessionId: s.id },
      }),
    ];
    const overview = supervisorReads[0].json();
    expect(overview.sharedSessionIds).toContain(s.id);
    for (const res of supervisorReads) {
      expect(res.statusCode).toBe(200);
      for (const term of PERSONAL_TERMS) expect(res.body).not.toContain(term);
      expect(res.body.toLowerCase()).not.toContain("tired");
    }
  });
});
