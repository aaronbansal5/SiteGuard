import { sessionStillValid } from "./auth-service.js";
import { randomBytes, createHash } from "node:crypto";
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
  SharingUpdateSchema,
  Id,
  type Session,
  type RestRequest,
  type Symptom,
  type SupervisorView,
} from "@siteguard/contracts";
import type { Repository } from "./db/repository.js";
import type { Config } from "./config.js";
import type { MeasurementManager } from "./measurement/manager.js";
import { identity, worker, supervisor, resolvedIdentity } from "./auth.js";
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
import { evaluateRestSupport } from "./research/rest-support.js";
import { timeSeriesEvidence } from "./domain/timeseries-evidence.js";
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
    let browserCameraReady = false;
    if (!c.hosted && c.bridgeToken) {
      try {
        const response = await fetch(
          new URL("/v1/health?input=custom", c.bridgeUrl),
          {
            headers: { Authorization: `Bearer ${c.bridgeToken}` },
            redirect: "error",
            signal: AbortSignal.timeout(2000),
          },
        );
        browserCameraReady =
          response.ok &&
          BridgeHealthSchema.parse(await response.json()).status === "ready";
      } catch {
        /* An unavailable bridge is reported as unavailable. */
      }
    }
    return {
      status: "ok",
      checkInTestMode: c.checkInTestMode && c.demoMode && !c.hosted,
      database: r.driver.kind,
      measurementSources: {
        mock: c.demoMode,
        presage: !c.hosted && Boolean(c.bridgeToken),
        browserCamera: browserCameraReady,
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
    const a = resolvedIdentity(req)?.identity;
    if (!a && !(c.demoMode && c.authMode === "demo" && !c.hosted))
      identity(req);
    return {
      workers: (await r.list("workers")).filter(
        (w) => !a || a.role === "supervisor" || w.id === a.workerId,
      ),
    };
  });
  app.post("/api/demo/login", async (req, reply) => {
    if (!c.demoMode || c.hosted || c.authMode !== "demo")
      fail(403, "DEMO_DISABLED", "Demo login is disabled");
    const a = LoginSchema.parse(req.body);
    if (a.role === "worker" && !(await r.get("workers", a.workerId)))
      fail(404, "NOT_FOUND", "Worker not found");
    const authToken = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 86400000;
    await r.driver.query(
      "INSERT INTO auth_demo_sessions (token_digest,payload,expires_at) VALUES ($1,$2,$3)",
      [
        createHash("sha256").update(authToken).digest("hex"),
        JSON.stringify(a),
        new Date(expiresAt).toISOString(),
      ],
    );
    reply.setCookie(
      "siteguard",
      JSON.stringify({ identity: a, expiresAt, authToken }),
      {
        signed: true,
        httpOnly: true,
        sameSite: "strict",
        secure: c.hosted || req.headers["x-siteguard-public-proto"] === "https",
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
    const localTest = c.checkInTestMode && c.demoMode && !c.hosted;
    if (b.consentVersion === "local-test" && !localTest)
      fail(403, "TEST_MODE_DISABLED", "Local check-in testing is disabled");
    if (b.source === "mock" && !c.demoMode)
      fail(403, "MOCK_DISABLED", "Synthetic measurements are disabled");
    if (b.source === "presage" && c.hosted)
      fail(403, "REAL_LOCAL_ONLY", "Real measurements are local only");
    if (b.input && b.source !== "presage")
      fail(400, "INVALID_INPUT", "Custom camera input requires Presage");
    const session = await r.transaction(async (tx) => {
      const br = await tx.get("breaks", b.breakId);
      const now = Date.now();
      if (!br || br.workerId !== workerId)
        fail(403, "FORBIDDEN", "Break does not belong to worker");
      if (
        !localTest &&
        (now < Date.parse(br.startsAt) || now >= Date.parse(br.endsAt))
      )
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
      const priorContext =
        b.context.workload === null && b.context.temperatureC === null
          ? (await tx.list("sessions"))
              .filter(
                (candidate) =>
                  candidate.workerId === workerId &&
                  candidate.source === b.source &&
                  candidate.status === "completed",
              )
              .sort((left, right) =>
                right.startedAt.localeCompare(left.startedAt),
              )[0]?.context
          : undefined;
      const s: Session = {
        id: randomUUID(),
        workerId,
        breakId: b.breakId,
        source: b.source,
        status: "active",
        startedAt: new Date().toISOString(),
        endedAt: null,
        // Workers are not required to answer workload or temperature
        // questions. Reuse the latest same-source context only when both are
        // omitted; otherwise preserve the supplied values.
        context: priorContext ?? b.context,
        consentVersion: b.consentVersion,
        shareWithSupervisor: b.shareWithSupervisor,
        interruption: null,
      };
      await tx.put("sessions", s);
      return s;
    });
    await manager.start(session.id, session.source, b.input);
    reply.code(201);
    return { session };
  });
  app.get("/api/sessions/:id", async (req) => ({
    session: await access(req, id(req)),
  }));
  app.get("/api/sessions/:id/preview", async (req, reply) => {
    worker(req);
    const session = await access(req, id(req), true);
    reply.header("Cache-Control", "no-store");
    if (c.hosted || session.source !== "presage")
      fail(
        403,
        "PREVIEW_LOCAL_ONLY",
        "Camera preview is only available for your local Presage session",
      );
    if (session.status !== "active") return reply.code(204).send();
    try {
      const response = await fetch(
        new URL(`/v1/previews/${session.id}`, c.bridgeUrl),
        {
          headers: { Authorization: `Bearer ${c.bridgeToken || ""}` },
          redirect: "error",
          signal: AbortSignal.timeout(2000),
        },
      );
      if (response.status === 204) return reply.code(204).send();
      if (!response.ok || response.headers.get("content-type") !== "image/jpeg")
        return reply.code(503).send();
      const frame = Buffer.from(await response.arrayBuffer());
      if (frame.length > 1_000_000) return reply.code(503).send();
      return reply.type("image/jpeg").send(frame);
    } catch {
      return reply.code(503).send();
    }
  });
  app.get("/api/sessions/:id/readings", async (req) => {
    const s = await access(req, id(req));
    return { readings: await r.readings(s.id) };
  });
  app.post("/api/sessions/:id/frame", async (req, reply) => {
    const s = await access(req, id(req), true);
    if (c.hosted || s.source !== "presage" || s.status !== "active")
      fail(409, "INPUT_NOT_ACTIVE", "Browser camera input is not active");
    const frameType = req.headers["content-type"];
    const raw = frameType === "application/octet-stream";
    const jpeg = frameType === "image/jpeg";
    if (
      (!raw && !jpeg) ||
      !Buffer.isBuffer(req.body) ||
      (raw && req.body.length !== 480 * 360 * 4) ||
      (jpeg &&
        (req.body.length < 4 ||
          req.body.length > 1024 * 1024 ||
          req.body[0] !== 0xff ||
          req.body[1] !== 0xd8))
    )
      fail(400, "INVALID_FRAME", "Expected a 480x360 camera frame");
    const timestampUs = Number(
      (req.query as { timestampUs?: string }).timestampUs,
    );
    if (!Number.isSafeInteger(timestampUs) || timestampUs <= 0)
      fail(400, "INVALID_TIMESTAMP", "Invalid frame timestamp");
    try {
      await manager.sendFrame(
        s.id,
        req.body,
        timestampUs,
        jpeg ? "image/jpeg" : "application/octet-stream",
      );
    } catch {
      fail(503, "FRAME_REJECTED", "Camera frame was not accepted by Presage");
    }
    reply.code(204).send();
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
  app.get("/api/sessions/:id/timeseries-evidence", async (req) => {
    const s = await access(req, id(req));
    return { evidence: await timeSeriesEvidence(r, s) };
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
  app.get("/api/sessions/:id/rest-support", async (req) => {
    const s = await ownSession(req);
    if (s.status !== "completed")
      fail(
        409,
        "SESSION_ACTIVE",
        "Complete the check-in before reviewing rest support",
      );
    const summary = await sessionSummary(r, s.id);
    return evaluateRestSupport(summary);
  });
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
  // Withdraw sharing consent for one session. Owning worker only; idempotent.
  // Requests, symptom reports and their staffing blocks are untouched: only
  // supervisor access to this session's observations ends.
  app.patch("/api/sessions/:id/sharing", async (req) => {
    SharingUpdateSchema.parse(req.body);
    const owned = await ownSession(req);
    const session = await r.transaction(async (tx) => {
      const current = (await tx.get("sessions", owned.id))!;
      if (!current.shareWithSupervisor) return current;
      const updated = { ...current, shareWithSupervisor: false };
      await tx.put("sessions", updated);
      await audit(
        tx,
        "session_sharing_withdrawn",
        current.id,
        { shareWithSupervisor: true },
        { shareWithSupervisor: false },
        "worker",
      );
      return updated;
    });
    return { session };
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
    const heartbeat = setInterval(async () => {
      if (reply.raw.writableEnded) return;
      try {
        if (!(await sessionStillValid(r, c, req)))
          fail(401, "UNAUTHENTICATED", "Session expired");
      } catch {
        write({
          type: "error",
          code: "UNAUTHENTICATED",
          message: "Session ended. Sign in again.",
          retryable: false,
        });
        reply.raw.end();
        return;
      }
      if (actor.role === "supervisor") {
        // A worker can withdraw sharing while a supervisor is watching; end
        // the supervisor's stream at the next heartbeat when that happens.
        void r.get("sessions", s.id).then(
          (current) => {
            if (current?.shareWithSupervisor || reply.raw.writableEnded) return;
            write({
              type: "error",
              code: "SHARING_WITHDRAWN",
              message: "The worker stopped sharing this session.",
              retryable: false,
            });
            reply.raw.end();
          },
          () => {},
        );
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
      await audit(
        tx,
        "request_" + b.action,
        request.id,
        before,
        request,
        resolvedIdentity(req)?.account?.id ?? "supervisor-demo",
      );
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
      await audit(
        tx,
        "break_update",
        br.id,
        before,
        br,
        resolvedIdentity(req)?.account?.id ?? "supervisor-demo",
      );
      return { break: br, scheduleRevision: await tx.bump() };
    });
  });
  // One source for the supervisor overview and the worker's mirror of it, so
  // the mirror cannot drift from what supervisors actually receive.
  const supervisorOverview = async () => {
    const schedule = await r.transaction((tx) => tx.schedule());
    const sessions = await r.list("sessions");
    return {
      overview: {
        ...schedule,
        symptomReports: await r.list("symptom_reports"),
        sharedSessionIds: sessions
          .filter(
            (s) =>
              s.shareWithSupervisor &&
              schedule.requests.some((request) => request.sessionId === s.id),
          )
          .map((s) => s.id),
        sharedSessions: sessions
          .filter((s) => s.shareWithSupervisor && s.status === "completed")
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, 20),
        coverageGaps: coverageGaps(schedule),
      },
      sessions,
    };
  };
  app.get("/api/supervisor/overview", async (req) => {
    supervisor(req);
    return (await supervisorOverview()).overview;
  });
  // Worker-only mirror: the records about this worker that safety operations
  // can read right now. Supervisors get 403; it is the worker's own view.
  app.get("/api/workers/:id/supervisor-view", async (req) => {
    const workerId = worker(req);
    if (workerId !== id(req))
      fail(403, "FORBIDDEN", "This view belongs to another worker");
    const { overview: o, sessions } = await supervisorOverview();
    const assignments = o.assignments.filter((x) => x.workerId === workerId);
    const view: SupervisorView = {
      workerId,
      generatedAt: new Date().toISOString(),
      breaks: o.breaks.filter((x) => x.workerId === workerId),
      assignments,
      tasks: o.tasks.filter((t) => assignments.some((x) => x.taskId === t.id)),
      availability: o.availability.filter((x) => x.workerId === workerId),
      requests: o.requests.filter((x) => x.workerId === workerId),
      symptomReports: o.symptomReports.filter((x) => x.workerId === workerId),
      // Supervisors can open any shared session's summary directly (access()),
      // not only the ones the overview links, so list every shared session.
      sharedSessions: sessions
        .filter((s) => s.workerId === workerId && s.shareWithSupervisor)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map((s) => ({
          id: s.id,
          source: s.source,
          status: s.status,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          linkedToRequest: o.sharedSessionIds.includes(s.id),
        })),
    };
    return { view };
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
        resolvedIdentity(req)?.account?.id ?? "supervisor-demo",
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
  app.post("/api/demo/fresh-break", async (req, reply) => {
    supervisor(req);
    const { workerId } = z.strictObject({ workerId: Id }).parse(req.body);
    if (
      c.hosted ||
      !c.demoMode ||
      !["127.0.0.1", "::1"].includes(c.host) ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      )
    )
      fail(
        403,
        "DEMO_LOCAL_ONLY",
        "Fresh demo breaks are available only on the local demo",
      );
    const result = await r.transaction(async (tx) => {
      if (!(await tx.get("workers", workerId)))
        fail(404, "WORKER_NOT_FOUND", "Worker not found");
      if (
        (await tx.list("sessions")).some(
          (s) => s.workerId === workerId && s.status === "active",
        )
      )
        fail(409, "SESSION_ACTIVE", "Finish the active check-in first");
      const now = Date.now();
      const ends = now + 15 * 60_000;
      if (
        (await tx.list("breaks")).some(
          (b) =>
            b.workerId === workerId &&
            Date.parse(b.startsAt) < ends &&
            Date.parse(b.endsAt) > now,
        )
      )
        fail(
          409,
          "BREAK_OVERLAP",
          "This worker already has a break in the next 15 minutes",
        );
      const br = {
        id: randomUUID(),
        workerId,
        startsAt: new Date(now).toISOString(),
        endsAt: new Date(ends).toISOString(),
        kind: "protected" as const,
        policyLabel: "Fictional local demo · 15 min protected break",
        revision: 0,
        requestId: null,
      };
      await tx.put("breaks", br);
      await audit(tx, "demo_fresh_break", br.id, null, br);
      return { break: br, scheduleRevision: await tx.bump() };
    });
    reply.code(201);
    return result;
  });
}
