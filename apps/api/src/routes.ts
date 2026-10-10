import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  BridgeHealthSchema,
  LoginSchema,
  StartSessionSchema,
  IngestSchema,
  NewRequestSchema,
  NewSymptomSchema,
  RequestActionSchema,
  BreakUpdateSchema,
  CommitSchema,
  ExplainSchema,
  EmptySchema,
  HistoryQuerySchema,
  SelfReportInputSchema,
  PersonalTrendQuerySchema,
  Id,
  type Session,
  type RestRequest,
  type Symptom,
} from "@siteguard/contracts";
import type { Repository } from "./db/repository.js";
import type { Config } from "./config.js";
import type { MeasurementManager } from "./measurement/manager.js";
import { identity, worker, supervisor } from "./auth.js";
import { fail } from "./errors.js";
import { sessionSummary } from "./domain/sessions.js";
import {
  planSchedule,
  coverageGaps,
  validateAssignments,
} from "./domain/scheduling.js";
import { audit } from "./domain/requests.js";
import { Explainer, scheduleFacts, sessionFacts } from "./insights/explain.js";
import { personalInsights, personalTrend } from "./domain/personal.js";
import { seed } from "./db/seed.js";
export async function registerRoutes(
  app: FastifyInstance,
  r: Repository,
  c: Config,
  manager: MeasurementManager,
) {
  const explainer = new Explainer(c);
  const identityStreams = new Map<string, number>();
  const workerStreams = new Map<string, number>();
  let totalStreams = 0;
  const id = (req: FastifyRequest) =>
    Id.parse((req.params as { id: string }).id);
  const access = async (
    req: FastifyRequest,
    sessionId: string,
    write = false,
  ) => {
    const a = identity(req),
      s = await r.get("sessions", sessionId);
    if (!s) fail(404, "NOT_FOUND", "Session not found");
    if (a.role === "worker") {
      if (a.workerId !== s.workerId)
        fail(403, "FORBIDDEN", "This session belongs to another worker");
    } else if (write || !s.shareWithSupervisor)
      fail(403, "FORBIDDEN", "Worker sharing consent is required");
    return s;
  };
  const linkedSession = async (workerId: string, sessionId: string | null) => {
    if (sessionId) {
      const s = await r.get("sessions", sessionId);
      if (!s || s.workerId !== workerId)
        fail(403, "FORBIDDEN", "Session is not owned by this worker");
    }
  };
  app.get("/api/health", async () => {
    await r.driver.query("SELECT 1");
    return {
      status: "ok",
      database: r.driver.kind,
      measurementSources: {
        mock: c.demoMode,
        presage: !c.hosted && Boolean(c.bridgeToken),
      },
      insightsMode:
        c.geminiKey && c.geminiModel ? "configured" : "deterministic",
    };
  });
  // Supervisor-only integration status. Never returns secrets or URLs.
  app.get("/api/integrations", async (req) => {
    supervisor(req);
    const database: {
      kind: string;
      timescaleVersion: string | null;
      hypertable: boolean;
    } = { kind: r.driver.kind, timescaleVersion: null, hypertable: false };
    if (r.driver.kind === "postgres") {
      try {
        const ext = (await r.driver.query(
          "SELECT extversion FROM pg_extension WHERE extname='timescaledb'",
        )) as { extversion: string }[];
        database.timescaleVersion = ext[0]?.extversion ?? null;
        if (database.timescaleVersion) {
          const h = (await r.driver.query(
            "SELECT count(*)::int AS n FROM timescaledb_information.hypertables WHERE hypertable_name='vital_readings'",
          )) as { n: number }[];
          database.hypertable = Number(h[0]?.n) === 1;
        }
      } catch {
        // Status is best-effort; health of the core DB is reported by /api/health.
      }
    }
    let bridge: { status: string; reason: string | null } = {
      status: c.hosted ? "disabled_hosted" : "not_configured",
      reason: null,
    };
    if (!c.hosted && c.bridgeToken) {
      try {
        const res = await fetch(new URL("/v1/health", c.bridgeUrl), {
          headers: { Authorization: `Bearer ${c.bridgeToken}` },
          redirect: "error",
          signal: AbortSignal.timeout(2000),
        });
        const h = BridgeHealthSchema.parse(await res.json());
        bridge = { status: h.status, reason: h.reason };
      } catch {
        bridge = { status: "unreachable", reason: "Bridge is not running" };
      }
    }
    return {
      database,
      insights: {
        mode: c.geminiKey && c.geminiModel ? "configured" : "deterministic",
        model: c.geminiKey ? (c.geminiModel ?? null) : null,
        lastOrigin: explainer.lastOrigin ?? null,
        lastAt: explainer.lastAt ?? null,
        lastFallbackReason:
          explainer.lastOrigin === "deterministic"
            ? (explainer.lastFallbackReason ?? null)
            : null,
      },
      presage: bridge,
    };
  });
  app.get("/api/workers", async (req) => {
    if (!c.demoMode) supervisor(req);
    return { workers: await r.list("workers") };
  });
  app.post("/api/demo/login", async (req, reply) => {
    if (!c.demoMode) fail(403, "DEMO_DISABLED", "Demo login is disabled");
    const a = LoginSchema.parse(req.body);
    if (a.role === "worker" && !(await r.get("workers", a.workerId)))
      fail(404, "NOT_FOUND", "Worker not found");
    reply.setCookie(
      "siteguard",
      JSON.stringify({ identity: a, expiresAt: Date.now() + 86400000 }),
      {
        signed: true,
        httpOnly: true,
        sameSite: "strict",
        secure: c.hosted,
        path: "/",
        maxAge: 86400,
      },
    );
    return a;
  });
  app.get("/api/demo/me", async (req) => identity(req));
  app.get("/api/breaks", async (req) => {
    const a = identity(req);
    return {
      breaks: (await r.list("breaks")).filter(
        (b) => a.role === "supervisor" || b.workerId === a.workerId,
      ),
      scheduleRevision: await r.revision(),
    };
  });
  app.post("/api/sessions", async (req, reply) => {
    const workerId = worker(req);
    const b = StartSessionSchema.parse(req.body);
    if (b.source === "mock" && !c.demoMode)
      fail(403, "MOCK_DISABLED", "Synthetic measurements are disabled");
    if (b.source === "presage" && c.hosted)
      fail(403, "REAL_LOCAL_ONLY", "Real measurements are local only");
    const session = await r.transaction(async (tx) => {
      const br = await tx.get("breaks", b.breakId);
      const now = Date.now();
      if (!br || br.workerId !== workerId)
        fail(403, "FORBIDDEN", "Break does not belong to worker");
      if (now < Date.parse(br.startsAt) || now >= Date.parse(br.endsAt))
        fail(
          409,
          "BREAK_INACTIVE",
          "Check-in is available during a scheduled break",
        );
      if (
        (await tx.list("sessions")).some(
          (s) => s.workerId === workerId && s.status === "active",
        )
      )
        fail(
          409,
          "SESSION_ACTIVE",
          "Resume or stop the existing session first",
        );
      const s: Session = {
        id: randomUUID(),
        workerId,
        breakId: b.breakId,
        source: b.source,
        status: "active",
        startedAt: new Date().toISOString(),
        endedAt: null,
        context: b.context,
        consentVersion: b.consentVersion,
        shareWithSupervisor: b.shareWithSupervisor,
        interruption: null,
      };
      await tx.put("sessions", s);
      return s;
    });
    await manager.start(session.id, session.source);
    reply.code(201);
    return { session };
  });
  app.get("/api/sessions/:id", async (req) => ({
    session: await access(req, id(req)),
  }));
  app.get("/api/sessions/:id/readings", async (req) => {
    const s = await access(req, id(req));
    return { readings: await r.readings(s.id) };
  });
  app.post("/api/sessions/:id/readings", async (req) => {
    const provided = req.headers.authorization || "",
      expected = `Bearer ${c.measurementToken}`;
    if (
      Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    )
      fail(401, "INTERNAL_ONLY", "Internal measurement credential required");
    const body = IngestSchema.parse(req.body);
    return r.ingest(id(req), body.readings);
  });
  app.post("/api/sessions/:id/complete", async (req) => {
    EmptySchema.parse(req.body);
    const s = await access(req, id(req), true);
    try {
      await manager.stop(s.id);
    } catch {
      fail(
        503,
        "BRIDGE_STOP_FAILED",
        "Confirm the bridge camera is stopped, then retry completion",
      );
    }
    const session = await r.transaction(async (tx) => {
      const current = (await tx.get("sessions", s.id))!;
      if (current.status === "active") {
        current.status = "completed";
        current.endedAt = new Date().toISOString();
        await tx.put("sessions", current);
      }
      return current;
    });
    return { session, summary: await sessionSummary(r, s.id) };
  });
  app.get("/api/sessions/:id/summary", async (req) => {
    const s = await access(req, id(req));
    return { summary: await sessionSummary(r, s.id) };
  });
  // Worker-only experimental personal insights (docs/RECOVERY_MODEL.md).
  // worker() rejects supervisors outright, regardless of sharing consent.
  const ownSession = async (req: FastifyRequest) => {
    const workerId = worker(req),
      s = await r.get("sessions", id(req));
    if (!s) fail(404, "NOT_FOUND", "Session not found");
    if (s.workerId !== workerId)
      fail(403, "FORBIDDEN", "This session belongs to another worker");
    return s;
  };
  app.get("/api/sessions/:id/personal-insights", async (req) => {
    const s = await ownSession(req);
    return { insights: await personalInsights(r, s.id) };
  });
  app.post("/api/sessions/:id/self-report", async (req) => {
    const b = SelfReportInputSchema.parse(req.body);
    const s = await ownSession(req);
    if (s.status !== "completed")
      fail(409, "SESSION_ACTIVE", "Complete the check-in before rating it");
    if (b.tiredness === null) {
      await r.deleteSelfReport(s.id);
      return { selfReport: null };
    }
    const selfReport = {
      sessionId: s.id,
      workerId: s.workerId,
      tiredness: b.tiredness,
      origin: "worker" as const,
      createdAt: new Date().toISOString(),
    };
    await r.putSelfReport(selfReport);
    return { selfReport };
  });
  app.get("/api/workers/:id/personal-trend", async (req) => {
    const workerId = worker(req);
    if (workerId !== id(req))
      fail(403, "FORBIDDEN", "Personal insights are private");
    const q = PersonalTrendQuerySchema.parse(req.query);
    return { trend: await personalTrend(r, workerId, q.source) };
  });
  app.get("/api/sessions/:id/events", async (req, reply) => {
    const s = await access(req, id(req));
    const last = Number(req.headers["last-event-id"] ?? -1);
    if (!Number.isSafeInteger(last) || last < -1)
      fail(400, "INVALID_CURSOR", "Invalid reading cursor");
    const actor = identity(req);
    const streamKey =
      actor.role === "worker" ? `worker:${actor.workerId}` : "supervisor";
    if (
      (identityStreams.get(streamKey) || 0) >= 6 ||
      (workerStreams.get(s.workerId) || 0) >= 12 ||
      totalStreams >= 64
    ) {
      reply.header("Retry-After", "5");
      fail(
        429,
        "STREAM_LIMIT",
        "Close another live view before opening this stream",
      );
    }
    identityStreams.set(streamKey, (identityStreams.get(streamKey) || 0) + 1);
    workerStreams.set(s.workerId, (workerStreams.get(s.workerId) || 0) + 1);
    totalStreams++;
    let released = false;
    const releaseStream = () => {
      if (released) return;
      released = true;
      totalStreams--;
      for (const [map, key] of [
        [identityStreams, streamKey],
        [workerStreams, s.workerId],
      ] as const) {
        const count = (map.get(key) || 1) - 1;
        if (count) map.set(key, count);
        else map.delete(key);
      }
    };
    reply.raw.once("close", releaseStream);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (e: unknown, sequence?: number) => {
      if (reply.raw.writableLength > 1024 * 1024) {
        reply.raw.destroy();
        return;
      }
      if (!reply.raw.destroyed)
        reply.raw.write(
          `${sequence === undefined ? "" : `id: ${sequence}\n`}data: ${JSON.stringify(e)}\n\n`,
        );
    };
    let replaying = true;
    const buffered: import("@siteguard/contracts").MeasurementEvent[] = [];
    let cursor = last;
    const send = (e: import("@siteguard/contracts").MeasurementEvent) => {
      if (e.type === "reading") {
        if (e.sequence <= cursor) return;
        cursor = e.sequence;
        write(e, e.sequence);
      } else write(e);
    };
    const unsubscribe = manager.subscribe(s.id, (e) => {
      if (replaying) buffered.push(e);
      else send(e);
    });
    const heartbeat = setInterval(() => {
      try {
        identity(req);
      } catch {
        write({
          type: "error",
          code: "UNAUTHENTICATED",
          message: "Demo identity expired. Sign in again.",
          retryable: false,
        });
        reply.raw.end();
        return;
      }
      if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
    }, 5000);
    reply.raw.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
    try {
      for (const e of await r.readings(s.id)) send({ type: "reading", ...e });
      replaying = false;
      for (const e of buffered) send(e);
      const status = manager.status(s.id);
      if (status) write(status);
      else if (s.status === "completed")
        write({ type: "status", state: "stopped", message: null });
    } catch {
      replaying = false;
      buffered.length = 0;
      write({
        type: "error",
        code: "READING_REPLAY_FAILED",
        message: "Saved readings are unavailable.",
        retryable: true,
      });
    }
    if (reply.raw.destroyed) {
      releaseStream();
      unsubscribe();
      clearInterval(heartbeat);
    }
  });
  app.get("/api/workers/:id/history", async (req) => {
    const workerId = worker(req);
    if (workerId !== id(req))
      fail(403, "FORBIDDEN", "Worker history is private");
    const q = HistoryQuerySchema.parse(req.query);
    let cursor: { startedAt: string; id: string } | undefined;
    if (q.before) {
      try {
        cursor = z
          .strictObject({ startedAt: z.iso.datetime(), id: Id })
          .parse(JSON.parse(Buffer.from(q.before, "base64url").toString()));
      } catch {
        fail(400, "INVALID_CURSOR", "Invalid history cursor");
      }
    }
    const all = await r.sessionPage(workerId, q.limit + 1, cursor);
    const selected = all.slice(0, q.limit);
    const sessions = await Promise.all(
      selected.map(async (s) => ({
        ...s,
        summary: await sessionSummary(r, s.id),
      })),
    );
    const last = selected.at(-1);
    return {
      sessions,
      nextCursor:
        all.length > q.limit && last
          ? Buffer.from(
              JSON.stringify({ startedAt: last.startedAt, id: last.id }),
            ).toString("base64url")
          : null,
    };
  });
  app.post("/api/rest-requests", async (req, reply) => {
    const workerId = worker(req);
    const b = NewRequestSchema.parse(req.body);
    await linkedSession(workerId, b.sessionId);
    const request = await r.transaction(async (tx) => {
      const value: RestRequest = {
        id: randomUUID(),
        workerId,
        ...b,
        status: "pending",
        createdAt: new Date().toISOString(),
        restStartsAt: null,
        restEndsAt: null,
        revision: 0,
        note: null,
      };
      await tx.put("rest_requests", value);
      await tx.bump();
      return value;
    });
    reply.code(201);
    return { request };
  });
  app.post("/api/symptom-reports", async (req, reply) => {
    const workerId = worker(req);
    const b = NewSymptomSchema.parse(req.body);
    await linkedSession(workerId, b.sessionId);
    const result = await r.transaction(async (tx) => {
      let request = (await tx.list("rest_requests")).find(
        (x) =>
          x.workerId === workerId &&
          x.kind === "assistance" &&
          !["resolved", "declined"].includes(x.status),
      );
      if (!request) {
        request = {
          id: randomUUID(),
          workerId,
          sessionId: b.sessionId,
          kind: "assistance",
          requestedMinutes: null,
          status: "pending",
          createdAt: new Date().toISOString(),
          restStartsAt: null,
          restEndsAt: null,
          revision: 0,
          note: null,
        };
        await tx.put("rest_requests", request);
      }
      const report: Symptom = {
        id: randomUUID(),
        workerId,
        ...b,
        createdAt: new Date().toISOString(),
        assistanceRequestId: request.id,
      };
      await tx.put("symptom_reports", report);
      await tx.bump();
      return { report, request };
    });
    reply.code(201);
    return result;
  });
  app.get("/api/rest-requests", async (req) => {
    const a = identity(req);
    return {
      requests: (await r.list("rest_requests")).filter(
        (x) => a.role === "supervisor" || x.workerId === a.workerId,
      ),
    };
  });
  app.patch("/api/rest-requests/:id", async (req) => {
    supervisor(req);
    const b = RequestActionSchema.parse(req.body);
    return r.transaction(async (tx) => {
      const request = await tx.get("rest_requests", id(req));
      if (!request) fail(404, "NOT_FOUND", "Request not found");
      if (request.revision !== b.revision)
        fail(409, "STALE_REVISION", "Request changed. Refresh and retry");
      if (["resolved", "declined"].includes(request.status))
        fail(409, "REQUEST_CLOSED", "Request is already closed");
      if (
        request.kind === "assistance" &&
        !["acknowledge", "resolve"].includes(b.action)
      )
        fail(
          409,
          "ASSISTANCE_PROTECTED",
          "Assistance must be explicitly acknowledged or resolved",
        );
      if (request.status === "approved" && b.action !== "resolve")
        fail(
          409,
          "INVALID_TRANSITION",
          "Approved rest may only be explicitly resolved",
        );
      const before = { ...request };
      if (b.action === "approve") {
        if (
          !b.restStartsAt ||
          !b.restEndsAt ||
          Date.parse(b.restEndsAt) - Date.parse(b.restStartsAt) <
            request.requestedMinutes! * 60000 ||
          Date.parse(b.restStartsAt) < Date.parse(request.createdAt) ||
          Date.parse(b.restEndsAt) <= Date.now()
        )
          fail(
            400,
            "REST_INTERVAL",
            "Provide a current/future interval at least as long as requested rest",
          );
        const start = Date.parse(b.restStartsAt);
        const end = Date.parse(b.restEndsAt);
        const overlapsProtected = (await tx.list("breaks")).some(
          (x) =>
            x.workerId === request.workerId &&
            x.kind === "protected" &&
            start < Date.parse(x.endsAt) &&
            end > Date.parse(x.startsAt),
        );
        if (overlapsProtected)
          fail(
            409,
            "REST_OVERLAPS_PROTECTED",
            "Additional rest must be separate from the worker's protected break",
          );
        request.restStartsAt = b.restStartsAt;
        request.restEndsAt = b.restEndsAt;
        await tx.put("breaks", {
          id: randomUUID(),
          workerId: request.workerId,
          startsAt: b.restStartsAt,
          endsAt: b.restEndsAt,
          kind: "additional",
          policyLabel: "Supervisor-approved additional rest",
          revision: 0,
          requestId: request.id,
        });
      }
      request.status =
        b.action === "approve"
          ? "approved"
          : b.action === "resolve"
            ? "resolved"
            : b.action === "decline"
              ? "declined"
              : "acknowledged";
      request.revision++;
      request.note = b.note;
      await tx.put("rest_requests", request);
      await audit(tx, "request_" + b.action, request.id, before, request);
      return { request, scheduleRevision: await tx.bump() };
    });
  });
  app.patch("/api/breaks/:id", async (req) => {
    supervisor(req);
    const b = BreakUpdateSchema.parse(req.body);
    return r.transaction(async (tx) => {
      const br = await tx.get("breaks", id(req));
      if (!br) fail(404, "NOT_FOUND", "Break not found");
      if (br.kind === "protected")
        fail(409, "PROTECTED_BREAK", "Protected breaks cannot move or shrink");
      if (br.revision !== b.revision)
        fail(409, "STALE_REVISION", "Break changed. Refresh and retry");
      const request = br.requestId
        ? await tx.get("rest_requests", br.requestId)
        : null;
      if (!request || request.status !== "approved")
        fail(409, "REST_CLOSED", "Only currently approved rest may change");
      const minDuration =
        Date.parse(request.restEndsAt!) - Date.parse(request.restStartsAt!);
      if (
        Date.parse(b.endsAt) - Date.parse(b.startsAt) < minDuration ||
        Date.parse(b.startsAt) < Date.parse(request.createdAt) ||
        Date.parse(b.endsAt) <= Date.now()
      )
        fail(
          409,
          "REST_MINIMUM",
          "Approved rest duration cannot shrink or move into the past",
        );
      // Same invariant as approval: additional rest stays separate from the
      // worker's protected break, including after it is moved.
      const start = Date.parse(b.startsAt),
        end = Date.parse(b.endsAt);
      if (
        (await tx.list("breaks")).some(
          (x) =>
            x.workerId === br.workerId &&
            x.kind === "protected" &&
            start < Date.parse(x.endsAt) &&
            end > Date.parse(x.startsAt),
        )
      )
        fail(
          409,
          "REST_OVERLAPS_PROTECTED",
          "Additional rest must be separate from the worker's protected break",
        );
      const before = { ...br };
      br.startsAt = b.startsAt;
      br.endsAt = b.endsAt;
      br.revision++;
      request.restStartsAt = b.startsAt;
      request.restEndsAt = b.endsAt;
      request.revision++;
      await tx.put("breaks", br);
      await tx.put("rest_requests", request);
      await audit(tx, "break_update", br.id, before, br);
      return { break: br, scheduleRevision: await tx.bump() };
    });
  });
  app.get("/api/supervisor/overview", async (req) => {
    supervisor(req);
    const schedule = await r.transaction((tx) => tx.schedule());
    return {
      ...schedule,
      symptomReports: await r.list("symptom_reports"),
      sharedSessionIds: (await r.list("sessions"))
        .filter(
          (s) =>
            s.shareWithSupervisor &&
            schedule.requests.some((request) => request.sessionId === s.id),
        )
        .map((s) => s.id),
      coverageGaps: coverageGaps(schedule),
    };
  });
  app.post("/api/schedule/preview", async (req) => {
    supervisor(req);
    EmptySchema.parse(req.body);
    return r.transaction(async (tx) => planSchedule(await tx.schedule()));
  });
  app.post("/api/schedule/commit", async (req) => {
    supervisor(req);
    const b = CommitSchema.parse(req.body);
    return r.transaction(async (tx) => {
      const s = await tx.schedule();
      if (s.scheduleRevision !== b.baseRevision)
        fail(409, "STALE_REVISION", "Schedule changed. Preview again");
      validateAssignments(s, b.assignments);
      await tx.clear("task_assignments");
      for (const a of b.assignments) await tx.put("task_assignments", a);
      const gaps = coverageGaps(s, b.assignments);
      const event = await audit(
        tx,
        "schedule_commit",
        "schedule",
        s.assignments,
        {
          assignments: b.assignments,
          gapCount: gaps.length,
          protectedBreakCount: s.breaks.filter((x) => x.kind === "protected")
            .length,
        },
      );
      return {
        scheduleRevision: await tx.bump(),
        assignments: b.assignments,
        coverageGaps: gaps,
        auditEventId: event.id,
      };
    });
  });
  app.post("/api/insights/explain", async (req) => {
    const b = ExplainSchema.parse(req.body);
    if (b.kind === "session") {
      await access(req, b.sessionId);
      const summary = await sessionSummary(r, b.sessionId);
      return explainer.explain(sessionFacts(summary), summary.limitations);
    }
    supervisor(req);
    const event = await r.get("audit_events", b.auditEventId);
    if (!event || event.action !== "schedule_commit")
      fail(404, "NOT_FOUND", "Schedule event not found");
    const after = event.after as {
      assignments: unknown[];
      gapCount: number;
      protectedBreakCount: number;
    };
    return explainer.explain(
      scheduleFacts({
        assignmentCount: after.assignments.length,
        gapCount: after.gapCount,
        protectedBreakCount: after.protectedBreakCount,
      }),
      [
        "Staffing changes are operational decisions; measurements do not establish fitness for work.",
      ],
    );
  });
  app.post("/api/demo/reset", async (req) => {
    supervisor(req);
    EmptySchema.parse(req.body);
    if (c.hosted || !c.demoMode)
      fail(403, "RESET_DISABLED", "Reset is local-demo only");
    if ((await r.list("sessions")).some((s) => s.source === "presage"))
      fail(
        409,
        "REAL_DATA_PRESENT",
        "Reset refuses to delete real measurements",
      );
    if ((await r.list("sessions")).some((s) => s.status === "active"))
      fail(409, "SESSION_ACTIVE", "Stop active sessions before reset");
    await seed(r, true);
    return { reset: true };
  });
}
