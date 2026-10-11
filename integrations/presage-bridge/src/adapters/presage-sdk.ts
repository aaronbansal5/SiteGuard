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
 *    input is good -> "measuring"; any other code -> "positioning" with a
 *    fixed SiteGuard guidance message per ValidationCode (VALIDATION_GUIDANCE).
 *    The vendor hint text is never forwarded (debug log only). The first
 *    "measuring" status carries a one-time warm-up message.
 *  - 'error' (code, message, retryable): passed through with the vendor's
 *    retryable flag; code is reported by its SmartSpectraErrorCode name.
 */

const SDK_PACKAGE = "@smartspectra/node-sdk";
const START_TIMEOUT_MS = 45_000;

/**
 * ValidationCode names/values as shipped in @smartspectra/node-sdk 3.4.0
 * (js/index.d.ts). Used only when the loaded module does not expose a name
 * for a code.
 */
export const PINNED_VALIDATION_CODES = {
  kOk: 0,
  kNoFaceFound: 1,
  kMultipleFacesFound: 2,
  kFaceNotCentered: 3,
  kFaceSizeOutOfRange: 4,
  kTooDark: 5,
  kTooBright: 6,
  kChestNotVisible: 7,
  kCameraTuning: 10,
  kFrameRateTooLow: 11,
  kExcessiveMotion: 12,
  kFaceTooClose: 13,
  kFaceTooFar: 14,
  kFaceTooHigh: 15,
  kFaceTooLow: 16,
  kFaceNotForward: 17,
} as const;

type PositioningCode = Exclude<keyof typeof PINNED_VALIDATION_CODES, "kOk">;

/**
 * Fixed, SiteGuard-owned positioning guidance per vendor ValidationCode.
 * Short, non-clinical camera/posture instructions only.
 */
export const VALIDATION_GUIDANCE: Record<PositioningCode, string> = {
  kNoFaceFound: "Sit facing the camera so your face is visible",
  kMultipleFacesFound: "Only one person should be in view",
  kFaceNotCentered: "Adjust position so your face is centered",
  kFaceSizeOutOfRange: "Adjust your distance from the camera",
  kTooDark: "Move somewhere brighter",
  kTooBright: "Avoid bright light behind you",
  kChestNotVisible: "Sit back so your upper chest is visible",
  kCameraTuning: "Camera is adjusting, one moment",
  kFrameRateTooLow: "Add light or close other apps",
  kExcessiveMotion: "Hold still for a moment",
  kFaceTooClose: "Move back from the camera",
  kFaceTooFar: "Move closer to the camera",
  kFaceTooHigh: "Move down a little",
  kFaceTooLow: "Move up a little",
  kFaceNotForward: "Face the camera directly",
};

/** Guidance for a code with no entry above (new or unknown vendor code). */
export const GENERIC_GUIDANCE = "Adjust position so your face is centered";

/** Sent once per capture, the first time the input becomes good. */
export const WARM_UP_MESSAGE =
  "Measuring — readings become reliable after about 30–45 seconds";

/** Maps a vendor ValidationCode value to SiteGuard guidance text. */
export function guidanceFor(
  code: number,
  names: Readonly<Record<string, number>> = PINNED_VALIDATION_CODES,
): string {
  const name =
    Object.entries(names).find(([, v]) => v === code)?.[0] ??
    Object.entries(PINNED_VALIDATION_CODES).find(([, v]) => v === code)?.[0];
  return (
    (name && Object.hasOwn(VALIDATION_GUIDANCE, name)
      ? VALIDATION_GUIDANCE[name as PositioningCode]
      : undefined) ?? GENERIC_GUIDANCE
  );
}

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
  ValidationCode: { kOk: number } & Readonly<Record<string, number>>;
  SmartSpectraErrorCode: Record<string, number>;
  CameraSelection: { default: unknown };
  PixelFormat: { kRGBA: number };
  decodeMetrics(buf: Buffer): unknown;
}

interface VendorSdk {
  on(event: string, cb: (...args: never[]) => void): unknown;
  useCamera(selection: unknown): unknown;
  useCustomInput(): unknown;
  sendFrame(
    frame: Buffer,
    width: number,
    height: number,
    stride: number,
    format: number,
    timestampUs: number,
  ): unknown;
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

