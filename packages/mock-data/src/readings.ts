import type { ReadingEnvelope } from "@siteguard/contracts";
export function mockReading(
  start: string,
  sequence: number,
  seed = 0,
  // Synthetic settling-speed multiplier; 1 reproduces the original stream.
  rate = 1,
): ReadingEnvelope {
  const wave = Math.sin(sequence * 0.6 + seed) * 1.2;
  return {
    sequence,
    reading: {
      timestamp: new Date(Date.parse(start) + sequence * 1000).toISOString(),
      heartRateBpm:
        sequence === 25
          ? null
          : Math.round(
              (105 + seed - Math.min(sequence, 60) * 0.31 * rate + wave) * 10,
            ) / 10,
      respiratoryRateBrpm:
        Math.round(
          (23 +
            seed * 0.1 -
            Math.min(sequence, 60) * 0.09 * rate +
            wave * 0.2) *
            10,
        ) / 10,
      quality: sequence >= 20 && sequence <= 24 ? "invalid" : "valid",
      source: "mock",
    },
  };
}
