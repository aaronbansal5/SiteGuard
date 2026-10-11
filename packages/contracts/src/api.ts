import { z } from "zod";
import {
  Id,
  ISO,
  ContextSchema,
  SourceSchema,
  ReadingEnvelopeSchema,
  AssignmentSchema,
  SummarySchema,
  TimeSeriesEvidenceSchema,
} from "./models.js";
export const LoginSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("worker"), workerId: Id }),
  z.strictObject({ role: z.literal("supervisor") }),
]);
export type Identity = z.infer<typeof LoginSchema>;
export const StartSessionSchema = z.strictObject({
  breakId: Id,
  source: SourceSchema,
  consentVersion: z.literal("v1"),
  shareWithSupervisor: z.boolean(),
  context: ContextSchema,
});
export const IngestSchema = z.strictObject({
  readings: z.array(ReadingEnvelopeSchema).min(1).max(100),
});
export const NewRequestSchema = z
  .strictObject({
    sessionId: Id.nullable(),
    kind: z.enum(["additional_rest", "assistance"]),
    requestedMinutes: z.number().int().min(1).max(120).nullable(),
  })
  .superRefine((r, c) => {
    if ((r.kind === "assistance") !== (r.requestedMinutes === null))
      c.addIssue({
        code: "custom",
        message:
          "Assistance requires null minutes; additional rest requires minutes",
        path: ["requestedMinutes"],
      });
  });
export const NewSymptomSchema = z.strictObject({
  sessionId: Id.nullable(),
  codes: z
    .array(z.enum(["dizzy", "nauseated", "headache", "other"]))
    .min(1)
    .max(4),
  note: z.string().max(500).nullable(),
});
export const RequestActionSchema = z.strictObject({
  action: z.enum(["acknowledge", "approve", "resolve", "decline"]),
  revision: z.number().int().nonnegative(),
  restStartsAt: ISO.optional(),
  restEndsAt: ISO.optional(),
  note: z.string().trim().min(1).max(500),
});
export const BreakUpdateSchema = z.strictObject({
  startsAt: ISO,
  endsAt: ISO,
  revision: z.number().int().nonnegative(),
});
// Validation and coverage-gap computation are super-linear in the number of
// assignments and run on the event loop for every overview poll afterwards.
// The planner's own proposals for the demo roster are far smaller.
export const MAX_COMMIT_ASSIGNMENTS = 500;
export const CommitSchema = z.strictObject({
  baseRevision: z.number().int().nonnegative(),
  assignments: z.array(AssignmentSchema).max(MAX_COMMIT_ASSIGNMENTS),
});
export const ExplainSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("session"), sessionId: Id }),
  z.strictObject({ kind: z.literal("schedule"), auditEventId: Id }),
]);
export const ExplanationSchema = z.strictObject({
  origin: z.enum(["gemini", "deterministic"]),
  observations: z.array(z.string()),
  limitations: z.array(z.string()),
});
export const ErrorSchema = z.strictObject({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    requestId: z.string(),
  }),
});
export const EmptySchema = z.strictObject({});
export const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().optional(),
});
export const SummaryResponseSchema = z.strictObject({ summary: SummarySchema });
export const TimeSeriesEvidenceResponseSchema = z.strictObject({
  evidence: TimeSeriesEvidenceSchema,
});
export type Explanation = z.infer<typeof ExplanationSchema>;
