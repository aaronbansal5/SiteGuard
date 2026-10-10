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
