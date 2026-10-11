import { expect, it } from "vitest";
import type { ReadingEnvelope } from "@siteguard/contracts";
import { vitalSeries } from "./vital-series";

const start = "2026-10-11T00:00:00.000Z";
function packet(
  sequence: number,
  seconds: number,
  pulse: number | null,
  breathing: number | null,
  quality: "valid" | "invalid" = "valid",
): ReadingEnvelope {
  return {
    sequence,
    reading: {
      timestamp: new Date(Date.parse(start) + seconds * 1000).toISOString(),
      heartRateBpm: pulse,
      respiratoryRateBrpm: breathing,
      quality,
      source: "presage",
    },
  };
}

it("keeps each metric continuous when separate packets are interleaved", () => {
  const readings = [
    packet(0, 1, 72, null),
    packet(1, 1, null, 18),
    packet(2, 2, 73, null),
    packet(3, 2, null, 17),
  ];
  expect(vitalSeries(readings, "pulse", start)).toMatchObject({
    latestValue: 73,
    validCount: 2,
    data: [
      { seconds: 1, value: 72 },
      { seconds: 2, value: 73 },
    ],
  });
  expect(vitalSeries(readings, "breathing", start)).toMatchObject({
    latestValue: 17,
    validCount: 2,
  });
});

it("retains invalid metric gaps without letting the other metric clear the value", () => {
  const readings = [
    packet(0, 1, 72, null),
    packet(1, 2, 75, null, "invalid"),
    packet(2, 2, null, 18),
  ];
  expect(vitalSeries(readings, "pulse", start)).toMatchObject({
    latestValue: null,
    data: [
      { seconds: 1, value: 72 },
      { seconds: 2, value: null },
    ],
  });
});

it("sorts by metric timestamps, keeps subsecond precision, and marks real time gaps", () => {
  const readings = [packet(0, 5.4, 74, null), packet(1, 1.2, 72, null)];
  expect(vitalSeries(readings, "pulse", start)).toMatchObject({
    latestValue: 74,
    data: [
      { seconds: 1.2, value: 72 },
      { seconds: 2.2, value: null },
      { seconds: 5.4, value: 74 },
    ],
  });
});
