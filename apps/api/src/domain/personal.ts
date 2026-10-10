// Worker-only experimental personal insights. See docs/RECOVERY_MODEL.md.
// Descriptive comparisons with the worker's own past sessions; never a
// diagnosis, risk/fatigue score, or statement about fitness for work.
import {
  PERSONAL_MODEL as P,
  type Baseline,
  type Trend,
  type TirednessEstimate,
  type PersonalInsights,
  type PersonalTrend,
  type SelfReport,
  type Session,
} from "@siteguard/contracts";
import type { Repository } from "../db/repository.js";
import { summarize } from "./analytics.js";
import {
  mad,
  robustZ,
  theilSen,
  ridgeFit,
  ridgePredict,
  looMae,
  clamp,
} from "./personal-math.js";
import { fail } from "../errors.js";

export type Metric = "pulse" | "breathing";
export interface SessionFeatures {
  sessionId: string;
  startedAt: string;
  pulse: number | null;
  breathing: number | null;
}
export interface Labeled {
  features: SessionFeatures;
  tiredness: number;
  origin: SelfReport["origin"];
}

const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Robust baseline from prior values (most recent first). */
export function baseline(
  metric: Metric,
  current: number | null,
  prior: number[],
): Baseline {
  const used = prior.slice(0, P.baselineMaxSessions);
  const empty: Baseline = {
    status: "insufficient_data",
    reason: null,
    priorCount: used.length,
    requiredCount: P.baselineMinSessions,
    current,
    usualMedian: null,
    usualMad: null,
    robustZ: null,
    classification: null,
  };
  if (current === null)
    return { ...empty, reason: "current_session_unavailable" };
  if (used.length < P.baselineMinSessions)
    return { ...empty, reason: "not_enough_prior_sessions" };
  const r = robustZ(current, used, P.minScale[metric], P.madConsistency)!;
  return {
    ...empty,
    status: "available",
    usualMedian: round(r.median),
    usualMad: round(r.mad),
    robustZ: round(r.z),
    // delta = final - initial; a more negative change means the reading
    // came down further during the break than usual.
    classification:
      Math.abs(r.z) <= P.zThreshold
        ? "within_usual"
        : r.z < 0
          ? "settled_more"
          : "settled_less",
  };
}

/** Theil–Sen trend over chronological values (oldest first). */
export function trend(metric: Metric, chronological: number[]): Trend {
  const values = chronological.slice(-P.trendWindow);
  const empty: Trend = {
    status: "insufficient_data",
    reason: "not_enough_sessions",
    count: values.length,
    requiredCount: P.trendMinSessions,
    slopePerSession: null,
    direction: null,
  };
  if (values.length < P.trendMinSessions) return empty;
  const slope = theilSen(
    values.map((_, i) => i),
    values,
  )!;
  const scale = Math.max(P.madConsistency * mad(values)!, P.minScale[metric]);
  const total = slope * (values.length - 1);
  return {
    ...empty,
    status: "available",
    reason: null,
    slopePerSession: round(slope, 3),
    direction:
      Math.abs(total) < scale
        ? "steady"
        : slope < 0
          ? "settling_more"
          : "settling_less",
  };
}

const featureVector = (f: SessionFeatures) =>
  f.pulse === null || f.breathing === null ? null : [f.pulse, f.breathing];

/** Per-worker ridge regression from session features to self-reports. */
export function tirednessEstimate(
  current: SessionFeatures,
  labeledRecentFirst: Labeled[],
): TirednessEstimate {
  const labeled = labeledRecentFirst
    .filter((l) => featureVector(l.features) !== null)
    .slice(0, P.selfReportMaxSessions);
  const empty: TirednessEstimate = {
    status: "insufficient_data",
    reason: null,
    labeledCount: labeled.length,
    requiredCount: P.selfReportMinSessions,
    looMae: null,
    maeBound: P.maeBound,
    estimate: null,
    rangeLow: null,
    rangeHigh: null,
    includesSyntheticReports: labeled.some((l) => l.origin === "synthetic"),
  };
  if (labeled.length < P.selfReportMinSessions)
    return { ...empty, reason: "not_enough_labeled_sessions" };
  const x = featureVector(current);
  if (!x) return { ...empty, reason: "current_session_unavailable" };
  const X = labeled.map((l) => featureVector(l.features)!),
    y = labeled.map((l) => l.tiredness);
  if (new Set(y).size < 2) return { ...empty, reason: "ratings_do_not_vary" };
  const predict = (train: number[], row: number[]) =>
    clamp(
      ridgePredict(
        ridgeFit(
          train.map((i) => X[i]),
          train.map((i) => y[i]),
          P.ridgeLambda,
        ),
        row,
      ),
      1,
      5,
    );
  const mae = looMae(
    y.length,
    (train, test) => predict(train, X[test]),
    (i) => y[i],
  );
  // Honesty check: the model must beat simply predicting the worker's own
  // average rating (also evaluated leave-one-out).
  const meanMae = looMae(
    y.length,
    (train) => train.reduce((s, i) => s + y[i], 0) / train.length,
    (i) => y[i],
  );
  if (mae > P.maeBound || mae >= meanMae)
    return { ...empty, reason: "estimate_not_reliable", looMae: round(mae) };
  const estimate = predict(
    X.map((_, i) => i),
    x,
  );
  return {
    ...empty,
    status: "available",
    looMae: round(mae),
    estimate: round(estimate, 1),
    rangeLow: clamp(Math.round(estimate - mae), 1, 5),
    rangeHigh: clamp(Math.round(estimate + mae), 1, 5),
  };
}

