import { describe, expect, test } from "vitest";
import {
  describePacket,
  formatPacket,
  parseInspectArgs,
  PresenceTracker,
  requestedCodes,
  runInspect,
  type InspectModule,
} from "../src/inspect.js";

/** Decoded-packet shapes follow @smartspectra/node-sdk 3.4.0 generated.d.ts. */
const PULSE_VALUE = 71.25;
const RMSSD_VALUE = 43.5;
const packet = {
  cardio: {
    pulseRate: [
      { value: PULSE_VALUE, confidence: 12, stable: false, timestamp: 1 },
      { value: PULSE_VALUE, confidence: 41, stable: true, timestamp: 2 },
    ],
    arterialPressureTrace: [],
    hrv: [{ rmssd: RMSSD_VALUE, sdnn: 50, confidence: 0, stable: false }],
    pulseRateStrict: { value: PULSE_VALUE, timestamp: 3 },
  },
  breathing: {
    rate: [],
    upperTrace: [{ value: 0.2, stable: false, timestamp: 1 }],
    breathingRateStrict: null,
  },
};

describe("describePacket", () => {
  test("reports populated fields, counts, stable and confidence only", () => {
    expect(describePacket(packet)).toEqual([
      {
        path: "cardio.pulseRate",
        samples: 2,
        stable: 1,
        latestConfidence: 41,
      },
      { path: "cardio.hrv", samples: 1, stable: 0, latestConfidence: 0 },
      {
        path: "cardio.pulseRateStrict",
        samples: 1,
        stable: null,
        latestConfidence: null,
      },
      {
        path: "breathing.upperTrace",
        samples: 1,
        stable: 0,
        latestConfidence: null,
      },
    ]);
  });

  test("output never contains metric values", () => {
    const text = formatPacket(1, 2.5, describePacket(packet));
    expect(text).not.toContain(String(PULSE_VALUE));
    expect(text).not.toContain(String(RMSSD_VALUE));
    expect(text).toContain("cardio.pulseRate[n=2 stable=1 conf=41]");
  });

  test("ignores non-objects and empty packets", () => {
    expect(describePacket(null)).toEqual([]);
    expect(describePacket(Buffer.from([1]))).toEqual([]);
    expect(formatPacket(3, 0, [])).toContain("(no metric fields)");
  });
});

describe("PresenceTracker", () => {
  test("records first-seen and first-stable offsets", () => {
    const t = new PresenceTracker();
    t.add(1, [
      { path: "cardio.pulseRate", samples: 1, stable: 0, latestConfidence: 5 },
    ]);
    t.add(13, [
      { path: "cardio.pulseRate", samples: 1, stable: 1, latestConfidence: 45 },
    ]);
    const s = t.summary().join("\n");
    expect(s).toContain(
      "cardio.pulseRate: 2 packets, first seen t+1.0s, first stable t+13.0s",
    );
    expect(s).toContain("cardio.hrv: never populated");
  });
});

describe("parseInspectArgs", () => {
  test("defaults and flags", () => {
    expect(parseInspectArgs([])).toEqual({
      maxSeconds: 90,
      all: false,
      strict: false,
      verbose: false,
      interframeDelayMs: 33,
    });
    expect(parseInspectArgs(["--strict"])).toMatchObject({ strict: true });
    expect(
      parseInspectArgs([
        "--file",
        "a.mp4",
        "--max-seconds",
        "60",
        "--all",
        "--interframe-ms",
        "0",
      ]),
    ).toMatchObject({
      file: "a.mp4",
      maxSeconds: 60,
      all: true,
      interframeDelayMs: 0,
    });
  });
  test("rejects bad input", () => {
    expect(parseInspectArgs(["--file"])).toBeTypeOf("string");
    expect(parseInspectArgs(["--max-seconds", "x"])).toBeTypeOf("string");
    expect(parseInspectArgs(["--nope"])).toBeTypeOf("string");
    // The SDK rejects sessions mixing strict and standard metrics.
    expect(parseInspectArgs(["--strict", "--all"])).toBeTypeOf("string");
  });
});

const MetricType = {
  CHEST_BREATHING: 0,
  ABDOMEN_BREATHING: 1,
  BREATHING_RATE: 2,
  BREATHING_AMPLITUDE: 3,
  APNEA: 4,
  RESPIRATORY_LINE_LENGTH: 5,
  BASELINE: 6,
  INHALE_EXHALE_RATIO: 7,
  GLUTES_MICROMOTION: 8,
  KNEES_MICROMOTION: 9,
  EDA_TRACE: 10,
  FACE_LANDMARKS: 11,
  BLINKING: 12,
  TALKING: 13,
  EXPRESSIONS: 14,
  PULSE_RATE: 15,
  ARTERIAL_PRESSURE_TRACE: 16,
  HRV: 17,
  PULSE_RATE_STRICT: 18,
  BREATHING_RATE_STRICT: 19,
};

