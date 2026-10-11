/**
 * VENDOR SDK BOUNDARY.
 *
 * Everything that touches the Presage SmartSpectra SDK must live behind
 * `SdkAdapter`. The bridge server never sees vendor types; it only sees the
 * normalized, adapter-level shapes below. Nothing in this file is a Presage
 * SDK API: these are SiteGuard-owned types that a verified adapter fills in.
 */

/**
 * Per-metric validity as reported by an EXPLICIT SDK status/confidence field.
 *
 * Adapters must derive this ONLY from an explicit vendor status field whose
 * semantics have been verified against vendor documentation. If the SDK
 * provides no such field for a metric (or its meaning is unverified), the
 * adapter must report "unknown". Adapters must never derive "valid" or
 * "invalid" from the numeric value (range checks, plausibility, smoothing).
 */
export type SdkMetricStatus = "valid" | "invalid" | "unknown";

export interface MetricObservation {
  /** Rate as decoded by the SDK, unmodified. May be null/NaN if the SDK had none. */
  value: number | null;
  /** Explicit SDK-reported validity, mapped as described on SdkMetricStatus. */
  status: SdkMetricStatus;
}

export interface AdapterSample {
  /**
   * Time the observation applies to, expressed on the bridge's monotonic clock
   * (the same `Clock.monotonicMs()` passed to the adapter). The adapter is
   * responsible for converting the SDK's own timing semantics to this clock
   * and documenting that conversion.
   */
  monotonicMs: number;
  /** Pulse (heart rate, beats/min). null = SDK delivered no pulse in this sample. */
  pulse: MetricObservation | null;
  /** Breathing (respiratory rate, breaths/min). null = not delivered in this sample. */
  breathing: MetricObservation | null;
}

export interface AdapterHandlers {
  /** Optional in-memory JPEG preview from the same capture; never a reading. */
  onPreview?(jpeg: Buffer): void;
  onSample(sample: AdapterSample): void;
  /** "stopped" is owned by the bridge and is emitted on stop, not by adapters. */
  onStatus(state: "positioning" | "measuring", message: string | null): void;
  onError(code: string, message: string, retryable: boolean): void;
}

/** A live camera capture. Exactly one may exist at a time. */
export interface AdapterCapture {
  /** Stop measuring and release the camera. Must be idempotent. */
  close(): Promise<void>;
  /** Only present for explicitly selected custom-input sessions. */
  sendFrame?(
    frame: Buffer,
    width: number,
    height: number,
    timestampUs: number,
  ): void;
}

export interface AdapterProbe {
  ready: boolean;
  reason: string | null;
}

export interface SdkAdapter {
  /** Used for logs and health reasons only. */
  readonly kind: "fixture" | "presage-sdk";
  /** Cheap readiness check (SDK loaded, key configured, camera enumerable). */
  probe(mode?: "camera" | "custom"): Promise<AdapterProbe>;
  /** Acquire the camera and begin measuring. Rejects if it cannot. */
  open(
    handlers: AdapterHandlers,
    mode?: "camera" | "custom",
  ): Promise<AdapterCapture>;
}

export interface Clock {
  monotonicMs(): number;
  wallMs(): number;
}

export const systemClock: Clock = {
  monotonicMs: () => performance.now(),
  wallMs: () => Date.now(),
};
