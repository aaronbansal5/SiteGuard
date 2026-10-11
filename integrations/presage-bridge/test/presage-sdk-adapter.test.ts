import { describe, expect, test } from "vitest";
import {
  GENERIC_GUIDANCE,
  PINNED_VALIDATION_CODES,
  PresageSdkAdapter,
  VALIDATION_GUIDANCE,
  WARM_UP_MESSAGE,
  guidanceFor,
  statusFromStable,
  type SmartSpectraModule,
} from "../src/adapters/presage-sdk.js";
import type { AdapterSample, Clock } from "../src/adapter.js";

const clock: Clock = {
  monotonicMs: () => 1_000,
  wallMs: () => 1_700_000_000_000,
};
const env = { SMARTSPECTRA_API_KEY: "test-key-not-real" };

/** Fake of the vendor module: same names/shapes as @smartspectra/node-sdk 3.4.0's .d.ts. */
function fakeModule(
  opts: {
    cameras?: number;
    failStart?: boolean;
    noRunningEvent?: boolean;
    validationCodes?: SmartSpectraModule["ValidationCode"];
  } = {},
) {
  const calls: string[] = [];
  let ctorOptions: unknown;
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  class FakeSdk {
    static version = "3.4.0";
    static availableCameras() {
      return Array.from({ length: opts.cameras ?? 1 }, (_, i) => ({
        id: `c${i}`,
        name: null,
      }));
    }
    constructor(o: unknown) {
      ctorOptions = o;
    }
    on(e: string, cb: (...a: unknown[]) => void) {
      handlers[e] = cb;
      return this;
    }
    useCamera() {
      calls.push("useCamera");
      return this;
    }
    useCustomInput() {
      calls.push("useCustomInput");
      return this;
    }
    sendFrame(
      _frame: Buffer,
      width: number,
      height: number,
      stride: number,
      format: number,
      _timestampUs: number,
    ) {
      calls.push(`sendFrame:${width}:${height}:${stride}:${format}`);
      return true;
    }
    start() {
      calls.push("start");
      queueMicrotask(() =>
        opts.failStart
          ? handlers.error?.(2, "bad key", false)
          : opts.noRunningEvent
            ? handlers.validationStatus?.(1, 0, "Face not found")
            : handlers.processingStatus?.(3),
      );
    }
    async stopAsync() {
      calls.push("stopAsync");
    }
    async destroy() {
      calls.push("destroy");
    }
  }
  const mod: SmartSpectraModule = {
    SmartSpectraSDK:
      FakeSdk as unknown as SmartSpectraModule["SmartSpectraSDK"],
    MetricType: { PULSE_RATE: 15, BREATHING_RATE: 2 },
    ProcessingStatus: { kRunning: 3, kError: 5 },
    ValidationCode: opts.validationCodes ?? { kOk: 0 },
    SmartSpectraErrorCode: {
      kOk: 0,
      kAuthenticationFailed: 2,
      kInputUnavailable: 7,
    },
    CameraSelection: { default: { kind: "default" } },
    PixelFormat: { kRGBA: 2 },
    decodeMetrics: (buf: Buffer) => JSON.parse(buf.toString()),
  };
  return { mod, calls, handlers, ctorOptions: () => ctorOptions };
}

const packet = (pulse: object | null, breathing: object | null) =>
  Buffer.from(
    JSON.stringify({
      ...(pulse ? { cardio: { pulseRate: [pulse] } } : {}),
      ...(breathing ? { breathing: { rate: [breathing] } } : {}),
    }),
  );

