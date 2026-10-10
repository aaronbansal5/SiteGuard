import { z } from "zod";
import {
  Id,
  ISO,
  SourceSchema,
  BreakSchema,
  AssignmentSchema,
  TaskSchema,
  AvailabilitySchema,
  RequestSchema,
  SymptomSchema,
} from "./models.js";

/**
 * "What my supervisor sees" (docs/FEATURE_IDEAS.md, idea A1).
 *
 * A worker-only mirror of the records about that worker which safety
 * operations can currently read. It is derived from the same data as
 * GET /supervisor/overview and the sharing-consent check on session reads, so
 * it reports access, not a summary of the worker. It contains no readings,
 * summaries, personal insights or self-reports.
 */
export const SharedSessionRefSchema = z.strictObject({
  id: Id,
  source: SourceSchema,
  status: z.enum(["active", "completed"]),
  startedAt: ISO,
  endedAt: ISO.nullable(),
  /** True when the overview also links this session from a worker request. */
  linkedToRequest: z.boolean(),
});
export const SupervisorViewSchema = z.strictObject({
  workerId: Id,
  generatedAt: ISO,
  breaks: z.array(BreakSchema),
  assignments: z.array(AssignmentSchema),
  tasks: z.array(TaskSchema),
  availability: z.array(AvailabilitySchema),
  requests: z.array(RequestSchema),
  symptomReports: z.array(SymptomSchema),
  sharedSessions: z.array(SharedSessionRefSchema),
});
export const SupervisorViewResponseSchema = z.strictObject({
  view: SupervisorViewSchema,
});
/**
 * Sharing can only be withdrawn after a check-in starts. Granting it again
 * would be a new consent decision, which belongs on the consent screen.
 */
export const SharingUpdateSchema = z.strictObject({
  shareWithSupervisor: z.literal(false),
});
/** Categories the supervisor workspace never receives, shown to the worker. */
export const SUPERVISOR_NEVER_SEES = [
  "Camera images or video (SiteGuard never stores them)",
  "Pulse and breathing from check-ins you did not share",
  "Your personal comparison, trend and tiredness ratings",
  "Any fatigue, risk or safety score (SiteGuard does not compute one)",
] as const;
export type SharedSessionRef = z.infer<typeof SharedSessionRefSchema>;
export type SupervisorView = z.infer<typeof SupervisorViewSchema>;
