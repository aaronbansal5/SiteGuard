import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureId } from "@siteguard/mock-data";
import { login, testApp } from "./helpers.js";
import { createApp } from "../src/app.js";

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
  it("keeps a hashed device pairing across a local API restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "siteguard-pairing-test-"));
    const options = {
      sqlitePath: join(directory, "demo.sqlite"),
      databaseUrl: undefined,
      cookieSecret: "test-secret-at-least-thirty-two-characters",
      measurementToken: "internal-test-token",
      bridgeToken: undefined,
      webDist: "/nonexistent/siteguard-web",
      geminiKey: undefined,
      geminiModel: undefined,
    };
    let first: Awaited<ReturnType<typeof createApp>> | undefined;
    let second: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      first = await createApp(options);
      const cookie = await login(first.app, "worker", fixtureId(1));
      const issued = await first.app.inject({
        method: "POST",
        url: "/api/devices/pairings",
        headers: { cookie },
        payload: {},
      });
      expect(issued.statusCode).toBe(201);
      const paired = await first.app.inject({
        method: "POST",
        url: "/api/devices/pair",
        headers: tls,
        payload: { code: issued.json().code },
      });
      expect(paired.statusCode).toBe(201);
      const token = paired.json().deviceToken as string;
      const digestRows = await first.repo.driver.query(
        "SELECT token_digest FROM device_pairings",
      );
      expect(digestRows).toHaveLength(1);
      expect(digestRows[0].token_digest).not.toBe(token);
      await first.app.close();
      first = undefined;

      second = await createApp(options);
      const uploaded = await second.app.inject({
        method: "POST",
        url: "/api/device/check-ins",
        headers: { ...tls, authorization: `Bearer ${token}` },
        payload: payload(true),
      });
      expect(uploaded.statusCode).toBe(201);
      await second.repo.driver.query(
        "UPDATE device_pairings SET expires_at=$1",
        [new Date(0).toISOString()],
      );
      const expired = await second.app.inject({
        method: "POST",
        url: "/api/device/check-ins",
        headers: { ...tls, authorization: `Bearer ${token}` },
        payload: payload(true),
      });
      expect(expired.statusCode).toBe(401);
    } finally {
      if (second) await second.app.close();
      if (first) await first.app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("opens a fresh fictional break without resetting earlier real readings", async () => {
    const { app, repo, token } = await pair();
    const phoneSession = payload(true);
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/device/check-ins",
      headers: { ...tls, authorization: `Bearer ${token}` },
      payload: phoneSession,
    });
    expect(uploaded.statusCode).toBe(201);
    const supervisor = await login(app, "supervisor");
    const workerId = fixtureId(6); // its seeded protected break is later
    const workerCookie = await login(app, "worker", workerId);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/demo/fresh-break",
          headers: { cookie: workerCookie },
          payload: { workerId },
        })
      ).statusCode,
    ).toBe(403);
    const oldBreaks = (await repo.list("breaks")).filter(
      (b) => b.workerId === workerId,
    );
    const fresh = await app.inject({
      method: "POST",
      url: "/api/demo/fresh-break",
      headers: { cookie: supervisor },
      payload: { workerId },
    });
    expect(fresh.statusCode).toBe(201);
    expect(fresh.json().break.kind).toBe("protected");
    expect(
      (await repo.list("breaks")).filter((b) => b.workerId === workerId),
    ).toHaveLength(oldBreaks.length + 1);
    expect(await repo.readings(phoneSession.id)).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/demo/fresh-break",
          headers: { cookie: supervisor },
          payload: { workerId },
        })
      ).statusCode,
    ).toBe(409);
  });

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
