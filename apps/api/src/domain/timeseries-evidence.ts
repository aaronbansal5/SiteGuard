import {
  TimeSeriesEvidenceSchema,
  type ReadingEnvelope,
  type Session,
  type TimeSeriesBucket,
  type TimeSeriesEvidence,
} from "@siteguard/contracts";
import type { Repository } from "../db/repository.js";

const BUCKET_MS = 10_000;

const finite = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const percent = (valid: number, observations: number) =>
  observations === 0 ? 0 : Math.round((valid / observations) * 1000) / 10;

export function applicationBuckets(
  readings: ReadingEnvelope[],
): TimeSeriesBucket[] {
  const groups = new Map<number, ReadingEnvelope[]>();
  for (const reading of readings) {
    const timestamp = Date.parse(reading.reading.timestamp);
    const start = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
    groups.set(start, [...(groups.get(start) ?? []), reading]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, rows]) => {
      const pulse = rows
        .filter(
          (row) =>
            row.reading.quality === "valid" &&
            row.reading.heartRateBpm !== null,
        )
        .map((row) => row.reading.heartRateBpm!);
      const breathing = rows
        .filter(
          (row) =>
            row.reading.quality === "valid" &&
            row.reading.respiratoryRateBrpm !== null,
        )
        .map((row) => row.reading.respiratoryRateBrpm!);
      const average = (values: number[]) =>
        values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null;
      return {
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + BUCKET_MS).toISOString(),
        observations: rows.length,
        validPulseObservations: pulse.length,
        validBreathingObservations: breathing.length,
        averagePulseBpm: average(pulse),
        averageBreathingBrpm: average(breathing),
      };
    });
}

async function timescaleInfo(repository: Repository) {
  if (repository.driver.kind !== "postgres")
    return { version: null, hypertable: false };
  try {
    const versions = await repository.driver.query(
      "SELECT extversion FROM pg_extension WHERE extname='timescaledb'",
    );
    const version = (versions[0]?.extversion as string | undefined) ?? null;
    if (!version) return { version: null, hypertable: false };
    const rows = await repository.driver.query(
      "SELECT count(*)::int AS n FROM timescaledb_information.hypertables WHERE hypertable_schema=current_schema() AND hypertable_name='vital_readings'",
    );
    return { version, hypertable: Number(rows[0]?.n) === 1 };
  } catch {
    return { version: null, hypertable: false };
  }
}

async function timescaleBuckets(
  repository: Repository,
  session: Session,
): Promise<TimeSeriesBucket[]> {
  const rows = await repository.driver.query(
    `SELECT time_bucket('10 seconds', timestamp) AS bucket_start,
      count(*)::int AS observations,
      count(*) FILTER (WHERE quality='valid' AND heart_rate_bpm IS NOT NULL)::int AS valid_pulse,
      count(*) FILTER (WHERE quality='valid' AND respiratory_rate_brpm IS NOT NULL)::int AS valid_breathing,
      avg(heart_rate_bpm) FILTER (WHERE quality='valid') AS average_pulse,
      avg(respiratory_rate_brpm) FILTER (WHERE quality='valid') AS average_breathing
    FROM vital_readings
    WHERE session_id=$1 AND source=$2
    GROUP BY bucket_start
    ORDER BY bucket_start`,
    [session.id, session.source],
  );
  return rows.map((row) => {
    const start = new Date(row.bucket_start as string).getTime();
    return {
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + BUCKET_MS).toISOString(),
      observations: Number(row.observations),
      validPulseObservations: Number(row.valid_pulse),
      validBreathingObservations: Number(row.valid_breathing),
      averagePulseBpm: finite(row.average_pulse),
      averageBreathingBrpm: finite(row.average_breathing),
    };
  });
}

export async function timeSeriesEvidence(
  repository: Repository,
  session: Session,
): Promise<TimeSeriesEvidence> {
  const timescale = await timescaleInfo(repository);
  const buckets = timescale.hypertable
    ? await timescaleBuckets(repository, session)
    : applicationBuckets(
        (await repository.readings(session.id)).filter(
          (row) => row.reading.source === session.source,
        ),
      );
  const totals = buckets.reduce(
    (value, bucket) => ({
      observations: value.observations + bucket.observations,
      validPulseObservations:
        value.validPulseObservations + bucket.validPulseObservations,
      validBreathingObservations:
        value.validBreathingObservations + bucket.validBreathingObservations,
    }),
    {
      observations: 0,
      validPulseObservations: 0,
      validBreathingObservations: 0,
    },
  );
  return TimeSeriesEvidenceSchema.parse({
    sessionId: session.id,
    source: session.source,
    storage: {
      database: repository.driver.kind,
      timescaleVersion: timescale.version,
      hypertable: timescale.hypertable,
      aggregation: timescale.hypertable
        ? "timescale_time_bucket_10s"
        : "application_10s",
    },
    bucketSeconds: 10,
    totals: {
      ...totals,
      pulseCoveragePercent: percent(
        totals.validPulseObservations,
        totals.observations,
      ),
      breathingCoveragePercent: percent(
        totals.validBreathingObservations,
        totals.observations,
      ),
    },
    buckets,
    limitations: [
      "Coverage describes usable observations, not worker safety or measurement accuracy.",
      "Synthetic and Presage sessions are stored and summarized separately.",
    ],
  });
}