describe("PresageSdkAdapter (fake SDK)", () => {
  test("validity comes only from the vendor's explicit `stable` flag", () => {
    expect(statusFromStable({ value: 70, stable: true })).toBe("valid");
    expect(statusFromStable({ value: 70, stable: false })).toBe("invalid");
    expect(statusFromStable({ value: 70 })).toBe("unknown");
    // implausible number does not change a vendor-reported status
    expect(statusFromStable({ value: 999, stable: true })).toBe("valid");
  });

  test("probe: needs key, loadable SDK and a camera", async () => {
    const f = fakeModule();
    expect(
      (await new PresageSdkAdapter(clock, {}, async () => f.mod).probe()).ready,
    ).toBe(false);
    expect(
      await new PresageSdkAdapter(clock, env, async () => f.mod).probe(),
    ).toEqual({ ready: true, reason: null });
    const none = fakeModule({ cameras: 0 });
    expect(
      (await new PresageSdkAdapter(clock, env, async () => none.mod).probe())
        .reason,
    ).toMatch(/camera/);
    const broken = new PresageSdkAdapter(clock, env, async () => {
      throw new Error("dlopen failed");
    });
    expect((await broken.probe()).reason).toMatch(/could not be loaded/);
  });

  test("open requests only pulse+breathing with telemetry off, maps samples/status/errors, and closes", async () => {
    const f = fakeModule();
    const samples: AdapterSample[] = [];
    const statuses: [string, string | null][] = [];
    const errors: [string, string, boolean][] = [];
    const a = new PresageSdkAdapter(clock, env, async () => f.mod);
    const cap = await a.open({
      onSample: (s) => samples.push(s),
      onStatus: (s, m) => statuses.push([s, m]),
      onError: (c, m, r) => errors.push([c, m, r]),
    });
    expect(f.ctorOptions()).toEqual({
      apiKey: env.SMARTSPECTRA_API_KEY,
      requestedMetrics: [15, 2],
      enableTelemetry: false,
    });
    expect(f.calls).toEqual(["useCamera", "start"]);

    f.handlers.validationStatus(1, 0, "Face not found");
    f.handlers.validationStatus(1, 0, "Face not found"); // per-frame repeat: collapsed
    f.handlers.validationStatus(0, 0, "");
    f.handlers.validationStatus(0, 0, "");
    const t = (1_700_000_000_000 + 500) * 1000; // µs, 500 ms after wall "now"
    f.handlers.metrics(
      packet(
        { value: 72, stable: true, confidence: 80, timestamp: t },
        { value: 15, stable: false, confidence: 20, timestamp: t },
      ),
    );
    f.handlers.metrics(packet({ value: 72, stable: true, timestamp: t }, null)); // same timestamp: ignored
    f.handlers.error(7, "camera unplugged", true);

    expect(statuses).toEqual([
      ["positioning", VALIDATION_GUIDANCE.kNoFaceFound],
      ["measuring", WARM_UP_MESSAGE],
    ]);
    expect(samples).toEqual([
      {
        monotonicMs: 1_500,
        pulse: { value: 72, status: "valid" },
        breathing: { value: 15, status: "invalid" },
      },
    ]);
    expect(errors).toEqual([["kInputUnavailable", "camera unplugged", true]]);

    await cap.close();
    await cap.close(); // idempotent
    expect(f.calls).toEqual(["useCamera", "start", "stopAsync", "destroy"]);
  });

  test("a start-time SDK error rejects open and releases the SDK", async () => {
    const f = fakeModule({ failStart: true });
    const a = new PresageSdkAdapter(clock, env, async () => f.mod);
    await expect(
      a.open({ onSample() {}, onStatus() {}, onError() {} }),
    ).rejects.toThrow(/kAuthenticationFailed: bad key/);
    expect(f.calls).toEqual(["useCamera", "start", "stopAsync", "destroy"]);
  });

  test("start settles on first SDK feedback even without a kRunning event (observed on macOS)", async () => {
    const f = fakeModule({ noRunningEvent: true });
    const statuses: string[] = [];
    const cap = await new PresageSdkAdapter(clock, env, async () => f.mod).open(
      {
        onSample() {},
        onStatus: (s) => statuses.push(s),
        onError() {},
      },
    );
    expect(statuses).toEqual(["positioning"]);
    await cap.close();
  });

  test("samples without a vendor timestamp use the packet timestamp to de-duplicate and receipt time", async () => {
    const f = fakeModule();
    const samples: AdapterSample[] = [];
    const cap = await new PresageSdkAdapter(clock, env, async () => f.mod).open(
      {
        onSample: (s) => samples.push(s),
        onStatus() {},
        onError() {},
      },
    );
    f.handlers.metrics(packet({ value: 70, stable: false }, null), 10);
    f.handlers.metrics(packet({ value: 70, stable: false }, null), 10); // same packet ts
    f.handlers.metrics(packet({ value: 71, stable: true }, null), 20);
    f.handlers.metrics(packet(null, null), 30); // no rates
    expect(samples).toEqual([
      {
        monotonicMs: 1_000,
        pulse: { value: 70, status: "invalid" },
        breathing: null,
      },
      {
        monotonicMs: 1_000,
        pulse: { value: 71, status: "valid" },
        breathing: null,
      },
    ]);
    await cap.close();
  });

  test("a newer breathing clock cannot suppress a later-arriving pulse sample", async () => {
    const f = fakeModule();
    const samples: AdapterSample[] = [];
    const cap = await new PresageSdkAdapter(clock, env, async () => f.mod).open(
      {
        onSample: (sample) => samples.push(sample),
        onStatus() {},
        onError() {},
      },
    );
    const epochUs = clock.wallMs() * 1000;
    f.handlers.metrics(
      packet(null, { value: 16, stable: true, timestamp: epochUs + 2_000_000 }),
      epochUs + 2_000_000,
    );
    f.handlers.metrics(
      packet({ value: 72, stable: true, timestamp: epochUs + 1_000_000 }, null),
      epochUs + 2_100_000,
    );
    expect(samples).toEqual([
      {
        monotonicMs: 3000,
        pulse: null,
        breathing: { value: 16, status: "valid" },
      },
      {
        monotonicMs: 2000,
        pulse: { value: 72, status: "valid" },
        breathing: null,
      },
    ]);
    await cap.close();
  });

  test("every SDK 3.4.0 ValidationCode maps to fixed SiteGuard guidance", async () => {
    const vendor = await import("@smartspectra/node-sdk")
      .then(
        (v) =>
          (v as { ValidationCode?: Record<string, number> }).ValidationCode,
      )
      .catch(() => undefined);
    // The pinned table must match the shipped declarations (checked against the
    // native module when it loads on this platform).
    if (vendor) expect(vendor).toEqual(PINNED_VALIDATION_CODES);
    const names = Object.keys(PINNED_VALIDATION_CODES).filter(
      (n) => n !== "kOk",
    );
    expect(Object.keys(VALIDATION_GUIDANCE).sort()).toEqual([...names].sort());
    for (const name of names) {
      const code =
        PINNED_VALIDATION_CODES[name as keyof typeof PINNED_VALIDATION_CODES];
      const text = guidanceFor(code);
      expect(text).toBe(
        VALIDATION_GUIDANCE[name as keyof typeof VALIDATION_GUIDANCE],
      );
      expect(text.length).toBeLessThanOrEqual(60);
      expect(text).not.toMatch(
        /heart|pulse|breath|health|medical|safe|diagnos|recover/i,
      );
    }
    expect(guidanceFor(5)).toBe("Move somewhere brighter");
    expect(guidanceFor(12)).toBe("Hold still for a moment");
    expect(guidanceFor(99)).toBe(GENERIC_GUIDANCE);
    expect(guidanceFor(-1)).toBe(GENERIC_GUIDANCE);
    expect(GENERIC_GUIDANCE).toBe("Adjust position so your face is centered");
  });

  test("positioning uses SiteGuard guidance, never the vendor hint; warm-up message is sent once", async () => {
    const f = fakeModule({
      validationCodes: { ...PINNED_VALIDATION_CODES, kSomethingNew: 42 },
    });
    const statuses: [string, string | null][] = [];
    const cap = await new PresageSdkAdapter(clock, env, async () => f.mod).open(
      {
        onSample() {},
        onStatus: (s, m) => statuses.push([s, m]),
        onError() {},
      },
    );
    const v = f.handlers.validationStatus;
    v(5, 0, "VENDOR: too dark");
    v(5, 0, "VENDOR: too dark, again"); // same guidance: collapsed
    v(0, 0, "");
    v(12, 0, "VENDOR: motion");
    v(0, 0, "");
    v(42, 0, "VENDOR: new code"); // unknown to SiteGuard
    v(77, 0, "VENDOR: unnamed code"); // unknown to the module too
    v(3, 0, "VENDOR: not centred"); // same text as generic: collapsed
    v(0, 0, "");
    expect(statuses).toEqual([
      ["positioning", "Move somewhere brighter"],
      ["measuring", WARM_UP_MESSAGE],
      ["positioning", "Hold still for a moment"],
      ["measuring", null],
      ["positioning", GENERIC_GUIDANCE],
      ["measuring", null],
    ]);
    expect(JSON.stringify(statuses)).not.toMatch(/VENDOR/);
    await cap.close();
  });

  test("the warm-up message is per capture: a new open announces it again", async () => {
    const f = fakeModule();
    const a = new PresageSdkAdapter(clock, env, async () => f.mod);
    for (let i = 0; i < 2; i++) {
      const statuses: (string | null)[] = [];
      const cap = await a.open({
        onSample() {},
        onStatus: (_s, m) => statuses.push(m),
        onError() {},
      });
      f.handlers.validationStatus(0, 0, "");
      expect(statuses).toEqual([WARM_UP_MESSAGE]);
      await cap.close();
    }
  });

  test("custom input accepts browser RGBA frames without opening a host camera", async () => {
    const f = fakeModule({ cameras: 0 });
    const a = new PresageSdkAdapter(clock, env, async () => f.mod);
    expect((await a.probe("custom")).ready).toBe(true);
    const cap = await a.open(
      { onSample() {}, onStatus() {}, onError() {} },
      "custom",
    );
    cap.sendFrame?.(
      Buffer.alloc(480 * 360 * 4),
      480,
      360,
      1_700_000_000_000_000,
    );
    expect(f.calls).toContain("useCustomInput");
    expect(f.calls).not.toContain("useCamera");
    expect(f.calls).toContain("sendFrame:480:360:1920:2");
    await cap.close();
  });
});
