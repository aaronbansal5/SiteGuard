import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type {
  Worker,
  Session,
  Break,
  RestRequest,
  Task,
  Assignment,
  Availability,
  Symptom,
  Audit,
  ReadingEnvelope,
  Schedule,
  SelfReport,
} from "@siteguard/contracts";
import { IngestSchema, SelfReportSchema } from "@siteguard/contracts";
import type { Config } from "../config.js";
import { sqliteDriver } from "./sqlite.js";
import { postgresDriver } from "./postgres.js";
import { fail } from "../errors.js";
export interface Driver {
  kind: "sqlite" | "postgres";
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  transaction?<T>(fn: (d: Driver) => Promise<T>): Promise<T>;
}
export interface Entities {
  workers: Worker;
  sessions: Session;
  breaks: Break;
  rest_requests: RestRequest;
  tasks: Task;
  task_assignments: Assignment;
  worker_availability: Availability;
  symptom_reports: Symptom;
  audit_events: Audit;
}
const columns: Record<keyof Entities, string[]> = {
  workers: [],
  sessions: ["workerId", "breakId", "source", "status", "startedAt"],
  breaks: ["workerId", "requestId"],
  rest_requests: ["workerId", "sessionId"],
  tasks: [],
  task_assignments: ["taskId", "workerId"],
  worker_availability: ["workerId"],
  symptom_reports: ["workerId", "sessionId", "assistanceRequestId"],
  audit_events: [],
};
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
export class Repository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public driver: Driver) {}
  async migrate() {
    await this.driver.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    // 002 is the separately-enabled PostgreSQL Timescale migration.
    for (const version of ["001_initial", "003_self_reports"])
      await this.transaction(async (r) => {
        const applied = await r.driver.query(
          "SELECT version FROM schema_migrations WHERE version=$1",
          [version],
        );
        if (applied.length) return;
        await r.driver.exec(
          readFileSync(
            resolve(
              `apps/api/src/db/migrations/${r.driver.kind}/${version}.sql`,
            ),
            "utf8",
          ),
        );
        await r.driver.query(
          "INSERT INTO schema_migrations (version,applied_at) VALUES ($1,$2)",
          [version, new Date().toISOString()],
        );
      });
  }
  /** Worker-only voluntary self-reports, keyed by session. */
  async selfReports(workerId: string): Promise<SelfReport[]> {
    return (
      await this.driver.query(
        "SELECT payload FROM self_reports WHERE worker_id=$1",
        [workerId],
      )
    ).map((r) => SelfReportSchema.parse(JSON.parse(r.payload as string)));
  }
  async putSelfReport(report: SelfReport) {
    const value = SelfReportSchema.parse(report);
    await this.driver.query(
      "INSERT INTO self_reports (session_id,worker_id,payload) VALUES ($1,$2,$3) ON CONFLICT (session_id) DO UPDATE SET worker_id=excluded.worker_id,payload=excluded.payload",
      [value.sessionId, value.workerId, JSON.stringify(value)],
    );
  }
  async deleteSelfReport(sessionId: string) {
    await this.driver.query("DELETE FROM self_reports WHERE session_id=$1", [
      sessionId,
    ]);
  }
  async list<K extends keyof Entities>(table: K): Promise<Entities[K][]> {
    return (await this.driver.query(`SELECT payload FROM ${table}`)).map((r) =>
      JSON.parse(r.payload as string),
    );
  }
  async get<K extends keyof Entities>(
    table: K,
    id: string,
  ): Promise<Entities[K] | undefined> {
    const r = await this.driver.query(
      `SELECT payload FROM ${table} WHERE id=$1`,
      [id],
    );
    return r.length ? JSON.parse(r[0].payload as string) : undefined;
  }
  async put<K extends keyof Entities>(table: K, value: Entities[K]) {
    const extra = columns[table];
    const keys = ["id", ...extra.map(snake), "payload"];
    const v = value as unknown as Record<string, unknown>;
    const params = [value.id, ...extra.map((k) => v[k]), JSON.stringify(value)];
    await this.driver.query(
      `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT (id) DO UPDATE SET ${keys
        .slice(1)
        .map((k) => `${k}=excluded.${k}`)
        .join(",")}`,
      params,
    );
  }
  async clear(table: keyof Entities) {
    await this.driver.query(`DELETE FROM ${table}`);
  }
  async revision() {
    return Number(
      (
        await this.driver.query(
          "SELECT revision FROM schedule_state WHERE id=1",
        )
      )[0].revision,
    );
  }
  async sessionPage(
    workerId: string,
    limit: number,
    cursor?: { startedAt: string; id: string },
    filter?: { source: Session["source"]; since: string; before: string },
  ) {
    const params: unknown[] = [workerId];
    const conditions = ["worker_id=$1"];
    const add = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (cursor) {
      const time = add(cursor.startedAt),
        equalTime = add(cursor.startedAt),
        id = add(cursor.id);
      conditions.push(
        `(started_at < ${time} OR (started_at = ${equalTime} AND id < ${id}))`,
      );
    }
    if (filter) {
      conditions.push(
        `source=${add(filter.source)}`,
        "status='completed'",
        `started_at>=${add(filter.since)}`,
        `started_at<${add(filter.before)}`,
      );
    }
    const rows = await this.driver.query(
      `SELECT payload FROM sessions WHERE ${conditions.join(" AND ")} ORDER BY started_at DESC,id DESC LIMIT ${add(limit)}`,
      params,
    );
    return rows.map((row) => JSON.parse(row.payload as string) as Session);
  }
  async bump() {
    await this.driver.query(
      "UPDATE schedule_state SET revision=revision+1 WHERE id=1",
    );
    return this.revision();
  }
  async schedule(): Promise<Schedule> {
    const [
      workers,
      breaks,
      requests,
      assignments,
      tasks,
      availability,
      scheduleRevision,
    ] = await Promise.all([
      this.list("workers"),
      this.list("breaks"),
      this.list("rest_requests"),
      this.list("task_assignments"),
      this.list("tasks"),
      this.list("worker_availability"),
      this.revision(),
    ]);
    return {
      workers,
      breaks,
      requests,
      assignments,
      tasks,
      availability,
      scheduleRevision,
    };
  }
  async transaction<T>(fn: (r: Repository) => Promise<T>): Promise<T> {
    const run = async () => {
      if (this.driver.transaction)
        return this.driver.transaction((d) => fn(new Repository(d)));
      await this.driver.exec("BEGIN IMMEDIATE");
      try {
        const value = await fn(this);
        await this.driver.exec("COMMIT");
        return value;
      } catch (e) {
        await this.driver.exec("ROLLBACK");
        throw e;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
  async readings(id: string): Promise<ReadingEnvelope[]> {
    const rows = await this.driver.query(
      "SELECT sequence,timestamp,heart_rate_bpm,respiratory_rate_brpm,quality,source FROM vital_readings WHERE session_id=$1 ORDER BY sequence",
      [id],
    );
    return rows.map((r) => ({
      sequence: Number(r.sequence),
      reading: {
        timestamp: new Date(r.timestamp as string).toISOString(),
        heartRateBpm:
          r.heart_rate_bpm === null ? null : Number(r.heart_rate_bpm),
        respiratoryRateBrpm:
          r.respiratory_rate_brpm === null
            ? null
            : Number(r.respiratory_rate_brpm),
        quality: r.quality as "valid" | "invalid" | "unknown",
        source: r.source as "mock" | "presage",
      },
    }));
  }
  async insertReading(id: string, e: ReadingEnvelope) {
    const r = e.reading;
    await this.driver.query(
      "INSERT INTO vital_readings (session_id,timestamp,sequence,heart_rate_bpm,respiratory_rate_brpm,quality,source) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        r.timestamp,
        e.sequence,
        r.heartRateBpm,
        r.respiratoryRateBrpm,
        r.quality,
        r.source,
      ],
    );
    await this.driver.query(
      "INSERT INTO reading_receipts (session_id,sequence,timestamp,digest) VALUES ($1,$2,$3,$4)",
      [id, e.sequence, r.timestamp, digest(e)],
    );
  }
  async ingest(id: string, envelopes: ReadingEnvelope[], now = Date.now()) {
    const parsed = IngestSchema.parse({ readings: envelopes });
    return this.transaction(async (r) => {
      const s = await r.get("sessions", id);
      if (!s) fail(404, "NOT_FOUND", "Session not found");
      if (s.status !== "active")
        fail(409, "SESSION_COMPLETED", "Session is already completed");
      let accepted = 0,
        duplicates = 0;
      for (const e of parsed.readings) {
        if (e.reading.source !== s.source)
          fail(409, "SOURCE_MISMATCH", "Reading source differs from session");
        const t = Date.parse(e.reading.timestamp);
        if (t < Date.parse(s.startedAt) || t > now)
          fail(400, "READING_TIME", "Reading timestamp is outside the session");
        const receipts = await r.driver.query(
          "SELECT digest FROM reading_receipts WHERE session_id=$1 AND sequence=$2",
          [id, e.sequence],
        );
        if (receipts.length) {
          if (receipts[0].digest !== digest(e))
            fail(
              409,
              "REPLAY_CONFLICT",
              "Sequence already has a different reading",
            );
          duplicates++;
        } else {
          await r.insertReading(id, e);
          accepted++;
        }
      }
      return { accepted, duplicates };
    });
  }
  async close() {
    await this.queue;
    await this.driver.close();
  }
}
function digest(e: ReadingEnvelope) {
  return createHash("sha256").update(JSON.stringify(e)).digest("hex");
}
export async function openRepository(config: Config) {
  const r = new Repository(
    config.databaseUrl
      ? await postgresDriver(config.databaseUrl)
      : sqliteDriver(config.sqlitePath),
  );
  try {
    await r.migrate();
    return r;
  } catch (error) {
    await r.close();
    throw error;
  }
}
