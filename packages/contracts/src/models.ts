import { z } from "zod";
export const Id = z.uuid();
export const ISO = z.iso.datetime();
export const SourceSchema = z.enum(["mock", "presage"]);
// Recommended check-in length per source (a data-sufficiency guide, not a
// clinical rest time). Real Presage needs ~30-45 s breathing warm-up before the
// 15 s initial window can begin; synthetic mock has no warm-up.
export const RECOMMENDED_CHECK_IN_SECONDS = {
  mock: 60,
  presage: 90,
} as const satisfies Record<z.infer<typeof SourceSchema>, number>;
export const ContextSchema = z.strictObject({
  workload: z.enum(["light", "moderate", "heavy"]).nullable(),
  temperatureC: z.number().finite().nullable(),
});
export const VitalReadingSchema = z.strictObject({
  timestamp: ISO,
  heartRateBpm: z.number().finite().positive().nullable(),
  respiratoryRateBrpm: z.number().finite().positive().nullable(),
  quality: z.enum(["valid", "invalid", "unknown"]),
  source: SourceSchema,
});
export const ReadingEnvelopeSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  reading: VitalReadingSchema,
});
export const WorkerSchema = z.strictObject({
  id: Id,
  displayName: z.string(),
  skills: z.array(z.string()),
});
export const SessionSchema = z.strictObject({
  id: Id,
  workerId: Id,
  breakId: Id,
  source: SourceSchema,
  status: z.enum(["active", "completed"]),
  startedAt: ISO,
  endedAt: ISO.nullable(),
  context: ContextSchema,
  consentVersion: z.enum(["v1", "local-test"]),
  shareWithSupervisor: z.boolean(),
  interruption: z.string().nullable(),
});
export const BreakSchema = z.strictObject({
  id: Id,
  workerId: Id,
  startsAt: ISO,
  endsAt: ISO,
  kind: z.enum(["protected", "additional"]),
  policyLabel: z.string(),
  revision: z.number().int().nonnegative(),
  requestId: Id.nullable(),
});
export const AssignmentSchema = z.strictObject({
  id: Id,
  taskId: Id,
  workerId: Id,
  startsAt: ISO,
  endsAt: ISO,
});
export const TaskSchema = z.strictObject({
  id: Id,
  label: z.string(),
  requiredSkills: z.array(z.string()),
  startsAt: ISO,
  endsAt: ISO,
  staffingRequired: z.number().int().positive(),
});
export const AvailabilitySchema = z.strictObject({
  id: Id,
  workerId: Id,
  startsAt: ISO,
  endsAt: ISO,
});
export const RequestSchema = z.strictObject({
  id: Id,
  workerId: Id,
  sessionId: Id.nullable(),
  kind: z.enum(["additional_rest", "assistance"]),
  requestedMinutes: z.number().int().positive().nullable(),
  status: z.enum([
    "pending",
    "acknowledged",
    "approved",
    "resolved",
    "declined",
  ]),
  createdAt: ISO,
  restStartsAt: ISO.nullable(),
  restEndsAt: ISO.nullable(),
  revision: z.number().int().nonnegative(),
  note: z.string().nullable(),
});
export const SymptomSchema = z.strictObject({
  id: Id,
  workerId: Id,
  sessionId: Id.nullable(),
  codes: z.array(z.enum(["dizzy", "nauseated", "headache", "other"])).min(1),
  note: z.string().max(500).nullable(),
  createdAt: ISO,
  assistanceRequestId: Id,
});
export const MetricSummarySchema = z.strictObject({
  status: z.enum(["available", "insufficient_data"]),
  initialMedian: z.number().nullable(),
  finalMedian: z.number().nullable(),
  delta: z.number().nullable(),
  initialCount: z.number().int(),
  finalCount: z.number().int(),
});
export const ComparisonSchema = z.strictObject({
  status: z.enum(["available", "insufficient_data"]),
  count: z.number().int(),
  historicalMedianDelta: z.number().nullable(),
});
export const SummarySchema = z.strictObject({
  sessionId: Id,
  source: SourceSchema,
  context: ContextSchema,
  durationSeconds: z.number(),
  pulse: MetricSummarySchema,
  breathing: MetricSummarySchema,
  pulseComparison: ComparisonSchema,
  breathingComparison: ComparisonSchema,
  limitations: z.array(z.string()),
});
export const GapSchema = z.strictObject({
  taskId: Id,
  startsAt: ISO,
  endsAt: ISO,
  missingWorkers: z.number().int().positive(),
});
export const AuditSchema = z.strictObject({
  id: Id,
  actor: z.string(),
  action: z.string(),
  entityId: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: ISO,
});
export type Worker = z.infer<typeof WorkerSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type VitalReading = z.infer<typeof VitalReadingSchema>;
export type ReadingEnvelope = z.infer<typeof ReadingEnvelopeSchema>;
export type Break = z.infer<typeof BreakSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type RestRequest = z.infer<typeof RequestSchema>;
export type Symptom = z.infer<typeof SymptomSchema>;
export type MetricSummary = z.infer<typeof MetricSummarySchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type Comparison = z.infer<typeof ComparisonSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type Audit = z.infer<typeof AuditSchema>;
export interface Schedule {
  workers: Worker[];
  breaks: Break[];
  requests: RestRequest[];
  assignments: Assignment[];
  tasks: Task[];
  availability: Availability[];
  scheduleRevision: number;
}
export interface Overview extends Schedule {
  coverageGaps: Gap[];
  symptomReports: Symptom[];
  sharedSessionIds: string[];
}