  async probe(mode: "camera" | "custom" = "camera"): Promise<AdapterProbe> {
    if (!this.apiKey())
      return { ready: false, reason: "SMARTSPECTRA_API_KEY is not set" };
    let m: SmartSpectraModule;
    try {
      m = await this.module();
    } catch (e) {
      return { ready: false, reason: (e as Error).message };
    }
    if (mode === "custom") return { ready: true, reason: null };
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

  async open(
    handlers: AdapterHandlers,
    mode: "camera" | "custom" = "camera",
  ): Promise<AdapterCapture> {
    const apiKey = this.apiKey();
    if (!apiKey)
      throw new SdkNotVerifiedError("SMARTSPECTRA_API_KEY is not set");
    if (this.open_) throw new Error("Camera already in use by this bridge");
    const m = await this.module();
    const debug = this.env.PRESAGE_DEBUG === "1";
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
    let lastPulseKey = 0;
    let lastBreathingKey = 0;
    let lastStatus = "";
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
      if (debug) console.error(`[presage-sdk] processing status=${status}`);
      if (status === m.ProcessingStatus.kRunning) settle();
      else if (status === m.ProcessingStatus.kError)
        settle(new Error("SmartSpectra entered error state while starting"));
    }) as never);
    let warmUpAnnounced = false;
    sdk.on("validationStatus", ((code: number, _ts: number, hint: string) => {
      settle(); // the pipeline is running once it reports input feedback
      // The SDK reports validation on every frame; forward only changes.
      // Vendor hint text is not forwarded: guidance is SiteGuard-owned.
      const measuring = code === m.ValidationCode.kOk;
      const message = measuring ? null : guidanceFor(code, m.ValidationCode);
      const next = measuring ? "measuring|" : `positioning|${message}`;
      if (next === lastStatus) return;
      lastStatus = next;
      if (debug)
        console.error(`[presage-sdk] validation code=${code} hint=${hint}`);
      if (measuring) {
        handlers.onStatus(
          "measuring",
          warmUpAnnounced ? null : WARM_UP_MESSAGE,
        );
        warmUpAnnounced = true;
      } else handlers.onStatus("positioning", message);
    }) as never);
    sdk.on("error", ((code: number, message: string, retryable: boolean) => {
      if (debug)
        console.error(
          `[presage-sdk] error code=${errorName(code)} retryable=${retryable} message=${message}`,
        );
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
      const fallback = Number.isFinite(packetUs) ? packetUs : 0;
      const pulseUs = p ? tsUs(p) : null;
      const breathingUs = b ? tsUs(b) : null;
      const pulseKey = pulseUs ?? fallback;
      const breathingKey = breathingUs ?? fallback;
      const newPulse = p && pulseKey > lastPulseKey;
      const newBreathing = b && breathingKey > lastBreathingKey;
      if (!newPulse && !newBreathing) return;
      if (newPulse) lastPulseKey = pulseKey;
      if (newBreathing) lastBreathingKey = breathingKey;
      // Each metric has its own clock. A breathing packet can be newer than
      // pulse without suppressing a pulse sample arriving in the next packet.
      const monotonic = (sampleUs: number | null) =>
        sampleUs
          ? this.clock.monotonicMs() + (sampleUs / 1000 - this.clock.wallMs())
          : this.clock.monotonicMs();
      if (newPulse && newBreathing && pulseKey === breathingKey) {
        handlers.onSample({
          monotonicMs: monotonic(pulseUs ?? breathingUs),
          pulse: observation(p),
          breathing: observation(b),
        });
      } else {
        if (newPulse)
          handlers.onSample({
            monotonicMs: monotonic(pulseUs),
            pulse: observation(p),
            breathing: null,
          });
        if (newBreathing)
          handlers.onSample({
            monotonicMs: monotonic(breathingUs),
            pulse: null,
            breathing: observation(b),
          });
      }
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
      if (mode === "custom") sdk.useCustomInput();
      else sdk.useCamera(m.CameraSelection.default);
      sdk.start();
      // A custom-input pipeline cannot emit validation or metrics before the
      // browser receives its session ID and submits the first frame.
      if (mode === "custom")
        return {
          close,
          sendFrame: (frame, width, height, timestampUs) => {
            if (closed) throw new Error("Capture is stopped");
            try {
              if (
                sdk.sendFrame(
                  frame,
                  width,
                  height,
                  width * 4,
                  m.PixelFormat.kRGBA,
                  timestampUs,
                ) === false
              )
                throw new Error("SmartSpectra rejected the camera frame");
            } catch (error) {
              const status = (sdk as { processingStatus?: number })
                .processingStatus;
              throw new Error(
                `SmartSpectra frame rejected in state ${status ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          },
        };
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
