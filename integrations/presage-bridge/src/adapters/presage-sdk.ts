import type {
  AdapterCapture,
  AdapterHandlers,
  AdapterProbe,
  Clock,
  SdkAdapter,
} from "../adapter.js";

/**
 * PRESAGE SMARTSPECTRA SDK ADAPTER -- NOT IMPLEMENTED (UNVERIFIED).
 *
 * No SDK package, credentials, or camera were available when this bridge was
 * written, so this adapter deliberately reports itself unavailable and refuses
 * to open. It must not be made to "succeed" until every TODO below has been
 * verified against the current vendor documentation
 * (https://smartspectra.presagetech.com/docs/nodejs/) and an observed camera
 * session. No vendor method or field names are assumed here.
 *
 * TODO(presage-sdk): add the vendor-documented Node package to this
 *   package.json (record exact version) and load it here.
 * TODO(presage-sdk): read the vendor API key from the bridge process
 *   environment only (never from the app/browser); document the variable.
 * TODO(presage-sdk): probe(): report ready only when the SDK is loaded, the key
 *   is configured, and a camera is available/permitted; otherwise return a
 *   human-readable reason.
 * TODO(presage-sdk): open(): acquire exactly one camera and start measuring;
 *   reject (and release everything) on any failure.
 * TODO(presage-sdk): for every decoded SDK output, call handlers.onSample with
 *   an AdapterSample:
 *     - monotonicMs: the observation time converted to clock.monotonicMs()
 *       (document the SDK's original timestamp semantics and conversion);
 *     - pulse.value: the SDK's decoded pulse rate in beats/min, unmodified;
 *     - pulse.status: mapped ONLY from an explicit SDK status/confidence field
 *       for pulse ("unknown" if none is documented);
 *     - breathing.value / breathing.status: same for breathing rate in
 *       breaths/min;
 *     - pulse/breathing null when the SDK did not deliver that metric.
 * TODO(presage-sdk): map vendor face/positioning feedback to
 *   handlers.onStatus("positioning" | "measuring", message).
 * TODO(presage-sdk): map vendor errors to handlers.onError(code, message,
 *   retryable) with documented retryability.
 * TODO(presage-sdk): AdapterCapture.close(): stop processing and release the
 *   camera; idempotent; resolve only after release is confirmed.
 * TODO(presage-sdk): document vendor processing, upload/telemetry and data
 *   retention behaviour before real use.
 */
export class SdkNotVerifiedError extends Error {
  readonly code = "SDK_NOT_VERIFIED";
  constructor() {
    super(
      "Presage SmartSpectra SDK is not installed or verified in this bridge (UNVERIFIED). " +
        "See integrations/presage-bridge/README.md 'What remains'.",
    );
    this.name = "SdkNotVerifiedError";
  }
}

export class PresageSdkAdapter implements SdkAdapter {
  readonly kind = "presage-sdk" as const;
  // Kept so the verified implementation receives the bridge clock.
  constructor(readonly clock: Clock) {}
  async probe(): Promise<AdapterProbe> {
    return { ready: false, reason: new SdkNotVerifiedError().message };
  }
  async open(_handlers: AdapterHandlers): Promise<AdapterCapture> {
    throw new SdkNotVerifiedError();
  }
}
