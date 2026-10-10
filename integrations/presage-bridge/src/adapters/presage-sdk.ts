import type {
  AdapterCapture,
  AdapterHandlers,
  AdapterProbe,
  Clock,
  MetricObservation,
  SdkAdapter,
  SdkMetricStatus,
} from "../adapter.js";

/**
 * PRESAGE SMARTSPECTRA SDK ADAPTER (@smartspectra/node-sdk, pinned 3.4.0).
 *
 * Written against the vendor's shipped type declarations and docs
 * (https://smartspectra.presagetech.com/docs/nodejs, /docs/data-types).
 * Unit-tested with a fake SDK module. A live camera session has NOT yet been
 * observed — see README "What remains".
 *
 * Vendor facts this adapter relies on (from the SDK's own .d.ts / docs):
 *  - API key: `new SmartSpectraSDK({ apiKey })`; read here from
 *    SMARTSPECTRA_API_KEY in the bridge process env only.
 *  - Metrics are computed on-device; the network is used only to validate the
 *    key/subscription. Telemetry defaults ON; we pass enableTelemetry:false.
 *  - We request only MetricType.PULSE_RATE and MetricType.BREATHING_RATE.
 *  - 'metrics' events carry a protobuf buffer; decodeMetrics(buf) yields
 *    `cardio.pulseRate[]` / `breathing.rate[]`, arrays of
 *    MeasurementWithConfidence { value, confidence (0-100), stable, timestamp }.
 *    `timestamp` is microseconds since the Unix epoch (wall clock).
 *  - `stable` is the vendor's explicit reliability flag (confidence >= 40 for
 *    pulse, >= 45 for breathing). Validity is mapped ONLY from it:
 *      stable === true  -> "valid"
 *      stable === false -> "invalid"
 *      missing          -> "unknown"
 *    The numeric value never changes the status.
 *  - 'validationStatus' (code, tsUs, hint): ValidationCode.kOk (0) means the
 *    input is good -> "measuring"; any other code -> "positioning" + hint.
 *  - 'error' (code, message, retryable): passed through with the vendor's
 *    retryable flag; code is reported by its SmartSpectraErrorCode name.
 */

const SDK_PACKAGE = "@smartspectra/node-sdk";
const START_TIMEOUT_MS = 45_000;

/** Minimal structural view of the vendor module that this adapter uses. */
export interface SmartSpectraModule {
  SmartSpectraSDK: {
    new (options: {
      apiKey?: string;
      requestedMetrics?: number[];
      enableTelemetry?: boolean;
    }): VendorSdk;
    readonly version: string;
    availableCameras(): readonly { id: string; name: string | null }[];
  };
  MetricType: { PULSE_RATE: number; BREATHING_RATE: number };
  ProcessingStatus: { kRunning: number; kError: number };
  ValidationCode: { kOk: number };
  SmartSpectraErrorCode: Record<string, number>;
  CameraSelection: { default: unknown };
  decodeMetrics(buf: Buffer): unknown;
}

interface VendorSdk {
  on(event: string, cb: (...args: never[]) => void): unknown;
  useCamera(selection: unknown): unknown;
  start(): void;
  stopAsync(): Promise<void>;
  destroy(): Promise<void>;
}

interface VendorMeasurement {
  value?: number | null;
  stable?: boolean | null;
  timestamp?: number | { toNumber(): number } | null;
}

export class SdkNotVerifiedError extends Error {
  readonly code = "SDK_NOT_VERIFIED";
  constructor(message?: string) {
    super(
      message ??
        "Presage SmartSpectra SDK is not available in this bridge. See integrations/presage-bridge/README.md.",
    );
    this.name = "SdkNotVerifiedError";
  }
}

export function statusFromStable(m: VendorMeasurement): SdkMetricStatus {
  if (m.stable === true) return "valid";
  if (m.stable === false) return "invalid";
  return "unknown";
}

function tsUs(m: VendorMeasurement): number | null {
  const t = m.timestamp;
  if (t === null || t === undefined) return null;
  const n = typeof t === "number" ? t : t.toNumber();
  return Number.isFinite(n) && n > 0 ? n : null;
}

function latest(list: unknown): VendorMeasurement | null {
  return Array.isArray(list) && list.length
    ? (list[list.length - 1] as VendorMeasurement)
    : null;
}

function observation(m: VendorMeasurement | null): MetricObservation | null {
  if (!m) return null;
  const v = m.value;
  return {
    value: typeof v === "number" ? v : null,
    status: statusFromStable(m),
  };
}

export class PresageSdkAdapter implements SdkAdapter {
  readonly kind = "presage-sdk" as const;
  private open_ = false;

  constructor(
    readonly clock: Clock,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly load: () => Promise<SmartSpectraModule> = async () =>
      (await import(SDK_PACKAGE)) as unknown as SmartSpectraModule,
  ) {}

  private apiKey(): string | undefined {
    const k = this.env.SMARTSPECTRA_API_KEY?.trim();
    return k ? k : undefined;
  }

  private async module(): Promise<SmartSpectraModule> {
    try {
      return await this.load();
    } catch {
      throw new SdkNotVerifiedError(
        `${SDK_PACKAGE} could not be loaded on this platform (run npm install in integrations/presage-bridge).`,
      );
    }
  }

