import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixtureId } from "@siteguard/mock-data";
import { login, testApp } from "./helpers.js";

const running: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => {
  for (const x of running.splice(0)) await x.app.close();
});
const tls = { "x-siteguard-public-proto": "https" };

async function pair() {
  const ctx = await testApp();
  running.push(ctx);
  const cookie = await login(ctx.app, "worker", fixtureId(1));
  const code = await ctx.app.inject({
    method: "POST",
    url: "/api/devices/pairings",
    headers: { ...tls, cookie },
    payload: {},
  });
  expect(code.statusCode).toBe(201);
  const exchange = await ctx.app.inject({
    method: "POST",
    url: "/api/devices/pair",
    headers: tls,
    payload: { code: code.json().code },
  });
  expect(exchange.statusCode).toBe(201);
  return { ...ctx, token: exchange.json().deviceToken as string };
}

function payload(shared: boolean) {
  const startedAt = new Date(Date.now() - 5000).toISOString();
  const endedAt = new Date(Date.now() - 1000).toISOString();
  return {
    id: randomUUID(),
    startedAt,
    endedAt,
    consentVersion: "v1",
    shareWithSupervisor: shared,
    context: { workload: null, temperatureC: null },
    readings: [
      {
        sequence: 0,
        reading: {
          timestamp: new Date(Date.now() - 3000).toISOString(),
          heartRateBpm: 73,
          respiratoryRateBrpm: null,
          quality: "valid",
          source: "presage",
        },
      },
    ],
  };
}

describe("local iPhone upload", () => {
  it("requires local HTTPS, one-time pairing and a device token", async () => {
    const ctx = await testApp();
    running.push(ctx);
    const cookie = await login(ctx.app);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/devices/pairings",
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/devices/pairings",
          headers: tls,
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    const code = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/devices/pairings",
        headers: { ...tls, cookie },
        payload: {},
      })
    ).json().code;
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/devices/pair",
          payload: { code },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/devices/pair",
          headers: tls,
          payload: { code },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/devices/pair",
          headers: tls,
          payload: { code },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/device/check-ins",
          headers: tls,
          payload: payload(true),
        })
      ).statusCode,
    ).toBe(401);
  });

  it("replaces the oldest unused code instead of blocking a worker who retries", async () => {
    const ctx = await testApp();
    running.push(ctx);
    const cookie = await login(ctx.app);
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/devices/pairings",
        headers: { ...tls, cookie },
        payload: {},
      });
      expect(response.statusCode).toBe(201);
      codes.push(response.json().code);
    }
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/devices/pair",
          headers: tls,
          payload: { code: codes[0] },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/devices/pair",
          headers: tls,
          payload: { code: codes[3] },
        })
      ).statusCode,
    ).toBe(201);
  });

  it("persists normalized readings, respects per-check-in sharing, and deduplicates retries", async () => {
    const { app, token } = await pair();
    const supervisor = await login(app, "supervisor");
    const headers = { ...tls, authorization: `Bearer ${token}` };
    const privateUpload = payload(false);
    const first = await app.inject({
      method: "POST",
      url: "/api/device/check-ins",
      headers,
      payload: privateUpload,
    });
    expect(first.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/device/check-ins",
          headers,
          payload: privateUpload,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          url: `/api/sessions/${privateUpload.id}/readings`,
          headers: { cookie: supervisor },
        })
      ).statusCode,
    ).toBe(403);
    const sharedUpload = payload(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/device/check-ins",
          headers,
          payload: sharedUpload,
        })
      ).statusCode,
    ).toBe(201);
    const readings = await app.inject({
      url: `/api/sessions/${sharedUpload.id}/readings`,
      headers: { cookie: supervisor },
    });
    expect(readings.statusCode).toBe(200);
    expect(readings.json().readings).toHaveLength(1);
    const overview = await app.inject({
      url: "/api/supervisor/overview",
      headers: { cookie: supervisor },
    });
    expect(
      overview
        .json()
        .sharedSessions.some((s: { id: string }) => s.id === sharedUpload.id),
    ).toBe(true);
    expect(
      overview
        .json()
        .sharedSessions.some((s: { id: string }) => s.id === privateUpload.id),
    ).toBe(false);
    const changed = structuredClone(sharedUpload);
    changed.readings[0].reading.heartRateBpm = 90;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/device/check-ins",
          headers,
          payload: changed,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("rejects synthetic and stale data", async () => {
    const { app, token } = await pair();
    const headers = { ...tls, authorization: `Bearer ${token}` };
    const synthetic = payload(true);
    synthetic.readings[0].reading.source = "mock";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/device/check-ins",
          headers,
          payload: synthetic,
        })
      ).statusCode,
    ).toBe(400);
    const outside = payload(true);
    outside.startedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    outside.endedAt = new Date(Date.now() - 59 * 60_000).toISOString();
    outside.readings[0].reading.timestamp = new Date(
      Date.now() - 59.5 * 60_000,
    ).toISOString();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/device/check-ins",
          headers,
          payload: outside,
        })
      ).statusCode,
    ).toBe(400);
  });
});
