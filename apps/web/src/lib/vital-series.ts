import type { ReadingEnvelope } from "@siteguard/contracts";

/** Each metric has its own SDK clock and may arrive in a separate packet. */
export function vitalSeries(
  readings: ReadingEnvelope[],
  metric: "pulse" | "breathing",
  startedAt: string,
) {
  const key = metric === "pulse" ? "heartRateBpm" : "respiratoryRateBrpm";
  const other = metric === "pulse" ? "respiratoryRateBrpm" : "heartRateBpm";
  const start = Date.parse(startedAt);
  const relevant = readings
    .filter(({ reading }) => reading[key] !== null || reading[other] === null)
    .slice()
    .sort(
      (a, b) =>
        Date.parse(a.reading.timestamp) - Date.parse(b.reading.timestamp) ||
        a.sequence - b.sequence,
    );
  const observations = relevant.map(({ reading }) => ({
    seconds: (Date.parse(reading.timestamp) - start) / 1000,
    value: reading.quality === "valid" ? reading[key] : null,
  }));
  const data = observations.flatMap((observation, index) => {
    const previous = observations[index - 1];
    return previous && observation.seconds - previous.seconds > 2
      ? [{ seconds: previous.seconds + 1, value: null }, observation]
      : [observation];
  });
  const valid = observations.filter((p) => p.value !== null);
  const last = observations.at(-1);
  return {
    data,
    validCount: valid.length,
    latestValue: last?.value ?? null,
    latestSeconds: last?.seconds ?? null,
  };
}
