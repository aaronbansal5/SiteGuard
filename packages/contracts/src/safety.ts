import { z } from "zod";
import { Id, ISO } from "./models.js";
export const SafetyEventSchema = z.strictObject({
  protocolVersion: z.literal(1),
  eventId: Id,
  cameraId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  zoneId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  detectorRunId: Id,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  trackId: z.string().min(1).max(80),
  observedAt: ISO,
  kind: z.literal("possible_person_down"),
  source: z.enum(["synthetic", "camera", "recorded_fixture"]),
  method: z.literal("bbox-aspect-v1"),
  durationSeconds: z.number().finite().nonnegative().max(86400),
  evidence: z.strictObject({heightWidthRatio: z.number().finite().positive().max(100)}),
});
export const SafetyIncidentSchema = SafetyEventSchema.extend({
  id: Id,
  receivedAt: ISO,
  status: z.enum(["open", "acknowledged", "resolved", "false_alarm"]),
  note: z.string().max(1000).nullable(),
  workerId: Id.nullable(),
  assistanceRequestId: Id.nullable(),
  revision: z.number().int().nonnegative(),
});
export const SafetyActionSchema = z.strictObject({
  action: z.enum(["acknowledge", "associate", "resolve", "false_alarm"]),
  revision: z.number().int().nonnegative(),
  note: z.string().trim().max(1000),
  workerId: Id.optional(),
}).superRefine((value,ctx)=>{
  if(value.action==='associate' && !value.workerId) ctx.addIssue({code:'custom',path:['workerId'],message:'Select a worker after checking the scene'});
  if(value.action!=='associate' && value.workerId) ctx.addIssue({code:'custom',path:['workerId'],message:'Worker is only accepted for association'});
  if(['resolve','false_alarm','associate'].includes(value.action) && !value.note) ctx.addIssue({code:'custom',path:['note'],message:'A scene-check note is required'});
});
export type SafetyEvent = z.infer<typeof SafetyEventSchema>;
export type SafetyIncident = z.infer<typeof SafetyIncidentSchema>;
