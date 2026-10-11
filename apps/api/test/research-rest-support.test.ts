import { describe, expect, it } from "vitest";
import type { Summary } from "@siteguard/contracts";
import {
  evaluateRestSupport,
  extractRestSupportFeatures,
  MODEL_VERSION,
} from "../src/research/rest-support.js";

function summary(): Summary {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    source: "presage",
    context: { workload: "moderate", temperatureC: 24 },
    durationSeconds: 90,
    pulse: {
      status: "available",
      initialMedian: 100,
      finalMedian: 95,
      delta: -5,
      initialCount: 15,
      finalCount: 15,
    },
    breathing: {
      status: "available",
      initialMedian: 20,
      finalMedian: 19,
      delta: -1,
      initialCount: 15,
      finalCount: 15,
    },
    pulseComparison: {
      status: "available",
      count: 3,
      historicalMedianDelta: -10,
    },
    breathingComparison: {
      status: "available",
      count: 3,
      historicalMedianDelta: -2,
    },
    limitations: [],
  };
}

describe("local research rest support", () => {
  it("accepts the canonical rounded delta from full-precision Presage medians", () => {
    const s = summary();
    s.pulse.initialMedian = 57.150634765625;
    s.pulse.finalMedian = 62.761505126953125;
    s.pulse.delta = 5.61;
    expect(extractRestSupportFeatures(s).pulse).toMatchObject({
      initial: 57.150634765625,
      final: 62.761505126953125,
      delta: 5.61,
    });
    s.pulse.delta = 5.63;
    expect(extractRestSupportFeatures(s).pulse).toBeNull();
  });
  it("extracts descriptive features without identifiers or mutating the summary", () => {
    const s = summary();
    const before = structuredClone(s);
    const f = extractRestSupportFeatures(s);
    expect(f.pulse).toEqual({
      initial: 100,
      final: 95,
      delta: -5,
      fractionalChange: -0.05,
      historicalDelta: -10,
      differenceFromHistory: 5,
      priorCount: 3,
    });
    expect(f.breathing?.differenceFromHistory).toBe(1);
    expect(f).not.toHaveProperty("sessionId");
    expect(f.issues).toEqual([]);
    expect(s).toEqual(before);
  });

  it("reports concordant less-decreasing changes with explicit uncalibrated uncertainty", () => {
    const r = evaluateRestSupport(summary());
    expect(r.signal).toBe("consider_additional_rest");
    expect(r.confidence).toBeNull();
    expect(r.uncertainty.level).toBe("unquantified");
    expect(r.uncertainty.reasons.join(" ")).toContain(
      "no labeled validation dataset",
    );
    expect(r.modelVersion).toBe(MODEL_VERSION);
    expect(r.experimental).toBe(true);
    expect(r.disclaimer).toContain("Experimental research estimate");
    expect(r.disclaimer).toContain("not medical advice or work clearance");
  });

  it("returns no additional signal when both negative changes equal history, without work clearance", () => {
    const s = summary();
    s.pulseComparison.historicalMedianDelta = -5;
    s.breathingComparison.historicalMedianDelta = -1;
    const r = evaluateRestSupport(s);
    expect(r.signal).toBe("no_additional_signal");
    expect(r.confidence).toBeNull();
    expect(r.disclaimer).toContain("scheduled breaks remain protected");
  });

  it("abstains when the metrics disagree or historical changes do not decrease", () => {
    const s = summary();
    s.breathingComparison.historicalMedianDelta = -0.5;
    expect(evaluateRestSupport(s).signal).toBe("insufficient_evidence");
    s.pulseComparison.historicalMedianDelta = 0;
    s.breathingComparison.historicalMedianDelta = 0;
    s.pulse.finalMedian = 102;
    s.pulse.delta = 2;
    expect(evaluateRestSupport(s).signal).toBe("insufficient_evidence");
  });

  it.each([
    "status",
    "count",
    "null",
    "duration",
    "context",
    "windows",
    "inconsistent",
    "nonfinite",
  ])("abstains with insufficient or invalid %s evidence", (kind) => {
    const s = summary();
    if (kind === "status") s.pulse.status = "insufficient_data";
    if (kind === "count") s.pulseComparison.count = 2;
    if (kind === "null") s.breathing.finalMedian = null;
    if (kind === "duration") s.durationSeconds = 44;
    if (kind === "context") s.context.temperatureC = null;
    if (kind === "windows") s.pulse.initialCount = 4;
    if (kind === "inconsistent") s.pulse.delta = 2;
    if (kind === "nonfinite") s.pulse.initialMedian = Infinity;
    const r = evaluateRestSupport(s);
    if (kind === "context") {
      expect(r.signal).not.toBe("insufficient_evidence");
      expect(r.uncertainty.reasons.join(" ")).toContain(
        "Workload/environment context was not recorded",
      );
    } else {
      expect(r.signal).toBe("insufficient_evidence");
    }
    expect(r.evidence.issues.length).toBeGreaterThan(0);
    expect(r.confidence).toBeNull();
    expect(JSON.stringify(r)).not.toContain("Infinity");
  });

  it("labels synthetic evidence and remains deterministic", () => {
    const s = summary();
    s.source = "mock";
    const r = evaluateRestSupport(s);
    expect(r.evidence.synthetic).toBe(true);
    expect(r.uncertainty.reasons.join(" ")).toContain("Synthetic measurements");
    expect(evaluateRestSupport(s)).toEqual(r);
  });

  it("rejects malformed runtime inputs without throwing", () => {
    const r = evaluateRestSupport({} as Summary);
    expect(r.signal).toBe("insufficient_evidence");
    expect(r.evidence.source).toBeNull();
    expect(r.evidence.issues).toEqual(["Invalid Summary shape."]);
  });
});
