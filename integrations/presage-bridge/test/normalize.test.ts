import { describe, expect, test } from "vitest";
import { VitalReadingSchema } from "../../../packages/contracts/src/index.js";
import { normalizeSample, toUtc } from "../src/normalize.js";
import { EventLog } from "../src/event-log.js";
import { ManualClock } from "./helpers.js";

const anchor = {
  monotonicMs: 5000,
  wallMs: Date.parse("2026-10-10T12:00:00.000Z"),
};
const at = (offset: number) => anchor.monotonicMs + offset;

describe("normalizeSample (validity only from explicit SDK status)", () => {
  test("maps monotonic time to UTC from the capture anchor", () => {
    expect(toUtc(anchor, at(1500))).toBe("2026-10-10T12:00:01.500Z");
  });

  test("both valid -> single valid reading", () => {
    const out = normalizeSample(anchor, {
      monotonicMs: at(1000),
      pulse: { value: 90, status: "valid" },
      breathing: { value: 16, status: "valid" },
    });
    expect(out).toEqual([
      {
        timestamp: "2026-10-10T12:00:01.000Z",
        heartRateBpm: 90,
        respiratoryRateBrpm: 16,
        quality: "valid",
        source: "presage",
      },
    ]);
  });

  test("plausible numbers never upgrade an invalid or unknown status", () => {
    for (const status of ["invalid", "unknown"] as const) {
      const [r] = normalizeSample(anchor, {
        monotonicMs: at(0),
        pulse: { value: 72, status },
        breathing: { value: 14, status },
      });
      expect(r.quality).toBe(status);
      expect(r.heartRateBpm).toBe(72);
    }
  });

  test("implausible numbers never downgrade an explicit valid status", () => {
    const [r] = normalizeSample(anchor, {
      monotonicMs: at(0),
      pulse: { value: 250, status: "valid" },
      breathing: { value: 70, status: "valid" },
    });
    expect(r.quality).toBe("valid");
  });

  test("valid status with no usable number becomes unknown, rate null", () => {
    for (const value of [null, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = normalizeSample(anchor, {
        monotonicMs: at(0),
        pulse: { value, status: "valid" },
        breathing: null,
      });
      expect(out).toHaveLength(1);
      expect(out[0].quality).toBe("unknown");
      expect(out[0].heartRateBpm).toBeNull();
      expect(VitalReadingSchema.safeParse(out[0]).success).toBe(true);
    }
  });

  test("differing validity splits into separate readings with the other rate null", () => {
    const out = normalizeSample(anchor, {
      monotonicMs: at(0),
      pulse: { value: 95, status: "valid" },
      breathing: { value: 17, status: "invalid" },
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      heartRateBpm: 95,
      respiratoryRateBrpm: null,
      quality: "valid",
    });
    expect(out[1]).toMatchObject({
      heartRateBpm: null,
      respiratoryRateBrpm: 17,
      quality: "invalid",
    });
    expect(out[0].timestamp).toBe(out[1].timestamp);
  });

  test("single-metric and empty samples", () => {
    expect(
      normalizeSample(anchor, {
        monotonicMs: at(0),
        pulse: null,
        breathing: { value: 15, status: "valid" },
      }),
    ).toMatchObject([
      { heartRateBpm: null, respiratoryRateBrpm: 15, quality: "valid" },
    ]);
    expect(
      normalizeSample(anchor, {
        monotonicMs: at(0),
        pulse: null,
        breathing: null,
      }),
    ).toEqual([]);
  });
});

describe("EventLog replay window", () => {
  test("monotonic ids, cursor replay, and expiry after pruning", () => {
    const clock = new ManualClock();
    const log = new EventLog(120_000, () => clock.monotonicMs());
    const ev = { type: "status", state: "measuring", message: null } as const;
    log.append(ev); // id 0
    clock.advance(60_000);
    log.append(ev); // id 1
    expect(log.replay(-1)).toMatchObject({
      ok: true,
      events: [{ id: 0 }, { id: 1 }],
    });
    expect(log.replay(0)).toMatchObject({ ok: true, events: [{ id: 1 }] });
    clock.advance(61_000); // id 0 is now older than 120s
    log.append(ev); // id 2
    expect(log.replay(-1)).toEqual({ ok: false, code: "REPLAY_EXPIRED" });
    expect(log.replay(0)).toMatchObject({
      ok: true,
      events: [{ id: 1 }, { id: 2 }],
    });
    expect(log.replay(2)).toEqual({ ok: true, events: [] });
  });
});
