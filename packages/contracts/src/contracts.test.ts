import { describe, it, expect } from "vitest";
import {
  VitalReadingSchema,
  NewRequestSchema,
  StartSessionSchema,
  BridgeEventSchema,
} from "./index.js";
const reading = {
  timestamp: "2026-10-10T15:00:00.000Z",
  heartRateBpm: 100,
  respiratoryRateBrpm: null,
  quality: "valid",
  source: "mock",
};
describe("shared contracts", () => {
  it("accepts a partial metric and retains source", () =>
    expect(VitalReadingSchema.parse(reading).source).toBe("mock"));
  it.each([0, -2, Infinity, NaN])(
    "rejects nonpositive or nonfinite rate %s",
    (v) =>
      expect(
        VitalReadingSchema.safeParse({ ...reading, heartRateBpm: v }).success,
      ).toBe(false),
  );
  it("rejects extra write fields", () =>
    expect(
      VitalReadingSchema.safeParse({ ...reading, recovered: true }).success,
    ).toBe(false));
  it("never infers unknown validity", () =>
    expect(
      VitalReadingSchema.parse({ ...reading, quality: "unknown" }).quality,
    ).toBe("unknown"));
  it("validates request kind and minutes together", () => {
    expect(
      NewRequestSchema.safeParse({
        sessionId: null,
        kind: "assistance",
        requestedMinutes: 5,
      }).success,
    ).toBe(false);
    expect(
      NewRequestSchema.safeParse({
        sessionId: null,
        kind: "additional_rest",
        requestedMinutes: null,
      }).success,
    ).toBe(false);
    expect(
      NewRequestSchema.safeParse({
        sessionId: null,
        kind: "assistance",
        requestedMinutes: null,
      }).success,
    ).toBe(true);
  });
  it("requires consent version", () =>
    expect(StartSessionSchema.safeParse({}).success).toBe(false));
  it("rejects invented bridge payload", () =>
    expect(
      BridgeEventSchema.safeParse({
        type: "reading",
        reading: { ...reading, source: "sdk" },
      }).success,
    ).toBe(false));
});
