import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { login } from "./helpers.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const x of apps.splice(0)) await x.app.close();
});
async function make(over: Parameters<typeof createApp>[0] = {}) {
  const x = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    cookieSecret: "test-secret-at-least-thirty-two-characters",
    measurementToken: "internal-test-token",
    bridgeToken: undefined,
    webDist: "/nonexistent/siteguard-web",
    geminiKey: undefined,
    geminiModel: undefined,
    ...over,
  });
  apps.push(x);
  return x;
}

describe("GET /api/integrations", () => {
  it("is supervisor-only", async () => {
    const { app } = await make();
    expect((await app.inject("/api/integrations")).statusCode).toBe(401);
    const worker = await login(app);
    expect(
      (
        await app.inject({
          url: "/api/integrations",
          headers: { cookie: worker },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("reports status without leaking secrets", async () => {
    const { app } = await make({
      geminiKey: "SECRET-GEMINI-KEY-VALUE",
      geminiModel: "gemini-test-model",
      bridgeToken: "SECRET-BRIDGE-TOKEN-VALUE",
      bridgeUrl: "http://127.0.0.1:9", // nothing listening
    });
    const cookie = await login(app, "supervisor");
    const res = await app.inject({
      url: "/api/integrations",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("SECRET-GEMINI-KEY-VALUE");
    expect(res.body).not.toContain("SECRET-BRIDGE-TOKEN-VALUE");
    expect(res.json()).toEqual({
      database: { kind: "sqlite", timescaleVersion: null, hypertable: false },
      insights: {
        mode: "configured",
        model: "gemini-test-model",
        lastOrigin: null,
        lastAt: null,
        lastFallbackReason: null,
      },
      presage: { status: "unreachable", reason: "Bridge is not running" },
    });
  });

  it("shows deterministic mode and an unconfigured bridge by default", async () => {
    const { app } = await make();
    const cookie = await login(app, "supervisor");
    const body = (
      await app.inject({ url: "/api/integrations", headers: { cookie } })
    ).json();
    expect(body.insights.mode).toBe("deterministic");
    expect(body.insights.model).toBeNull();
    expect(body.presage.status).toBe("not_configured");
  });
});
