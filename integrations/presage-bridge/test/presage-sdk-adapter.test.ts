import { describe, expect, test } from "vitest";
import {
  PresageSdkAdapter,
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
    ValidationCode: { kOk: 0 },
    SmartSpectraErrorCode: {
      kOk: 0,
      kAuthenticationFailed: 2,
      kInputUnavailable: 7,
    },
    CameraSelection: { default: { kind: "default" } },
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
      ["positioning", "Face not found"],
      ["measuring", null],
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
});