  async probe(): Promise<AdapterProbe> {
    if (!this.apiKey())
      return { ready: false, reason: "SMARTSPECTRA_API_KEY is not set" };
    let m: SmartSpectraModule;
    try {
      m = await this.module();
    } catch (e) {
      return { ready: false, reason: (e as Error).message };
    }
    try {
      const cams = m.SmartSpectraSDK.availableCameras();
      if (!cams.length)
        return {
          ready: false,
          reason: "No camera found (check OS camera permission)",
        };
    } catch {
      // Discovery unsupported on this platform: let start() report the outcome.
    }
    return { ready: true, reason: null };
  }

  async open(handlers: AdapterHandlers): Promise<AdapterCapture> {
    const apiKey = this.apiKey();
    if (!apiKey)
      throw new SdkNotVerifiedError("SMARTSPECTRA_API_KEY is not set");
    if (this.open_) throw new Error("Camera already in use by this bridge");
    const m = await this.module();
    const errorName = (code: number) =>
      Object.entries(m.SmartSpectraErrorCode).find(
        ([, v]) => v === code,
      )?.[0] ?? `SDK_ERROR_${code}`;

    const sdk = new m.SmartSpectraSDK({
      apiKey,
      requestedMetrics: [m.MetricType.PULSE_RATE, m.MetricType.BREATHING_RATE],
      enableTelemetry: false,
    });
    this.open_ = true;
    let lastKey = 0;
    let lastStatus = "";
    const debug = this.env.PRESAGE_DEBUG === "1";
    let closed = false;

    // Started = first of: processingStatus kRunning, first validation feedback,
    // first metrics packet, or processingStatus property polled as kRunning.
    // (Observed on macOS: the camera and pipeline run without a
    // processingStatus kRunning event reaching the callback.)
    let settled = false;
    let settle!: (err?: Error) => void;
    const started = new Promise<void>((resolve, reject) => {
      settle = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
    });

    sdk.on("processingStatus", ((status: number) => {
      if (status === m.ProcessingStatus.kRunning) settle();
      else if (status === m.ProcessingStatus.kError)
        settle(new Error("SmartSpectra entered error state while starting"));
    }) as never);
    sdk.on("validationStatus", ((code: number, _ts: number, hint: string) => {
      settle(); // the pipeline is running once it reports input feedback
      // The SDK reports validation on every frame; forward only changes.
      const next =
        code === m.ValidationCode.kOk
          ? "measuring|"
          : `positioning|${hint || ""}`;
      if (next === lastStatus) return;
      lastStatus = next;
      if (code === m.ValidationCode.kOk) handlers.onStatus("measuring", null);
      else handlers.onStatus("positioning", hint || null);
    }) as never);
    sdk.on("error", ((code: number, message: string, retryable: boolean) => {
      settle(new Error(`${errorName(code)}: ${message}`));
      handlers.onError(errorName(code), message, retryable);
    }) as never);
    sdk.on("metrics", ((buf: Buffer, packetUs: number) => {
      settle();
      if (closed) return;
      let decoded: unknown;
      try {
        decoded = m.decodeMetrics(buf);
      } catch {
        handlers.onError("DECODE_FAILED", "Could not decode SDK metrics", true);
        return;
      }
      if (!decoded || Buffer.isBuffer(decoded)) return;
      const d = decoded as {
        cardio?: { pulseRate?: unknown };
        breathing?: { rate?: unknown };
      };
      const p = latest(d.cardio?.pulseRate);
      const b = latest(d.breathing?.rate);
      if (debug)
        console.error(
          `[presage-sdk] packet ts=${packetUs} pulse=${JSON.stringify(p)} breathing=${JSON.stringify(b)}`,
        );
      if (!p && !b) return; // no rate in this packet
      const sampleUs = Math.max(p ? (tsUs(p) ?? 0) : 0, b ? (tsUs(b) ?? 0) : 0);
      // Identity for de-duplication: the sample timestamp when the SDK sets
      // one, otherwise the packet timestamp from the 'metrics' event.
      const key = sampleUs || (Number.isFinite(packetUs) ? packetUs : 0);
      if (!key || key <= lastKey) return; // nothing new in this packet
      lastKey = key;
      // Sample timestamps are wall-clock epoch µs (vendor data-types docs);
      // convert to the bridge monotonic clock. Without one, use receipt time.
      const monotonicMs = sampleUs
        ? this.clock.monotonicMs() + (sampleUs / 1000 - this.clock.wallMs())
        : this.clock.monotonicMs();
      handlers.onSample({
        monotonicMs,
        pulse: observation(p),
        breathing: observation(b),
      });
    }) as never);

    const close = async () => {
      if (closed) return;
      closed = true;
      try {
        await sdk.stopAsync();
      } finally {
        await sdk.destroy();
        this.open_ = false;
      }
    };

    try {
      sdk.useCamera(m.CameraSelection.default);
      sdk.start();
      const poll = setInterval(() => {
        const st = (sdk as { processingStatus?: number }).processingStatus;
        if (st === m.ProcessingStatus.kRunning) settle();
      }, 250);
      poll.unref();
      await Promise.race([
        started.finally(() => clearInterval(poll)),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("SmartSpectra did not start within 45 s")),
            START_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
    } catch (e) {
      await close().catch(() => undefined);
      throw e;
    }
    return { close };
  }
}
