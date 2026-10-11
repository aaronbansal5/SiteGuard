import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ContextSchema,
  Id,
  ISO,
  ReadingEnvelopeSchema,
  type ReadingEnvelope,
  type Session,
} from "@siteguard/contracts";
import type { Repository } from "./db/repository.js";
import type { Config } from "./config.js";
import { worker } from "./auth.js";
import { fail } from "./errors.js";
import { sessionSummary } from "./domain/sessions.js";

// Deliberately local-demo-only. Pairings and device credentials expire on
// server restart; no device credential or camera frame is persisted.
const PairBody = z.strictObject({ code: z.string().regex(/^[A-Z2-9]{8}$/) });
const CheckInBody = z.strictObject({
  id: Id,
  startedAt: ISO,
  endedAt: ISO,
  consentVersion: z.literal("v1"),
  shareWithSupervisor: z.boolean(),
  context: ContextSchema,
  readings: z.array(ReadingEnvelopeSchema).min(1).max(1000),
});
type Pairing = { workerId: string; expiresAt: number };
type Device = { workerId: string; expiresAt: number };
const readingValues = (e: ReadingEnvelope) => [
  e.sequence,
  e.reading.timestamp,
  e.reading.heartRateBpm,
  e.reading.respiratoryRateBrpm,
  e.reading.quality,
  e.reading.source,
];

export function registerDeviceRoutes(
  app: FastifyInstance,
  r: Repository,
  c: Config,
) {
  const pairings = new Map<string, Pairing>();
  const devices = new Map<string, Device>(); // SHA-256 token -> worker binding
  const failures = new Map<string, { count: number; until: number }>();
  const local = (req: FastifyRequest) => {
    const remote = req.socket.remoteAddress;
    if (
      c.hosted ||
      !["127.0.0.1", "::1"].includes(c.host) ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote ?? "")
    )
      fail(
        403,
        "DEVICE_LOCAL_ONLY",
        "Device pairing is available only on the local demo",
      );
  };
  const available = (req: FastifyRequest) => {
    local(req);
    if (req.headers["x-siteguard-public-proto"] !== "https")
      fail(
        403,
        "DEVICE_LOCAL_HTTPS_ONLY",
        "Phone pairing and upload require local HTTPS",
      );
  };
  const device = (req: FastifyRequest) => {
    available(req);
    const authorization = req.headers.authorization ?? "";
    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))
      fail(401, "DEVICE_UNPAIRED", "Pair this phone first");
    const token = authorization.slice(7);
    const digest = createHash("sha256").update(token).digest("hex");
    const entry = devices.get(digest);
    if (!entry || entry.expiresAt <= Date.now())
      fail(401, "DEVICE_UNPAIRED", "Pair this phone again");
    return entry.workerId;
  };
  app.post("/api/devices/pairings", async (req, reply) => {
    // Issuing a short-lived code on the Mac's loopback HTTP origin is safe;
    // the phone's code exchange and all readings still require HTTPS.
    local(req);
    const workerId = worker(req);
    const now = Date.now();
    for (const [code, entry] of pairings)
      if (entry.expiresAt <= now) pairings.delete(code);
    // A worker asking for another code should never be stranded by an earlier
    // unused code (for example after closing the page). Invalidate the oldest.
    const mine = [...pairings].filter(
      ([, entry]) => entry.workerId === workerId,
    );
    if (mine.length >= 3) pairings.delete(mine[0][0]);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    do {
      code = Array.from(
        randomBytes(8),
        (byte) => alphabet[byte % alphabet.length],
      ).join("");
    } while (pairings.has(code));
    pairings.set(code, { workerId, expiresAt: now + 5 * 60_000 });
    reply.code(201);
    return { code, expiresAt: new Date(now + 5 * 60_000).toISOString() };
  });
  app.post("/api/devices/pair", async (req, reply) => {
    available(req);
    const key = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const attempts = failures.get(key);
    if (attempts && attempts.until > now && attempts.count >= 10)
      fail(429, "PAIRING_LOCKED", "Wait before trying another code");
    const { code } = PairBody.parse(req.body);
    const pairing = pairings.get(code);
    if (!pairing || pairing.expiresAt <= now) {
      failures.set(key, {
        count:
          (attempts?.until && attempts.until > now ? attempts.count : 0) + 1,
        until: now + 10 * 60_000,
      });
      fail(401, "INVALID_PAIRING", "Code invalid or expired");
    }
    pairings.delete(code);
    failures.delete(key);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now + 24 * 60 * 60_000;
    devices.set(createHash("sha256").update(token).digest("hex"), {
      workerId: pairing.workerId,
      expiresAt,
    });
    reply.code(201);
    return {
      deviceToken: token,
      workerId: pairing.workerId,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  });
  app.post("/api/device/check-ins", async (req, reply) => {
    const workerId = device(req);
    const body = CheckInBody.parse(req.body);
    if (
      body.readings.some(
        (e, i) => e.sequence !== i || e.reading.source !== "presage",
      )
    )
      fail(
        400,
        "INVALID_READINGS",
        "Readings must be sequential real Presage observations",
      );
    const start = Date.parse(body.startedAt),
      end = Date.parse(body.endedAt),
      now = Date.now();
    if (
      end <= start ||
      end - start > 10 * 60_000 ||
      Math.abs(now - end) > 2 * 60_000 ||
      body.readings.some(
        (e) =>
          Date.parse(e.reading.timestamp) < start ||
          Date.parse(e.reading.timestamp) > end,
      )
    )
      fail(
        400,
        "READING_TIME",
        "Check-in timestamps are outside the allowed window",
      );
    const result = await r.transaction(async (tx) => {
      const existing = await tx.get("sessions", body.id);
      if (existing) {
        if (
          existing.workerId !== workerId ||
          existing.source !== "presage" ||
          existing.startedAt !== body.startedAt ||
          existing.endedAt !== body.endedAt ||
          existing.shareWithSupervisor !== body.shareWithSupervisor ||
          JSON.stringify(existing.context) !== JSON.stringify(body.context) ||
          JSON.stringify((await tx.readings(body.id)).map(readingValues)) !==
            JSON.stringify(body.readings.map(readingValues))
        )
          fail(409, "UPLOAD_CONFLICT", "This check-in ID was already used");
        return existing;
      }
      const br = (await tx.list("breaks")).find(
        (b) =>
          b.workerId === workerId &&
          start >= Date.parse(b.startsAt) &&
          end <= Date.parse(b.endsAt),
      );
      if (!br)
        fail(
          409,
          "BREAK_INACTIVE",
          "This check-in was not within a scheduled break",
        );
      const session: Session = {
        id: body.id,
        workerId,
        breakId: br.id,
        source: "presage",
        status: "completed",
        startedAt: body.startedAt,
        endedAt: body.endedAt,
        context: body.context,
        consentVersion: "v1",
        shareWithSupervisor: body.shareWithSupervisor,
        interruption: null,
      };
      await tx.put("sessions", session);
      for (const envelope of body.readings)
        await tx.insertReading(body.id, envelope);
      return session;
    });
    reply.code(201);
    return { session: result, summary: await sessionSummary(r, result.id) };
  });
}
