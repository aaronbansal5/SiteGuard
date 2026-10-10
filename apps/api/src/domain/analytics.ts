import type {
  Session,
  ReadingEnvelope,
  MetricSummary,
  Summary,
  Comparison,
} from "@siteguard/contracts";
export const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b);
  return a.length
    ? (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2
    : null;
};
function metric(
  s: Session,
  readings: ReadingEnvelope[],
  key: "heartRateBpm" | "respiratoryRateBrpm",
): MetricSummary {
  const start = Date.parse(s.startedAt),
    end = Date.parse(s.endedAt || s.startedAt);
  const valid = readings.filter(
    (e) =>
      e.reading.quality === "valid" &&
      e.reading[key] !== null &&
      Date.parse(e.reading.timestamp) >= start &&
      Date.parse(e.reading.timestamp) <= end,
  );
  const initial = valid.filter(
      (e) => Date.parse(e.reading.timestamp) < start + 15000,
    ),
    final = valid.filter((e) => Date.parse(e.reading.timestamp) > end - 15000);
  const enough = (a: ReadingEnvelope[]) =>
    a.length >= 5 &&
    Math.max(...a.map((e) => Date.parse(e.reading.timestamp))) -
      Math.min(...a.map((e) => Date.parse(e.reading.timestamp))) >=
      5000;
  const available =
    end - start >= 45000 &&
    end - 15000 >= start + 15000 &&
    enough(initial) &&
    enough(final);
  const a = available ? median(initial.map((e) => e.reading[key]!)) : null,
    b = available ? median(final.map((e) => e.reading[key]!)) : null;
  return {
    status: available ? "available" : "insufficient_data",
    initialMedian: a,
    finalMedian: b,
    delta: a !== null && b !== null ? Math.round((b - a) * 100) / 100 : null,
    initialCount: initial.length,
    finalCount: final.length,
  };
}
const emptyComparison = (): Comparison => ({
  status: "insufficient_data",
  count: 0,
  historicalMedianDelta: null,
});
export function summarize(s: Session, readings: ReadingEnvelope[]): Summary {
  return {
    sessionId: s.id,
    source: s.source,
    context: s.context,
    durationSeconds: Math.max(
      0,
      (Date.parse(s.endedAt || s.startedAt) - Date.parse(s.startedAt)) / 1000,
    ),
    pulse: metric(s, readings, "heartRateBpm"),
    breathing: metric(s, readings, "respiratoryRateBrpm"),
    pulseComparison: emptyComparison(),
    breathingComparison: emptyComparison(),
    limitations: [
      "Changes describe observations during rest; they do not establish recovery or fitness for work.",
      ...(s.source === "mock"
        ? ["Synthetic demonstration measurements; not real Presage readings."]
        : []),
      ...(s.interruption ? [s.interruption] : []),
    ],
  };
}
const band = (v: number) => (v < 20 ? 0 : v < 30 ? 1 : 2);
export function compare(
  current: Session,
  summary: Summary,
  prior: { session: Session; summary: Summary }[],
): Summary {
  const { workload, temperatureC } = current.context;
  if (workload === null || temperatureC === null) return summary;
  const eligible = prior
    .filter(
      ({ session: s }) =>
        s.id !== current.id &&
        s.workerId === current.workerId &&
        s.source === current.source &&
        s.status === "completed" &&
        s.endedAt !== null &&
        Date.parse(s.endedAt) <= Date.parse(current.startedAt) &&
        Date.parse(s.startedAt) >=
          Date.parse(current.startedAt) - 30 * 86400000 &&
        s.context.workload === workload &&
        s.context.temperatureC !== null &&
        band(s.context.temperatureC) === band(temperatureC),
    )
    .sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt));
  const comparison = (key: "pulse" | "breathing"): Comparison => {
    if (summary[key].status !== "available") return emptyComparison();
    const values = eligible
      .filter((x) => x.summary[key].status === "available")
      .slice(0, 5)
      .map((x) => x.summary[key].delta!);
    return {
      status: values.length >= 3 ? "available" : "insufficient_data",
      count: values.length,
      historicalMedianDelta: values.length >= 3 ? median(values) : null,
    };
  };
  return {
    ...summary,
    pulseComparison: comparison("pulse"),
    breathingComparison: comparison("breathing"),
  };
}
