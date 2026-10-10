// Cross-checks the shared iOS reading-mapping fixture
// (apps/mobile-ios/SiteGuardCheckInTests/Fixtures/mapped-readings.json):
//  - every expected reading satisfies the canonical VitalReading schema;
//  - the iOS mapping rules match the Presage bridge's validity mapping
//    (statusFromStable + normalizeSample), so a phone and the laptop bridge
//    turn the same SDK sample into the same SiteGuard readings.
// The Swift side (ReadingMapperTests) asserts the same fixture on a Mac; it
// cannot be compiled or run in this Linux environment.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VitalReadingSchema } from "./models.js";
import { normalizeSample } from "../../../integrations/presage-bridge/src/normalize.js";
import { statusFromStable } from "../../../integrations/presage-bridge/src/adapters/presage-sdk.js";

interface Sample {
  value: number;
  stable: boolean | null;
  timestampMicros: number;
}
interface Case {
  name: string;
  pulse: Sample | null;
  breathing: Sample | null;
  expected: unknown[];
}
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../apps/mobile-ios/SiteGuardCheckInTests/Fixtures/mapped-readings.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: Case[] };

describe("iOS reading-mapping fixture", () => {
  it("has cases", () => expect(fixture.cases.length).toBeGreaterThan(5));
  for (const c of fixture.cases) {
    it(`${c.name}: expected readings match the contract`, () => {
      for (const r of c.expected) {
        const parsed = VitalReadingSchema.parse(r);
        expect(parsed.source).toBe("presage");
      }
    });
    const timestamps = [c.pulse, c.breathing]
      .filter((x): x is Sample => x !== null)
      .map((x) => x.timestampMicros);
    // The bridge emits one timestamp per sample; compare where that applies.
    if (new Set(timestamps).size <= 1)
      it(`${c.name}: matches the Presage bridge mapping`, () => {
        const observe = (s: Sample | null) =>
          s && {
            value: s.value,
            status: statusFromStable({ value: s.value, stable: s.stable }),
          };
        const ms = (timestamps[0] ?? 0) / 1000;
        expect(
          normalizeSample(
            { monotonicMs: 0, wallMs: 0 },
            {
              monotonicMs: ms,
              pulse: observe(c.pulse),
              breathing: observe(c.breathing),
            },
          ),
        ).toEqual(c.expected);
      });
  }
});
