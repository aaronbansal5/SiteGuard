import {
  SummarySchema,
  type Summary,
  type MetricSummary,
  type Comparison,
} from "@siteguard/contracts";

export const MODEL_VERSION = "rest-support-descriptive-v1";
export const EXPERIMENTAL_DISCLAIMER =
  "Experimental research estimate — not medical advice or work clearance. " +
  "This untrained descriptive rule has no validated accuracy. " +
  "The worker chooses whether to request rest; scheduled breaks remain protected.";

export interface MetricFeatures {
  initial: number;
  final: number;
  delta: number;
  fractionalChange: number;
  historicalDelta: number | null;
  differenceFromHistory: number | null;
  priorCount: number;
}

export interface RestSupportFeatures {
  source: Summary["source"] | null;
  synthetic: boolean | null;
  durationSeconds: number | null;
  pulse: MetricFeatures | null;
  breathing: MetricFeatures | null;
  issues: string[];
}

export interface RestSupportResult {
  signal:
    | "consider_additional_rest"
    | "no_additional_signal"
    | "insufficient_evidence";
  /** No probability can be calibrated without labeled validation data. */
  confidence: null;
  uncertainty: {
    level: "unquantified";
    reasons: string[];
  };
  evidence: RestSupportFeatures;
  modelVersion: string;
  experimental: true;
  disclaimer: string;
}

function extractMetric(
  metric: MetricSummary,
  comparison: Comparison,
  name: string,
  issues: string[],
): MetricFeatures | null {
  const { initialMedian: initial, finalMedian: final, delta } = metric;
  if (
    metric.status !== "available" ||
    initial === null ||
    final === null ||
    delta === null ||
    !Number.isFinite(initial) ||
    !Number.isFinite(final) ||
    !Number.isFinite(delta) ||
    initial <= 0 ||
    final <= 0 ||
    metric.initialCount < 5 ||
    metric.finalCount < 5 ||
    Math.abs(final - initial - delta) > 1e-9 * Math.max(1, Math.abs(delta)) ||
    !Number.isFinite(delta / initial)
  ) {
    issues.push(`${name}: unavailable or inconsistent initial/final windows.`);
    return null;
  }
  const history = comparison.historicalMedianDelta;
  const usableHistory =
    comparison.status === "available" &&
    comparison.count >= 3 &&
    history !== null &&
    Number.isFinite(history) &&
    Number.isFinite(delta - history);
  if (!usableHistory)
    issues.push(`${name}: fewer than three usable comparable prior sessions.`);
  return {
    initial,
    final,
    delta,
    fractionalChange: delta / initial,
    historicalDelta: usableHistory ? history : null,
    differenceFromHistory: usableHistory ? delta - history! : null,
    priorCount: usableHistory ? comparison.count : 0,
  };
}

/**
 * Pure, bounded-size extraction from the canonical Summary; no IDs, footage,
 * persistence, downloads or external inference. Window validity and same-worker,
 * same-source/context history selection belong to the existing analytics layer.
 * Summary alone cannot independently verify those provenance guarantees.
 */
export function extractRestSupportFeatures(
  summary: Summary,
): RestSupportFeatures {
  const parsed = SummarySchema.safeParse(summary);
  if (!parsed.success) {
    return {
      source: null,
      synthetic: null,
      durationSeconds: null,
      pulse: null,
      breathing: null,
      issues: ["Invalid Summary shape."],
    };
  }
  const s = parsed.data;
  const issues: string[] = [];
  const durationValid =
    Number.isFinite(s.durationSeconds) && s.durationSeconds >= 45;
  if (!durationValid)
    issues.push(
      "Session duration does not support separate initial/final windows.",
    );
  // Context questions are intentionally optional in the app. Missing
  // workload/temperature is retained as uncertainty, not treated as a hard
  // failure, so the model can still report a bounded descriptive signal.
  if (s.context.workload === null || s.context.temperatureC === null) {
    issues.push(
      "Workload/environment context was not recorded; uncertainty is higher.",
    );
  }
  return {
    source: s.source,
    synthetic: s.source === "mock",
    durationSeconds:
      Number.isFinite(s.durationSeconds) && s.durationSeconds >= 0
        ? s.durationSeconds
        : null,
    pulse: extractMetric(s.pulse, s.pulseComparison, "Pulse", issues),
    breathing: extractMetric(
      s.breathing,
      s.breathingComparison,
      "Breathing",
      issues,
    ),
    issues,
  };
}

/**
 * Untrained research rule: both changes exceeding negative historical deltas
 * supply a prompt to consider rest. Both decreasing at least as much as history
 * supply no additional signal. Mixed/unsupported evidence abstains. No clinical
 * thresholds, fatigue prediction, rest duration, or fitness decision is inferred.
 */
export function evaluateRestSupport(summary: Summary): RestSupportResult {
  const evidence = extractRestSupportFeatures(summary);
  const reasons = [
    "Validated confidence is unavailable: this rule has no labeled validation dataset.",
    "Summary medians omit sensor error, within-window variation, symptoms and causal factors.",
    "Historical source/context eligibility is supplied by upstream analytics.",
    ...evidence.issues,
  ];
  if (evidence.synthetic)
    reasons.push("Synthetic measurements: demonstration evidence only.");
  let signal: RestSupportResult["signal"] = "insufficient_evidence";
  const metrics = [evidence.pulse, evidence.breathing];
  const metricIssues = evidence.issues.filter(
    (issue) => !issue.startsWith("Workload/environment context"),
  );
  if (metricIssues.length === 0 && metrics.every((m) => m !== null)) {
    const comparable = metrics as MetricFeatures[];
    if (
      comparable.every(
        (m) => m.historicalDelta! < 0 && m.differenceFromHistory! > 0,
      )
    ) {
      signal = "consider_additional_rest";
      reasons.push(
        "Both measured changes decreased less than their historical median changes.",
      );
    } else if (
      comparable.every((m) => m.delta < 0 && m.differenceFromHistory! <= 0)
    ) {
      signal = "no_additional_signal";
      reasons.push(
        "Both measured changes decreased at least as much as their historical median changes. This does not establish rest needs or readiness.",
      );
    } else {
      reasons.push(
        "The two metrics do not support a consistent directional comparison.",
      );
    }
  }
  return {
    signal,
    confidence: null,
    uncertainty: { level: "unquantified", reasons },
    evidence,
    modelVersion: MODEL_VERSION,
    experimental: true,
    disclaimer: EXPERIMENTAL_DISCLAIMER,
  };
}
