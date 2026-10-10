import { z } from "zod";
import { Id, ISO, SourceSchema } from "./models.js";

/**
 * Worker-only, experimental personal insights. See docs/RECOVERY_MODEL.md.
 * These are data-sufficiency and display rules, not clinical thresholds.
 * Nothing here is ever returned to a supervisor.
 */
export const PERSONAL_MODEL = {
  /** Prior same-source sessions with an available metric needed for a baseline. */
  baselineMinSessions: 5,
  /** Most recent prior sessions used for the baseline. */
  baselineMaxSessions: 20,
  /** Prior sessions older than this are not used. */
  baselineMaxAgeDays: 90,
  /** |robust z| above this is described as outside your usual range. */
  zThreshold: 2,
  /** 1.4826 * MAD estimates a standard deviation for normally distributed data. */
  madConsistency: 1.4826,
  /** Minimum robust scale so near-identical sessions do not inflate z. */
  minScale: { pulse: 1, breathing: 0.5 },
  /** Sessions (most recent, chronological) used for the Theil–Sen trend. */
  trendWindow: 8,
  trendMinSessions: 5,
  /** Labeled sessions needed before fitting the tiredness regression. */
  selfReportMinSessions: 8,
  /** Most recent labeled sessions used for the regression. */
  selfReportMaxSessions: 40,
  /** Ridge penalty on standardized features (intercept unpenalized). */
  ridgeLambda: 1,
  /** Leave-one-out MAE (rating points) must be at or below this bound. */
  maeBound: 0.75,
} as const;

export const TirednessSchema = z.number().int().min(1).max(5);
export const SelfReportSchema = z.strictObject({
  sessionId: Id,
  workerId: Id,
  tiredness: TirednessSchema,
  origin: z.enum(["worker", "synthetic"]),
  createdAt: ISO,
});
export const SelfReportInputSchema = z.strictObject({
  tiredness: TirednessSchema.nullable(),
});

export const BaselineSchema = z.strictObject({
  status: z.enum(["available", "insufficient_data"]),
  reason: z
    .enum(["current_session_unavailable", "not_enough_prior_sessions"])
    .nullable(),
  priorCount: z.number().int().nonnegative(),
  requiredCount: z.number().int().positive(),
  current: z.number().nullable(),
  usualMedian: z.number().nullable(),
  usualMad: z.number().nullable(),
  robustZ: z.number().nullable(),
  classification: z
    .enum(["within_usual", "settled_less", "settled_more"])
    .nullable(),
});
export const TrendSchema = z.strictObject({
  status: z.enum(["available", "insufficient_data"]),
  reason: z.enum(["not_enough_sessions"]).nullable(),
  count: z.number().int().nonnegative(),
  requiredCount: z.number().int().positive(),
  slopePerSession: z.number().nullable(),
  direction: z.enum(["steady", "settling_more", "settling_less"]).nullable(),
});
export const MetricInsightSchema = z.strictObject({
  baseline: BaselineSchema,
  trend: TrendSchema,
});
export const TirednessEstimateSchema = z.strictObject({
  status: z.enum(["available", "insufficient_data"]),
  reason: z
    .enum([
      "current_session_unavailable",
      "not_enough_labeled_sessions",
      "ratings_do_not_vary",
      "estimate_not_reliable",
    ])
    .nullable(),
  labeledCount: z.number().int().nonnegative(),
  requiredCount: z.number().int().positive(),
  looMae: z.number().nullable(),
  maeBound: z.number(),
  estimate: z.number().nullable(),
  rangeLow: TirednessSchema.nullable(),
  rangeHigh: TirednessSchema.nullable(),
  includesSyntheticReports: z.boolean(),
});
export const PersonalInsightsSchema = z.strictObject({
  sessionId: Id,
  source: SourceSchema,
  experimental: z.literal(true),
  synthetic: z.boolean(),
  pulse: MetricInsightSchema,
  breathing: MetricInsightSchema,
  tiredness: TirednessEstimateSchema,
  selfReport: SelfReportSchema.nullable(),
  limitations: z.array(z.string()),
});
export const PersonalTrendSchema = z.strictObject({
  source: SourceSchema,
  experimental: z.literal(true),
  synthetic: z.boolean(),
  pulse: TrendSchema,
  breathing: TrendSchema,
  limitations: z.array(z.string()),
});
export const PersonalInsightsResponseSchema = z.strictObject({
  insights: PersonalInsightsSchema,
});
export const PersonalTrendQuerySchema = z.strictObject({
  source: SourceSchema,
});
export const PersonalTrendResponseSchema = z.strictObject({
  trend: PersonalTrendSchema,
});
export const SelfReportResponseSchema = z.strictObject({
  selfReport: SelfReportSchema.nullable(),
});
export type SelfReport = z.infer<typeof SelfReportSchema>;
export type Baseline = z.infer<typeof BaselineSchema>;
export type Trend = z.infer<typeof TrendSchema>;
export type MetricInsight = z.infer<typeof MetricInsightSchema>;
export type TirednessEstimate = z.infer<typeof TirednessEstimateSchema>;
export type PersonalInsights = z.infer<typeof PersonalInsightsSchema>;
export type PersonalTrend = z.infer<typeof PersonalTrendSchema>;
