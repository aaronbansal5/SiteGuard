import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { EmptySchema, Id, type RestRequest } from "@siteguard/contracts";
import {
  SafetyActionSchema,
  SafetyEventSchema,
  type SafetyEvent,
  type SafetyIncident,
} from "@siteguard/contracts";
import type { Config } from "../config.js";
import type { Repository } from "../db/repository.js";
import { supervisor, resolvedIdentity } from "../auth.js";
import { fail } from "../errors.js";

const digest = (event: SafetyEvent) =>
  createHash("sha256").update(JSON.stringify(event)).digest("hex");
const tokenEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function ingest(r: Repository, c: Config, event: SafetyEvent) {
  if (c.hosted && event.source !== "synthetic")
    fail(
      403,
      "REAL_CAMERA_DISABLED",
      "Hosted fictional demo rejects real and recorded camera events",
    );
  if (!c.demoMode && event.source === "synthetic")
    fail(403, "SYNTHETIC_DISABLED", "Synthetic incidents are disabled");
  if (
    Date.parse(event.observedAt) > Date.now() + 30000 ||
    Date.parse(event.observedAt) < Date.now() - 7 * 86400000
  )
    fail(
      400,
      "EVENT_TIME_INVALID",
      "Observation must be within the last seven days",
    );
  return r.transaction(async (tx) => {
    const rows = await tx.driver.query(
      "SELECT id,digest FROM safety_events WHERE id=$1 OR (camera_id=$2 AND run_id=$3 AND sequence=$4)",
      [event.eventId, event.cameraId, event.detectorRunId, event.sequence],
    );
    const hash = digest(event);
    if (rows.length) {
      if (
        rows.length !== 1 ||
        rows[0].id !== event.eventId ||
        rows[0].digest !== hash
      )
        fail(
          409,
          "REPLAY_CONFLICT",
          "Event identity conflicts with persisted content",
        );
      return { duplicate: true, incidentId: event.eventId };
    }
    const incident: SafetyIncident = {
      ...event,
      id: event.eventId,
      receivedAt: new Date().toISOString(),
      status: "open",
      note: null,
      workerId: null,
      assistanceRequestId: null,
      revision: 0,
    };
    await tx.driver.query(
      "INSERT INTO safety_events (id,camera_id,run_id,sequence,digest,payload) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        event.eventId,
        event.cameraId,
        event.detectorRunId,
        event.sequence,
        hash,
        JSON.stringify(event),
      ],
    );
    await tx.driver.query(
      "INSERT INTO safety_incidents (id,worker_id,assistance_request_id,received_at,payload) VALUES ($1,$2,$3,$4,$5)",
      [incident.id, null, null, incident.receivedAt, JSON.stringify(incident)],
    );
    return { duplicate: false, incidentId: incident.id };
  });
}
export async function registerSafetyRoutes(
  app: FastifyInstance,
  r: Repository,
  c: Config,
) {
  app.post("/api/safety/events", async (req, reply) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
    if (!tokenEqual(token, c.measurementToken))
      fail(
        401,
        "INTERNAL_CREDENTIAL_REQUIRED",
        "Measurement-service credential required",
      );
    const result = await ingest(r, c, SafetyEventSchema.parse(req.body));
    reply.code(result.duplicate ? 200 : 201);
    return result;
  });
  app.get("/api/safety/incidents", async (req) => {
    supervisor(req);
    const rows = await r.driver.query(
      "SELECT payload FROM safety_incidents ORDER BY received_at DESC,id DESC LIMIT 100",
    );
    return {
      incidents: rows.map(
        (row) => JSON.parse(row.payload as string) as SafetyIncident,
      ),
    };
  });
  app.post("/api/safety/demo", async (req, reply) => {
    supervisor(req);
    EmptySchema.parse(req.body);
    if (c.hosted || !c.demoMode)
      fail(
        403,
        "DEMO_DISABLED",
        "Synthetic incident action is local-demo only",
      );
    const event: SafetyEvent = {
      protocolVersion: 1,
      eventId: randomUUID(),
      cameraId: "demo-camera",
      zoneId: "north-yard",
      detectorRunId: randomUUID(),
      sequence: 0,
      trackId: "anonymous-demo-track",
      observedAt: new Date().toISOString(),
      kind: "possible_person_down",
      source: "synthetic",
      method: "bbox-aspect-v1",
      durationSeconds: 1.5,
      evidence: { heightWidthRatio: 0.4 },
    };
    const result = await ingest(r, c, event);
    reply.code(201);
    return result;
  });
  app.patch("/api/safety/incidents/:id", async (req) => {
    supervisor(req);
    const id = Id.parse((req.params as { id: string }).id),
      body = SafetyActionSchema.parse(req.body);
    return r.transaction(async (tx) => {
      const row = (
        await tx.driver.query(
          "SELECT payload FROM safety_incidents WHERE id=$1",
          [id],
        )
      )[0];
      if (!row) fail(404, "NOT_FOUND", "Incident not found");
      const incident = JSON.parse(row.payload as string) as SafetyIncident;
      if (incident.revision !== body.revision)
        fail(409, "STALE_REVISION", "Incident changed; refresh and retry");
      if (["resolved", "false_alarm"].includes(incident.status))
        fail(409, "INCIDENT_CLOSED", "Incident is already closed");
      const before = { ...incident };
      if (body.action === "associate") {
        if (incident.workerId)
          fail(
            409,
            "ALREADY_ASSOCIATED",
            "Incident already has a worker association",
          );
        if (!(await tx.get("workers", body.workerId!)))
          fail(404, "NOT_FOUND", "Worker not found");
        let request = (await tx.list("rest_requests")).find(
          (item) =>
            item.workerId === body.workerId &&
            item.kind === "assistance" &&
            !["resolved", "declined"].includes(item.status),
        );
        if (!request) {
          request = {
            id: randomUUID(),
            workerId: body.workerId!,
            sessionId: null,
            kind: "assistance",
            requestedMinutes: null,
            status: "pending",
            createdAt: new Date().toISOString(),
            restStartsAt: null,
            restEndsAt: null,
            revision: 0,
            note: null,
          } satisfies RestRequest;
          await tx.put("rest_requests", request);
        }
        incident.workerId = body.workerId!;
        incident.assistanceRequestId = request.id;
        await tx.bump();
      } else if (body.action === "acknowledge")
        incident.status = "acknowledged";
      else
        incident.status =
          body.action === "resolve" ? "resolved" : "false_alarm";
      incident.note = body.note || null;
      incident.revision++;
      await tx.driver.query(
        "UPDATE safety_incidents SET worker_id=$1,assistance_request_id=$2,payload=$3 WHERE id=$4",
        [
          incident.workerId,
          incident.assistanceRequestId,
          JSON.stringify(incident),
          id,
        ],
      );
      // Incident closure deliberately does not modify linked assistance.
      await tx.put("audit_events", {
        id: randomUUID(),
        actor: resolvedIdentity(req)?.account?.id || "supervisor-demo",
        action: "safety_" + body.action,
        entityId: id,
        before,
        after: incident,
        createdAt: new Date().toISOString(),
      });
      return { incident };
    });
  });
}