export function limitations(
  source: Session["source"],
  syntheticReports: boolean,
) {
  return [
    "Experimental. Compares only with your own past sessions from the same measurement source. Not medical advice.",
    "Does not establish recovery, fatigue, or fitness for work, and is never used for scheduling or approvals.",
    "Visible only to you. It is not shared with supervisors, even when you share a session summary.",
    ...(source === "mock"
      ? ["Based on synthetic demonstration measurements, not real readings."]
      : []),
    ...(syntheticReports
      ? ["Includes synthetic demonstration self-reports, not real ratings."]
      : []),
  ];
}

// ---------------------------------------------------------------------------
// Repository-backed loading. Only completed sessions of the same worker and
// the same source are ever read; quality=valid filtering happens in summarize.

async function features(repo: Repository, s: Session) {
  const v = summarize(s, await repo.readings(s.id));
  return {
    sessionId: s.id,
    startedAt: s.startedAt,
    pulse: v.pulse.status === "available" ? v.pulse.delta : null,
    breathing: v.breathing.status === "available" ? v.breathing.delta : null,
  } satisfies SessionFeatures;
}

/** Completed same-source sessions that ended at or before `before`, newest first. */
async function priorSessions(
  repo: Repository,
  workerId: string,
  source: Session["source"],
  before: string,
  limit: number,
) {
  const out: Session[] = [];
  const since = new Date(
    Date.parse(before) - P.baselineMaxAgeDays * 86400000,
  ).toISOString();
  let cursor: { startedAt: string; id: string } | undefined;
  while (out.length < limit) {
    const page = await repo.sessionPage(workerId, 50, cursor, {
      source,
      since,
      before,
    });
    for (const s of page)
      if (
        s.source === source &&
        s.status === "completed" &&
        s.endedAt &&
        Date.parse(s.endedAt) <= Date.parse(before) &&
        out.length < limit
      )
        out.push(s);
    if (page.length < 50) break;
    const last = page.at(-1)!;
    cursor = { startedAt: last.startedAt, id: last.id };
  }
  return out;
}

const HISTORY_LIMIT = Math.max(
  P.baselineMaxSessions,
  P.selfReportMaxSessions,
  P.trendWindow,
);

const values = (list: SessionFeatures[], metric: Metric) =>
  list.map((f) => f[metric]).filter((v): v is number => v !== null);

export async function personalInsights(
  repo: Repository,
  sessionId: string,
): Promise<PersonalInsights> {
  const s = await repo.get("sessions", sessionId);
  if (!s) fail(404, "NOT_FOUND", "Session not found");
  const current = await features(repo, s);
  const prior = await Promise.all(
    (
      await priorSessions(
        repo,
        s.workerId,
        s.source,
        s.startedAt,
        HISTORY_LIMIT,
      )
    ).map((p) => features(repo, p)),
  );
  const reports = new Map(
    (await repo.selfReports(s.workerId)).map((r) => [r.sessionId, r]),
  );
  const labeled: Labeled[] = prior.flatMap((f) => {
    const r = reports.get(f.sessionId);
    return r ? [{ features: f, tiredness: r.tiredness, origin: r.origin }] : [];
  });
  const metric = (m: Metric) => {
    const chronological = values([...prior].reverse(), m);
    if (current[m] !== null) chronological.push(current[m]);
    return {
      baseline: baseline(m, current[m], values(prior, m)),
      trend: trend(m, chronological),
    };
  };
  const tiredness = tirednessEstimate(current, labeled);
  return {
    sessionId: s.id,
    source: s.source,
    experimental: true,
    synthetic: s.source === "mock",
    pulse: metric("pulse"),
    breathing: metric("breathing"),
    tiredness,
    selfReport: reports.get(s.id) ?? null,
    limitations: limitations(
      s.source,
      tiredness.includesSyntheticReports ||
        reports.get(s.id)?.origin === "synthetic",
    ),
  };
}

export async function personalTrend(
  repo: Repository,
  workerId: string,
  source: Session["source"],
  now = new Date().toISOString(),
): Promise<PersonalTrend> {
  const recent = await Promise.all(
    (await priorSessions(repo, workerId, source, now, HISTORY_LIMIT)).map((s) =>
      features(repo, s),
    ),
  );
  const chronological = [...recent].reverse();
  return {
    source,
    experimental: true,
    synthetic: source === "mock",
    pulse: trend("pulse", values(chronological, "pulse")),
    breathing: trend("breathing", values(chronological, "breathing")),
    limitations: limitations(source, false),
  };
}