function fakeModule(opts: { fatal?: boolean } = {}) {
  const calls: unknown[][] = [];
  let ctor: Record<string, unknown> = {};
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  class FakeSdk {
    constructor(o: Record<string, unknown>) {
      ctor = o;
    }
    on(e: string, cb: (...a: unknown[]) => void) {
      handlers[e] = cb;
      return this;
    }
    useCamera(...a: unknown[]) {
      calls.push(["useCamera", ...a]);
      return this;
    }
    useFile(...a: unknown[]) {
      calls.push(["useFile", ...a]);
      return this;
    }
    start() {
      calls.push(["start"]);
      queueMicrotask(() => {
        handlers.processingStatus?.(3);
        handlers.validationStatus?.(5, 0, "Too dark");
        handlers.validationStatus?.(5, 0, "Too dark");
        handlers.validationStatus?.(0, 0, "");
        if (opts.fatal) {
          handlers.error?.(4, "quota", false);
          return;
        }
        handlers.metrics?.(Buffer.from("p1"), 1);
        handlers.metrics?.(Buffer.from("p2"), 2);
        handlers.processingStatus?.(1); // idle = end of file
      });
    }
    async stopAsync() {
      calls.push(["stopAsync"]);
    }
    async destroy() {
      calls.push(["destroy"]);
    }
  }
  const mod: InspectModule = {
    SmartSpectraSDK: FakeSdk as never,
    MetricType,
    ProcessingStatus: { kRunning: 3, kIdle: 1, kError: 5 },
    ValidationCode: { kOk: 0, kTooDark: 5 },
    SmartSpectraErrorCode: { kCreditExhausted: 4 },
    CameraSelection: { default: { kind: "default" } },
    decodeMetrics: () => packet,
  };
  return { mod, calls, ctor: () => ctor };
}

describe("runInspect (fake SDK module)", () => {
  test("requires SMARTSPECTRA_API_KEY and never loads the SDK without it", async () => {
    let loaded = false;
    const lines: string[] = [];
    const code = await runInspect(
      {
        maxSeconds: 1,
        all: false,
        strict: false,
        verbose: false,
        interframeDelayMs: 33,
      },
      {
        env: {},
        load: async () => {
          loaded = true;
          return fakeModule().mod;
        },
        log: (l) => lines.push(l),
        nowMs: () => 0,
      },
    );
    expect(code).toBe(2);
    expect(loaded).toBe(false);
  });

  test("file run: telemetry off, standard codes only, presence only", async () => {
    const f = fakeModule();
    const lines: string[] = [];
    const code = await runInspect(
      {
        file: "clip.mp4",
        maxSeconds: 5,
        all: false,
        strict: false,
        verbose: true,
        interframeDelayMs: 33,
      },
      {
        env: { SMARTSPECTRA_API_KEY: "test-key-not-real" },
        load: async () => f.mod,
        log: (l) => lines.push(l),
        nowMs: () => 0,
      },
    );
    expect(code).toBe(0);
    expect(f.ctor().enableTelemetry).toBe(false);
    const req = f.ctor().requestedMetrics as number[];
    expect(req).toContain(15);
    expect(req).toContain(17);
    expect(req).toContain(2);
    expect(req).not.toContain(18); // strict never mixed with standard
    expect(req).not.toContain(19);
    expect(req).not.toContain(10); // EDA only with --all
    expect(f.calls[0]).toEqual([
      "useFile",
      "clip.mp4",
      { interframeDelayMs: 33 },
    ]);
    expect(f.calls.map((c) => c[0])).toEqual([
      "useFile",
      "start",
      "stopAsync",
      "destroy",
    ]);
    const out = lines.join("\n");
    expect(out.match(/validation .*kTooDark/g)).toHaveLength(1); // de-duplicated
    expect(out).toContain("validation t+0.0s kOk");
    expect(out.match(/^packet #/gm)).toHaveLength(2);
    expect(out).toContain("summary: 2 metrics packets");
    expect(out).not.toContain(String(PULSE_VALUE));
    expect(out).not.toContain(String(RMSSD_VALUE));
  });

  test("non-retryable error ends the run with exit 1 and releases the SDK", async () => {
    const f = fakeModule({ fatal: true });
    const lines: string[] = [];
    const code = await runInspect(
      {
        maxSeconds: 5,
        all: true,
        strict: false,
        verbose: false,
        interframeDelayMs: 33,
      },
      {
        env: { SMARTSPECTRA_API_KEY: "k" },
        load: async () => f.mod,
        log: (l) => lines.push(l),
        nowMs: () => 0,
      },
    );
    expect(code).toBe(1);
    expect(f.calls[0][0]).toBe("useCamera");
    expect(f.calls.map((c) => c[0])).toContain("destroy");
    expect(lines.join("\n")).toContain(
      "error kCreditExhausted retryable=false",
    );
    expect(requestedCodes(f.mod, { all: true, strict: false })).toContain(10);
  });

  test("strict mode requests only the two Strict codes", () => {
    const f = fakeModule();
    expect(requestedCodes(f.mod, { all: false, strict: true })).toEqual([
      18, 19,
    ]);
  });
});
