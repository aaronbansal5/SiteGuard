import { describe, expect, it } from "vitest";
import { fixtureId, mockReading } from "@siteguard/mock-data";
import type { Driver } from "../src/db/repository.js";
import { Repository } from "../src/db/repository.js";
import {
  applicationBuckets,
  timeSeriesEvidence,
} from "../src/domain/timeseries-evidence.js";
import { login, populatedSession, testApp } from "./helpers.js";

describe("time-series evidence", () => {
  it("groups observations into ten-second windows and excludes invalid metrics", () => {
    const startedAt = "2026-10-10T15:00:01.000Z";
    const readings = Array.from({ length: 12 }, (_, index) =>
      mockReading(startedAt, index),
    );
    readings[2].reading.quality = "invalid";
    readings[3].reading.heartRateBpm = null;
    const buckets = applicationBuckets(readings);
    expect(buckets).toHaveLength(2);
    expect(buckets.map((bucket) => bucket.observations)).toEqual([9, 3]);
    expect(buckets[0].validPulseObservations).toBe(7);
    expect(buckets[0].validBreathingObservations).toBe(8);
    expect(buckets[0].averagePulseBpm).not.toBeNull();
  });

  it("uses TimescaleDB time_bucket when vital_readings is a hypertable", async () => {
    const queries: string[] = [];
    const driver: Driver = {
      kind: "postgres",
      async query(sql) {
        queries.push(sql);
        if (sql.includes("pg_extension")) return [{ extversion: "2.30.2" }];
        if (sql.includes("timescaledb_information.hypertables"))
          return [{ n: 1 }];
        if (sql.includes("time_bucket"))
          return [
            {
              bucket_start: "2026-10-10T15:00:00.000Z",
              observations: 10,
              valid_pulse: 8,
              valid_breathing: 7,
              average_pulse: "91.25",
              average_breathing: "19.5",
            },
          ];
        return [];
      },
      async exec() {},
      async close() {},
    };
    const evidence = await timeSeriesEvidence(new Repository(driver), {
      id: fixtureId(9000),
      workerId: fixtureId(1),
      breakId: fixtureId(101),
      source: "presage",
      status: "completed",
      startedAt: "2026-10-10T15:00:00.000Z",
      endedAt: "2026-10-10T15:01:30.000Z",
      context: { workload: null, temperatureC: null },
      consentVersion: "v1",
      shareWithSupervisor: false,
      interruption: null,
    });
    expect(evidence.storage).toEqual({
      database: "postgres",
      timescaleVersion: "2.30.2",
      hypertable: true,
      aggregation: "timescale_time_bucket_10s",
    });
    expect(evidence.totals.pulseCoveragePercent).toBe(80);
    expect(evidence.totals.breathingCoveragePercent).toBe(70);
    expect(
      queries.some((sql) => sql.includes("time_bucket('10 seconds'")),
    ).toBe(true);
  });

  it("protects evidence with the session sharing rules", async () => {
    const { app, repo } = await testApp();
    try {
      const session = await populatedSession(repo);
      const owner = await login(app);
      const other = await login(app, "worker", fixtureId(2));
      const supervisor = await login(app, "supervisor");
      const url = `/api/sessions/${session.id}/timeseries-evidence`;
      const own = await app.inject({ url, headers: { cookie: owner } });
      expect(own.statusCode).toBe(200);
      expect(own.json().evidence.totals.observations).toBe(60);
      expect(own.json().evidence.storage.aggregation).toBe("application_10s");
      expect(
        (await app.inject({ url, headers: { cookie: other } })).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ url, headers: { cookie: supervisor } })).statusCode,
      ).toBe(403);
      await repo.put("sessions", { ...session, shareWithSupervisor: true });
      expect(
        (await app.inject({ url, headers: { cookie: supervisor } })).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });
});
