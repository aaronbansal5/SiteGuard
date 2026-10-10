import { describe, it, expect } from "vitest";
import { PERSONAL_MODEL as P } from "@siteguard/contracts";
import {
  median,
  mad,
  robustZ,
  theilSen,
  solve,
  ridgeFit,
  ridgePredict,
  looMae,
} from "../src/domain/personal-math.js";
import {
  baseline,
  trend,
  tirednessEstimate,
  type Labeled,
  type SessionFeatures,
} from "../src/domain/personal.js";

describe("personal statistics", () => {
  it("computes median and MAD robustly", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
    expect(mad([])).toBeNull();
    expect(mad([7, 7, 7])).toBe(0);
  });
  it("computes a robust z-score with a scale floor", () => {
    const r = robustZ(10, [1, 2, 3, 4, 5], 0.1)!;
    expect(r.median).toBe(3);
    expect(r.mad).toBe(1);
    expect(r.scale).toBeCloseTo(1.4826);
    expect(r.z).toBeCloseTo(7 / 1.4826);
    // Identical history: MAD=0 so the floor prevents division by zero.
    expect(robustZ(5, [4, 4, 4], 0.5)!.z).toBe(2);
    expect(() => robustZ(1, [1], 0)).toThrow();
  });
  it("estimates Theil–Sen slope and ignores an outlier", () => {
    expect(theilSen([0, 1, 2, 3], [1, 3, 5, 7])).toBe(2);
    expect(theilSen([0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 100, 5])).toBe(1);
    expect(theilSen([1, 1], [2, 3])).toBeNull();
  });
  it("solves linear systems with pivoting", () => {
    const x = solve(
      [
        [0, 2],
        [3, 1],
      ],
      [4, 5],
    );
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(2);
    expect(() =>
      solve(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow("Singular");
  });
  it("matches the ridge closed form on standardized features", () => {
    // y = 2 + 3 * z exactly, one feature with mean 0 and population sd 1.
    const X = [[-1], [1], [-1], [1]],
      y = [-1, 5, -1, 5];
    const lambda = 2;
    const m = ridgeFit(X, y, lambda);
    // beta = Z'y_c / (Z'Z + lambda) = (4*3) / (4 + 2) = 2
    expect(m.intercept).toBe(2);
    expect(m.coefficients[0]).toBeCloseTo(2);
    expect(ridgePredict(m, [1])).toBeCloseTo(4);
    // Shrinks toward zero as lambda grows; recovers OLS as lambda -> 0.
    expect(ridgeFit(X, y, 1e-9).coefficients[0]).toBeCloseTo(3);
    expect(ridgeFit(X, y, 1e6).coefficients[0]).toBeCloseTo(0, 3);
    // A constant feature gets a zero coefficient instead of a singular solve.
    const c = ridgeFit(
      [
        [1, 5],
        [2, 5],
        [3, 5],
      ],
      [1, 2, 3],
      1,
    );
    expect(c.coefficients[1]).toBe(0);
  });
  it("computes leave-one-out MAE", () => {
    const y = [1, 2, 3, 6];
    // Mean of the others: 11/3, 10/3, 3, 2 → errors 8/3, 4/3, 0, 4.
    const mae = looMae(
      4,
      (train) => train.reduce((s, i) => s + y[i], 0) / train.length,
      (i) => y[i],
    );
    expect(mae).toBeCloseTo((8 / 3 + 4 / 3 + 0 + 4) / 4);
    expect(() =>
      looMae(
        1,
        () => 0,
        () => 0,
      ),
    ).toThrow();
  });
});

describe("personal recovery baseline and trend", () => {
  const usual = [-14, -13, -15, -14, -12, -16];
  it("returns insufficient_data until enough prior sessions exist", () => {
    const b = baseline("pulse", -14, usual.slice(0, P.baselineMinSessions - 1));
    expect(b.status).toBe("insufficient_data");
    expect(b.reason).toBe("not_enough_prior_sessions");
    expect(b.classification).toBeNull();
    expect(baseline("pulse", null, usual).reason).toBe(
      "current_session_unavailable",
    );
  });
  it("classifies against the worker's own usual range", () => {
    expect(baseline("pulse", -14, usual).classification).toBe("within_usual");
    expect(baseline("pulse", -25, usual).classification).toBe("settled_more");
    expect(baseline("pulse", -4, usual).classification).toBe("settled_less");
    const b = baseline("pulse", -25, usual);
    expect(b.usualMedian).toBe(-14);
    expect(b.robustZ!).toBeLessThan(-P.zThreshold);
  });
  it("describes a Theil–Sen trend only with enough sessions", () => {
    expect(trend("pulse", [-14, -14, -14]).status).toBe("insufficient_data");
    expect(trend("pulse", [-14, -14, -15, -14, -14]).direction).toBe("steady");
    expect(trend("pulse", [-8, -10, -12, -14, -16, -18]).direction).toBe(
      "settling_more",
    );
    const t = trend("breathing", [-6, -5, -4, -3, -2]);
    expect(t.direction).toBe("settling_less");
    expect(t.slopePerSession).toBe(1);
  });
});

describe("self-reported tiredness regression", () => {
  const f = (i: number, pulse: number, breathing: number): SessionFeatures => ({
    sessionId: String(i),
    startedAt: new Date(i * 1000).toISOString(),
    pulse,
    breathing,
  });
  // pulse in {-20,-17,-14,-11,-8} maps to ratings 1..5.
  const linear = (n: number): Labeled[] =>
    Array.from({ length: n }, (_, i) => {
      const pulse = -20 + (i % 5) * 3;
      return {
        features: f(i, pulse, pulse / 3),
        tiredness: 1 + (i % 5),
        origin: "worker" as const,
      };
    });
  it("needs M labeled sessions", () => {
    const e = tirednessEstimate(
      f(99, -14, -4),
      linear(P.selfReportMinSessions - 1),
    );
    expect(e.status).toBe("insufficient_data");
    expect(e.reason).toBe("not_enough_labeled_sessions");
    expect(e.estimate).toBeNull();
  });
  it("refuses when ratings never vary or features are missing", () => {
    const flat = linear(10).map((l) => ({ ...l, tiredness: 3 }));
    expect(tirednessEstimate(f(99, -14, -4), flat).reason).toBe(
      "ratings_do_not_vary",
    );
    expect(
      tirednessEstimate({ ...f(99, -14, -4), pulse: null }, linear(10)).reason,
    ).toBe("current_session_unavailable");
  });
  it("refuses when leave-one-out error is too large", () => {
    const noisy = linear(12).map((l, i) => ({
      ...l,
      tiredness: [1, 5, 2, 4, 1, 5, 3, 1, 5, 2, 4, 5][i],
    }));
    const e = tirednessEstimate(f(99, -14, -4), noisy);
    expect(e.status).toBe("insufficient_data");
    expect(e.reason).toBe("estimate_not_reliable");
    expect(e.looMae).toBeGreaterThan(0);
  });
  it("estimates a range with its LOO error when the fit is reliable", () => {
    const data = linear(15);
    const e = tirednessEstimate(f(99, -8, -8 / 3), data);
    expect(e.status).toBe("available");
    expect(e.looMae!).toBeLessThanOrEqual(P.maeBound);
    expect(e.estimate!).toBeGreaterThan(4);
    expect(e.rangeLow!).toBeLessThanOrEqual(e.rangeHigh!);
    expect(e.rangeHigh!).toBeLessThanOrEqual(5);
    expect(e.includesSyntheticReports).toBe(false);
    const synthetic = data.map((l) => ({ ...l, origin: "synthetic" as const }));
    expect(
      tirednessEstimate(f(99, -8, -8 / 3), synthetic).includesSyntheticReports,
    ).toBe(true);
  });
});
