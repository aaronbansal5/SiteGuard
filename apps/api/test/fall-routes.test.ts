import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { login } from "./helpers.js";
const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const x of apps.splice(0)) await x.app.close();
});
async function setup() {
  const x = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    cookieSecret: "test-cookie-secret-at-least-32-characters",
    measurementToken: "internal-test-token",
    fallDetectionToken: "test-fall-secret-at-least-32-characters",
    webDist: "/nonexistent",
    hosted: false,
  });
  apps.push(x);
  await x.app.inject({
    method: "POST",
    url: "/api/safety/events",
    headers: { authorization: "Bearer internal-test-token" },
    payload: {
      protocolVersion: 1,
      eventId: scene.incidents[0].id,
      cameraId: "cam",
      zoneId: "yard",
      detectorRunId: "00000000-0000-4000-8000-000000000002",
      sequence: 0,
      trackId: "secret-track",
      observedAt: new Date().toISOString(),
      kind: "possible_person_down",
      source: "camera",
      method: "bbox-aspect-v1",
      durationSeconds: 2.1,
      evidence: { heightWidthRatio: 0.5 },
    },
  });
  return x;
}
const scene = {
  source: "camera",
  status: "running",
  cameraActive: true,
  tracks: [{ trackId: "secret-track", bbox: [1, 2, 3, 4] }],
  incidents: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      status: "open",
      source: "camera",
      observedAt: "2026-10-10T21:00:00.000Z",
      cameraId: "cam",
      zoneId: "yard",
      durationSeconds: 2.1,
      note: "Manager follow-up note",
      trackId: "secret-track",
      evidence: { region: [0, 0, 1, 1] },
    },
  ],
};
describe("fall detection role boundary", () => {
  it("requires identity and rejects worker preview/control/incident writes before contacting detector", async () => {
    const { app } = await setup(),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await app.inject("/api/fall-detection/state")).statusCode).toBe(
      401,
    );
    const cookie = await login(app);
    const requests = [
      { method: "GET" as const, url: "/api/fall-detection/preview" },
      {
        method: "POST" as const,
        url: "/api/fall-detection/camera/start",
        payload: { consent: true },
      },
      {
        method: "POST" as const,
        url: "/api/fall-detection/camera/stop",
        payload: {},
      },
      {
        method: "POST" as const,
        url: `/api/fall-detection/incidents/${scene.incidents[0].id}`,
        payload: { action: "acknowledge", note: "" },
      },
    ];
    for (const request of requests)
      expect(
        (await app.inject({ ...request, headers: { cookie } })).statusCode,
      ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("shares sanitized incident status with workers while hiding notes and raw tracks", async () => {
    const { app } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(scene)),
    );
    const worker = await login(app),
      manager = await login(app, "supervisor");
    const workerResult = await app.inject({
      url: "/api/fall-detection/state",
      headers: { cookie: worker },
    });
    expect(workerResult.statusCode).toBe(200);
    expect(workerResult.json().canViewCamera).toBe(false);
    expect(workerResult.json().tracks).toBeUndefined();
    expect(workerResult.json().incidents[0].note).toBeUndefined();
    expect(workerResult.body).not.toContain("secret-track");
    const managerResult = await app.inject({
      url: "/api/fall-detection/state",
      headers: { cookie: manager },
    });
    expect(managerResult.json().canViewCamera).toBe(true);
    expect(managerResult.json().incidents[0].note).toBeNull();
    expect(managerResult.json().tracks[0].trackId).toBe("secret-track");
  });
  it("proxies manager preview using a backend-only credential", async () => {
    const { app } = await setup(),
      cookie = await login(app, "supervisor");
    const fetcher = vi.fn(
      async () =>
        new Response(new Uint8Array([255, 216, 255, 217]), {
          headers: { "Content-Type": "image/jpeg" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await app.inject({
      url: "/api/fall-detection/preview",
      headers: { cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("image/jpeg");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:4322/api/preview",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-fall-secret-at-least-32-characters",
        },
        redirect: "error",
      }),
    );
    expect(result.body).not.toContain("test-fall-secret");
  });
  it("requires explicit camera consent and handles invalid detector output", async () => {
    const { app } = await setup(),
      cookie = await login(app, "supervisor");
    const fetcher = vi.fn(async () => Response.json({ unexpected: true }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/fall-detection/camera/start",
          headers: { cookie },
          payload: { consent: false },
        })
      ).statusCode,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          url: "/api/fall-detection/state",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("keeps database incidents visible when the camera service fails and shares explicit review changes", async () => {
    const { app } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("offline");
      }),
    );
    const manager = await login(app, "supervisor"),
      worker = await login(app);
    const response = await app.inject({
      url: "/api/fall-detection/state",
      headers: { cookie: worker },
    });
    expect(response.json().status).toBe("unavailable");
    expect(response.json().incidents[0].id).toBe(scene.incidents[0].id);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/safety/incidents/${scene.incidents[0].id}`,
          headers: { cookie: manager },
          payload: { action: "resolve", revision: 0, note: "Scene checked" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/fall-detection/state",
          headers: { cookie: worker },
        })
      ).json().incidents[0].status,
    ).toBe("resolved");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/safety/incident-statuses",
          payload: { ids: [scene.incidents[0].id] },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/safety/incident-statuses",
          headers: { authorization: "Bearer internal-test-token" },
          payload: { ids: [scene.incidents[0].id] },
        })
      ).json().incidents[0].status,
    ).toBe("resolved");
  });
});
