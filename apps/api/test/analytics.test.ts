import { describe, it, expect } from "vitest";
import { fixtures, mockReading, fixtureId } from "@siteguard/mock-data";
import { summarize, compare, median } from "../src/domain/analytics.js";
const f = fixtures(Date.parse("2026-10-10T15:00:00.000Z")),
  s = f.sessions[0],
  readings = f.readings
    .filter((x) => x.sessionId === s.id)
    .map((x) => x.envelope);
describe("descriptive analytics", () => {
  it("uses medians and independent metric changes", () => {
    const v = summarize(s, readings);
    expect(v.pulse.status).toBe("available");
    expect(v.breathing.status).toBe("available");
    expect(v.pulse.delta).toBeLessThan(0);
    expect(v.pulse.initialCount).toBe(15);
    expect(median([3, 1, 2, 200])).toBe(2.5);
  });
  it("rejects insufficient duration and overlapping windows", () => {
    const short = {
      ...s,
      endedAt: new Date(Date.parse(s.startedAt) + 20000).toISOString(),
    };
    expect(summarize(short, readings).pulse.status).toBe("insufficient_data");
  });
  it("filters invalid and unknown numeric values", () => {
    const invalid = readings.map((e) => ({
      ...e,
      reading: { ...e.reading, quality: "unknown" as const },
    }));
    expect(summarize(s, invalid).pulse.initialCount).toBe(0);
    expect(summarize(s, invalid).pulse.status).toBe("insufficient_data");
  });
  it("calculates breathing when pulse is missing", () => {
    const v = summarize(
      s,
      readings.map((e) => ({
        ...e,
        reading: { ...e.reading, heartRateBpm: null },
      })),
    );
    expect(v.pulse.status).toBe("insufficient_data");
    expect(v.breathing.status).toBe("available");
  });
  it("requires five-second span in both windows", () => {
    const burst = [0, 1, 2, 3, 4, 56, 57, 58, 59, 60].map((n) =>
      mockReading(s.startedAt, n),
    );
    expect(summarize(s, burst).pulse.status).toBe("insufficient_data");
  });
  it("requires at least three comparable prior sessions", () => {
    const current = {
      ...s,
      id: fixtureId(9999),
      startedAt: "2026-10-10T15:00:00.000Z",
      endedAt: "2026-10-10T15:01:00.000Z",
    };
    const summary = summarize(
      current,
      Array.from({ length: 60 }, (_, n) => mockReading(current.startedAt, n)),
    );
    const prior = f.sessions
      .filter((x) => x.workerId === s.workerId)
      .map((session) => ({
        session,
        summary: summarize(
          session,
          f.readings
            .filter((x) => x.sessionId === session.id)
            .map((x) => x.envelope),
        ),
      }));
    expect(compare(current, summary, prior).pulseComparison.count).toBe(4);
    expect(
      compare(current, summary, prior.slice(0, 2)).pulseComparison.status,
    ).toBe("insufficient_data");
    expect(
      compare({ ...current, source: "presage" }, summary, prior).pulseComparison
        .count,
    ).toBe(0);
    expect(
      compare(
        { ...current, context: { ...current.context, temperatureC: null } },
        summary,
        prior,
      ).pulseComparison.status,
    ).toBe("insufficient_data");
    expect(
      compare(
        { ...current, context: { ...current.context, temperatureC: 35 } },
        summary,
        prior,
      ).pulseComparison.count,
    ).toBe(0);
  });
  it("does not compare sessions that completed after the current session started", () => {
    const v = summarize(s, readings);
    expect(
      compare(s, v, [
        {
          session: {
            ...s,
            id: fixtureId(988),
            startedAt: s.startedAt,
            endedAt: new Date(Date.parse(s.startedAt) + 10000).toISOString(),
          },
          summary: v,
        },
      ]).pulseComparison.count,
    ).toBe(0);
  });
});
describe("warm-up-aware initial windows (real Presage)", () => {
  const startedAt = "2026-10-10T15:00:00.000Z";
  const session = (seconds: number) => ({
    ...s,
    source: "presage" as const,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + seconds * 1000).toISOString(),
  });
  // One reading per second; validity/nulls decided per second and metric.
  const stream = (seconds: number, pulseFrom: number, breathingFrom: number) =>
    Array.from({ length: seconds + 1 }, (_, n) => {
      const e = mockReading(startedAt, n);
      return {
        ...e,
        reading: {
          ...e.reading,
          source: "presage" as const,
          quality:
            n < Math.min(pulseFrom, breathingFrom)
              ? ("invalid" as const)
              : ("valid" as const),
          heartRateBpm: n < pulseFrom ? null : 100 - n * 0.1,
          respiratoryRateBrpm: n < breathingFrom ? null : 20 - n * 0.05,
        },
      };
    });
  it("starts the initial window at the first valid reading after 30 s of warm-up", () => {
    const v = summarize(session(90), stream(90, 30, 30));
    for (const m of [v.pulse, v.breathing]) {
      expect(m.status).toBe("available");
      expect(m.initialCount).toBe(15); // seconds 30..44
      expect(m.finalCount).toBe(15); // seconds 76..90
    }
    expect(v.pulse.initialMedian).toBeCloseTo(100 - 37 * 0.1);
    expect(v.breathing.initialMedian).toBeCloseTo(20 - 37 * 0.05);
  });
  it("uses a separate initial window per metric when pulse warms up earlier", () => {
    const v = summarize(session(90), stream(90, 12, 40));
    expect(v.pulse.status).toBe("available");
    expect(v.breathing.status).toBe("available");
    expect(v.pulse.initialMedian).toBeCloseTo(100 - 19 * 0.1); // 12..26
    expect(v.breathing.initialMedian).toBeCloseTo(20 - 47 * 0.05); // 40..54
    expect(v.pulse.initialCount).toBe(15);
    expect(v.breathing.initialCount).toBe(15);
  });
  it("returns insufficient_data when too little valid data follows warm-up", () => {
    // Breathing first valid at 40 s of a 60 s session: only 20 s remain,
    // under the 45 s duration rule measured from the first valid reading.
    const v = summarize(session(60), stream(60, 12, 40));
    expect(v.pulse.status).toBe("available");
    expect(v.breathing.status).toBe("insufficient_data");
    expect(v.breathing.delta).toBeNull();
    // Nothing valid at all.
    const none = stream(90, 999, 999);
    const w = summarize(session(90), none);
    expect(w.pulse.status).toBe("insufficient_data");
    expect(w.breathing.status).toBe("insufficient_data");
    expect(w.pulse.initialCount).toBe(0);
    // Exactly at the boundary: 45 s from first valid reading is enough,
    // 44 s is not.
    expect(summarize(session(75), stream(75, 30, 30)).pulse.status).toBe(
      "available",
    );
    expect(summarize(session(74), stream(74, 30, 30)).pulse.status).toBe(
      "insufficient_data",
    );
  });
  it("anchors on the first valid reading even when it is isolated", () => {
    // A single valid reading before the warm-up gap anchors the window there;
    // the initial window then lacks five readings and the metric is
    // insufficient rather than silently shifted.
    const r = stream(90, 30, 30).map((e) =>
      e.sequence === 5
        ? {
            ...e,
            reading: {
              ...e.reading,
              quality: "valid" as const,
              heartRateBpm: 120,
            },
          }
        : e,
    );
    const v = summarize(session(90), r);
    expect(v.pulse.status).toBe("insufficient_data");
    expect(v.pulse.initialCount).toBe(1);
  });
});
