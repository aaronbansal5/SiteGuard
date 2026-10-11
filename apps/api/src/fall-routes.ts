import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import { identity, supervisor } from "./auth.js";
import { fail } from "./errors.js";

const Incident = z.object({
  id: z.uuid(),
  status: z.enum(["open", "acknowledged", "resolved", "false_alarm"]),
  source: z.enum(["camera", "synthetic", "recorded_fixture"]),
  observedAt: z.iso.datetime(),
  cameraId: z.string(),
  zoneId: z.string(),
  durationSeconds: z.number().finite().nonnegative(),
  note: z.string().nullable(),
});
const Scene = z.object({
  source: z.enum(["camera", "synthetic", "recorded_fixture"]),
  status: z.string(),
  cameraActive: z.boolean(),
  incidents: z.array(Incident),
});
export function registerFallRoutes(app: FastifyInstance, config: Config) {
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
    try {
      const scene = Scene.parse(await (await detector("/api/state")).json());
      return {
        ...scene,
        canViewCamera: actor.role === "supervisor",
        incidents: scene.incidents.map(({ note, ...incident }) =>
          actor.role === "supervisor" ? { ...incident, note } : incident,
        ),
      };
    } catch (error) {
      if (error instanceof z.ZodError)
        fail(503, "DETECTOR_UNAVAILABLE", "Detector returned an invalid state");
      throw error;
    }
  });
  app.get("/api/fall-detection/preview", async (req, reply) => {
    supervisor(req);
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
    const body = z
      .strictObject({
        action: z.enum(["acknowledge", "resolve", "false_alarm"]),
        note: z.string().max(1000),
      })
      .parse(req.body);
    if (body.action !== "acknowledge" && !body.note.trim())
      fail(
        400,
        "VALIDATION",
        "A follow-up note is required to close an incident",
      );
    await detector(`/api/incidents/${id}`, body);
    return { saved: true };
  });
}
