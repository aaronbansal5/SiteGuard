import { z } from "zod";
import { VitalReadingSchema } from "./models.js";
export const BridgeHealthSchema = z.strictObject({
  protocolVersion: z.literal(1),
  source: z.literal("presage"),
  status: z.enum(["ready", "unavailable"]),
  reason: z.string().nullable(),
});
export const BridgeSessionSchema = z.strictObject({
  bridgeSessionId: z.string().min(1),
});
export const BridgeEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("reading"), reading: VitalReadingSchema }),
  z.strictObject({
    type: z.literal("status"),
    state: z.enum(["positioning", "measuring", "stopped"]),
    message: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type MeasurementEvent =
  | {
      type: "reading";
      sequence: number;
      reading: z.infer<typeof VitalReadingSchema>;
    }
  | {
      type: "status";
      state: "positioning" | "measuring" | "stopped";
      message: string | null;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };
export interface MeasurementSource {
  start(appSessionId: string): Promise<void>;
  subscribe(onEvent: (event: MeasurementEvent) => void): () => void;
  stop(): Promise<void>;
}
