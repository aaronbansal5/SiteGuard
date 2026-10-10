import type { AdapterSample, MetricObservation } from "./adapter.js";
import type { Quality, VitalReading } from "./contract.js";

/** Monotonic-to-UTC anchor captured once when the camera capture opens. */
export interface ClockAnchor {
  monotonicMs: number;
  wallMs: number;
}

export function toUtc(anchor: ClockAnchor, monotonicMs: number): string {
  return new Date(
    anchor.wallMs + (monotonicMs - anchor.monotonicMs),
  ).toISOString();
}

function rate(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Validity mapping (documented in README):
 *  - quality is taken from the explicit SDK status for that metric;
 *  - a metric whose SDK status is "valid" but which carries no usable number is
 *    downgraded to "unknown" (we cannot call a missing value valid, and we do
 *    not infer "invalid" from numbers either);
 *  - numeric values never upgrade or downgrade a status otherwise.
 */
function quality(m: MetricObservation): Quality {
  if (m.status === "valid" && rate(m.value) === null) return "unknown";
  return m.status;
}

/**
 * Convert one adapter sample into contract readings. When pulse and breathing
 * validity differ, emit separate readings with the other rate null (contract).
 */
export function normalizeSample(
  anchor: ClockAnchor,
  sample: AdapterSample,
): VitalReading[] {
  const timestamp = toUtc(anchor, sample.monotonicMs);
  const { pulse, breathing } = sample;
  const reading = (
    hr: MetricObservation | null,
    rr: MetricObservation | null,
    q: Quality,
  ): VitalReading => ({
    timestamp,
    heartRateBpm: hr ? rate(hr.value) : null,
    respiratoryRateBrpm: rr ? rate(rr.value) : null,
    quality: q,
    source: "presage",
  });
  if (pulse && breathing) {
    const qp = quality(pulse);
    const qb = quality(breathing);
    if (qp === qb) return [reading(pulse, breathing, qp)];
    return [reading(pulse, null, qp), reading(null, breathing, qb)];
  }
  if (pulse) return [reading(pulse, null, quality(pulse))];
  if (breathing) return [reading(null, breathing, quality(breathing))];
  return [];
}
