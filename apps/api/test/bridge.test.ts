import { test, expect } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { fixtureId } from "@siteguard/mock-data";
test("application adapter consumes a fixture bridge without claiming SDK success", async () => {
  let stream: ServerResponse | undefined,
    stopped = false,
    started = false;
  const server = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer fixture-bridge-token") {
      res.writeHead(401).end();
      return;
    }
    if (req.url === "/v1/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          protocolVersion: 1,
          source: "presage",
          status: "ready",
          reason: null,
        }),
      );
    } else if (req.url === "/v1/sessions") {
      started = true;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ bridgeSessionId: "fixture-session" }));
    } else if (req.url?.startsWith("/v1/sessions/fixture-session/events")) {
      stream = res;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `id: 0\ndata: ${JSON.stringify({ type: "reading", reading: { timestamp: new Date().toISOString(), heartRateBpm: 92, respiratoryRateBrpm: 19, quality: "valid", source: "presage" } })}\n\n`,
      );
    } else if (req.url === "/v1/sessions/fixture-session/stop") {
      stopped = true;
      stream?.end();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "stopped" }));
    } else res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No bridge port");
  const x = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    webDist: "/nonexistent",
    bridgeUrl: `http://127.0.0.1:${address.port}`,
    bridgeToken: "fixture-bridge-token",
    hosted: false,
  });
  try {
    const login = await x.app.inject({
      method: "POST",
      url: "/api/demo/login",
      payload: { role: "worker", workerId: fixtureId(1) },
    });
    const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
    const begin = await x.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: {
        breakId: fixtureId(101),
        source: "presage",
        consentVersion: "v1",
        shareWithSupervisor: false,
        context: { workload: null, temperatureC: null },
      },
    });
    expect(begin.statusCode).toBe(201);
    expect(started).toBe(true);
    const id = begin.json().session.id;
    await expect.poll(async () => (await x.repo.readings(id)).length).toBe(1);
    const readings = await x.repo.readings(id);
    expect(readings[0].reading.source).toBe("presage");
    const end = await x.app.inject({
      method: "POST",
      url: `/api/sessions/${id}/complete`,
      headers: { cookie },
      payload: {},
    });
    expect(end.statusCode).toBe(200);
    expect(stopped).toBe(true);
    expect(end.json().summary.pulse.status).toBe("insufficient_data");
    expect(end.json().summary.pulseComparison.count).toBe(0);
  } finally {
    await x.app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

test("owned browser frames reach only the active custom-input bridge session", async () => {
  let frameBytes = 0;
  let frameType = "";
  let selectedInput = "";
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer fixture-bridge-token")
      return void res.writeHead(401).end();
    if (req.url?.startsWith("/v1/health"))
      return void res.end(
        JSON.stringify({
          protocolVersion: 1,
          source: "presage",
          status: "ready",
          reason: null,
        }),
      );
    if (req.url === "/v1/sessions" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk.toString();
      selectedInput = JSON.parse(body).input;
      return void res.end(
        JSON.stringify({ bridgeSessionId: "browser-session" }),
      );
    }
    if (req.url?.startsWith("/v1/sessions/browser-session/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      return;
    }
    if (req.url?.startsWith("/v1/sessions/browser-session/frame")) {
      frameType = req.headers["content-type"] || "";
      for await (const chunk of req) frameBytes += chunk.length;
      return void res.writeHead(204).end();
    }
    if (req.url === "/v1/sessions/browser-session/stop")
      return void res.end(JSON.stringify({ status: "stopped" }));
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No bridge port");
  const x = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    webDist: "/nonexistent",
    bridgeUrl: `http://127.0.0.1:${address.port}`,
    bridgeToken: "fixture-bridge-token",
    hosted: false,
  });
  try {
    const login = await x.app.inject({
      method: "POST",
      url: "/api/demo/login",
      payload: { role: "worker", workerId: fixtureId(1) },
    });
    const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
    const begin = await x.app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { cookie },
      payload: {
        breakId: fixtureId(101),
        source: "presage",
        input: "custom",
        consentVersion: "v1",
        shareWithSupervisor: false,
        context: { workload: null, temperatureC: null },
      },
    });
    expect(begin.statusCode).toBe(201);
    expect(selectedInput).toBe("custom");
    const id = begin.json().session.id;
    const url = `/api/sessions/${id}/frame?timestampUs=${Date.now() * 1000}`;
    const payload = Buffer.alloc(480 * 360 * 4);
    const frame = await x.app.inject({
      method: "POST",
      url,
      headers: { cookie, "content-type": "application/octet-stream" },
      payload,
    });
    expect(frame.statusCode).toBe(204);
    expect(frameBytes).toBe(payload.length);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const compressedFrame = await x.app.inject({
      method: "POST",
      url,
      headers: { cookie, "content-type": "image/jpeg" },
      payload: jpeg,
    });
    expect(compressedFrame.statusCode).toBe(204);
    expect(frameType).toBe("image/jpeg");
    expect(frameBytes).toBe(payload.length + jpeg.length);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url,
          headers: { "content-type": "application/octet-stream" },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: `/api/sessions/${id}/complete`,
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await x.app.inject({
          method: "POST",
          url,
          headers: { cookie, "content-type": "application/octet-stream" },
          payload,
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await x.app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
