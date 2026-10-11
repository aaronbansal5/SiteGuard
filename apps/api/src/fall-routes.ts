import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import { identity, supervisor } from "./auth.js";
import { SafetyIncidentSchema } from "@siteguard/contracts";
import type { Repository } from "./db/repository.js";
import { fail } from "./errors.js";

const Scene = z.object({
  source: z.enum(["camera", "synthetic", "recorded_fixture"]),
  status: z.string(),
  cameraActive: z.boolean(),
  tracks: z
    .array(
      z.object({
        trackId: z.string(),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        state: z.string().default("unknown"),
        horizontal: z.boolean().default(false),
      }),
    )
    .default([]),
  frameSize: z
    .tuple([z.number().positive(), z.number().positive()])
    .default([640, 360]),
  delivery: z
    .object({
      configured: z.boolean(),
      pending: z.number().int().nonnegative(),
      error: z.string().nullable(),
    })
    .optional(),
});
export function registerFallRoutes(
  app: FastifyInstance,
  config: Config,
  repository: Repository,
) {
  async function detector(path: string, body?: unknown) {
    if (config.hosted || !config.fallDetectionToken)
      fail(
        503,
        "DETECTOR_UNAVAILABLE",
        "Local fall detector is not configured",
      );
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:4322${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${config.fallDetectionToken}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      fail(
        503,
        "DETECTOR_UNAVAILABLE",
        "Fall detector unavailable; check the local service",
      );
    }
    if (!response.ok)
      fail(
        503,
        "DETECTOR_UNAVAILABLE",
        "Detector action or live frame unavailable",
      );
    return response;
  }
  app.get("/api/fall-detection/state", async (req) => {
    const actor = identity(req);
    const rows = await repository.driver.query(
      "SELECT payload FROM safety_incidents ORDER BY received_at DESC,id DESC",
    );
    const records = rows.map((row) =>
      SafetyIncidentSchema.parse(JSON.parse(row.payload as string)),
    );
    const incidents = records
      .filter(
        (record, index) =>
          index < 100 || ["open", "acknowledged"].includes(record.status),
      )
      .map((record) => ({
        id: record.id,
        status: record.status,
        source: record.source,
        observedAt: record.observedAt,
        cameraId: record.cameraId,
        zoneId: record.zoneId,
        durationSeconds: record.durationSeconds,
        revision: record.revision,
        ...(actor.role === "supervisor" ? { note: record.note } : {}),
      }));
    let scene: z.infer<typeof Scene>;
    try {
      scene = Scene.parse(await (await detector("/api/state")).json());
    } catch {
      scene = {
        source: "camera",
        status: "unavailable",
        cameraActive: false,
        tracks: [],
        frameSize: [640, 360],
      };
    }
    const { tracks, frameSize, ...status } = scene;
    return {
      ...status,
      incidents,
      canViewCamera: true,
      tracks,
      frameSize,
    };
  });
  app.get("/api/fall-detection/preview", async (req, reply) => {
    identity(req);
    const response = await detector("/api/preview");
    if (!response.headers.get("content-type")?.startsWith("image/jpeg"))
      fail(503, "DETECTOR_UNAVAILABLE", "Live camera frame unavailable");
    return reply
      .type("image/jpeg")
      .header("Cache-Control", "no-store")
      .header("Cross-Origin-Resource-Policy", "same-origin")
      .send(Buffer.from(await response.arrayBuffer()));
  });
  app.post("/api/fall-detection/camera/start", async (req) => {
    supervisor(req);
    z.strictObject({ consent: z.literal(true) }).parse(req.body);
    await detector("/api/camera/start", { consent: true });
    return { started: true };
  });
  app.post("/api/fall-detection/camera/stop", async (req) => {
    supervisor(req);
    z.strictObject({}).parse(req.body);
    await detector("/api/camera/stop", {});
    return { stopped: true };
  });
  app.post("/api/fall-detection/incidents/:id", async (req) => {
    supervisor(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const result = await app.inject({
      method: "PATCH",
      url: `/api/safety/incidents/${id}`,
      headers: { ...req.headers, "content-type": "application/json" },
      payload: req.body as object,
    });
    if (result.statusCode >= 400) {
      const error = result.json().error;
      fail(result.statusCode, error.code, error.message);
    }
    return result.json();
  });
}
