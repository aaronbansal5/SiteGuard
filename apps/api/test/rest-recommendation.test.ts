import { describe, expect, it } from "vitest";
import { fixtureId } from "@siteguard/mock-data";
import { RestRecommendationSchema, type Summary } from "@siteguard/contracts";
import { loadConfig } from "../src/config.js";
import {
  RestRecommender,
  REST_RECOMMENDATION_MAX_MINUTES,
  REST_RECOMMENDATION_MIN_MINUTES,
} from "../src/insights/explain.js";

const summary: Summary = {
  sessionId: fixtureId(700),
  source: "mock",
  context: { workload: null, temperatureC: null },
  durationSeconds: 60,
  pulse: {
    status: "available",
    initialMedian: 80,
    finalMedian: 75,
    delta: -5,
    initialCount: 5,
    finalCount: 5,
  },
  breathing: {
    status: "available",
    initialMedian: 18,
    finalMedian: 16,
    delta: -2,
    initialCount: 5,
    finalCount: 5,
  },
  pulseComparison: {
    status: "insufficient_data",
    count: 0,
    historicalMedianDelta: null,
  },
  breathingComparison: {
    status: "insufficient_data",
    count: 0,
    historicalMedianDelta: null,
  },
  limitations: ["Descriptive observations only."],
};

describe("bounded personal rest recommendation", () => {
  it("uses a deterministic bounded fallback when Gemini is unavailable", async () => {
    const result = await new RestRecommender(
      loadConfig({ geminiKey: undefined, geminiModel: undefined }),
    ).recommend(summary, summary.sessionId, fixtureId(701));
    expect(result.origin).toBe("deterministic");
    expect(result.suggestedMinutes).toBeGreaterThanOrEqual(
      REST_RECOMMENDATION_MIN_MINUTES,
    );
    expect(result.suggestedMinutes).toBeLessThanOrEqual(
      REST_RECOMMENDATION_MAX_MINUTES,
    );
    expect(result).not.toHaveProperty("approved");
    expect(result).not.toHaveProperty("scheduled");
    expect(RestRecommendationSchema.parse(result)).toEqual(result);
  });

  it("rejects an out-of-bounds provider response and falls back", async () => {
    const result = await new RestRecommender(
      loadConfig({ geminiKey: "test", geminiModel: "test" }),
      async () => ({ suggestedMinutes: 120, rationale: ["unsafe"] }),
    ).recommend(summary, summary.sessionId, fixtureId(702));
    expect(result.origin).toBe("deterministic");
    expect(result.suggestedMinutes).toBeLessThanOrEqual(30);
    expect(result.limitations.join(" ")).toMatch(/non-diagnostic|clearance/i);
  });

  it("bases the suggestion on the check-in that was just collected", async () => {
    let sent: Record<string, string[]> = {};
    await new RestRecommender(
      loadConfig({ geminiKey: "test", geminiModel: "test" }),
      async (facts) => {
        sent = facts;
        return { suggestedMinutes: 15, rationale: ["bounded fact"] };
      },
    ).recommend(summary, summary.sessionId, fixtureId(704));
    expect(sent.pulse[0]).toContain("from 80 to 75 bpm");
    expect(sent.breathing[0]).toContain("from 18 to 16 breaths/min");
    expect(sent.measurement[0]).toContain("60 seconds");

    const fallback = await new RestRecommender(
      loadConfig({ geminiKey: undefined, geminiModel: undefined }),
    ).recommend(summary, summary.sessionId, fixtureId(705));
    expect(fallback.rationale.join(" ")).toContain("from 80 to 75 bpm");
  });

  it("sends only summary facts, never readings or camera frames", async () => {
    let sent: unknown;
    await new RestRecommender(
      loadConfig({ geminiKey: "test", geminiModel: "test" }),
      async (facts) => {
        sent = facts;
        return { suggestedMinutes: 15, rationale: ["bounded fact"] };
      },
    ).recommend(summary, summary.sessionId, fixtureId(703));
    expect(JSON.stringify(sent)).not.toMatch(
      /frame|reading|heartRate|respiratory|timestamp/i,
    );
  });
});
