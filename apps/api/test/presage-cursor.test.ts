import { test, expect } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { PresageSource } from "../src/measurement/presage.js";
import { loadConfig } from "../src/config.js";

test("reconnect resumes after the last event of any type, without replaying status events", async () => {
  const afters: string[] = [];
  let connections = 0;
  const reading = (n: number) =>
    JSON.stringify({
      type: "reading",
      reading: {
        timestamp: new Date(Date.now() + n).toISOString(),
        heartRateBpm: 80,
        respiratoryRateBrpm: 16,
        quality: "valid",
        source: "presage",
      },
    });
  const status = JSON.stringify({
    type: "status",
    state: "measuring",
    message: null,
  });
  const server = createServer((req, res: ServerResponse) => {
    const json = (o: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(o));
    };
    if (req.url === "/v1/health")
      return json({
        protocolVersion: 1,
        source: "presage",
        status: "ready",
        reason: null,
      });
    if (req.url === "/v1/sessions") return json({ bridgeSessionId: "s1" });
    if (req.url?.startsWith("/v1/sessions/s1/events")) {
      afters.push(new URL(req.url, "http://x").searchParams.get("after")!);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (connections++ === 0) {
        // reading id 0, then status id 1, then drop the connection
        res.write(`id: 0\ndata: ${reading(0)}\n\n`);
        res.write(`id: 1\ndata: ${status}\n\n`);
        setTimeout(() => res.destroy(), 50);
      } else {
        res.write(`id: 2\ndata: ${reading(2)}\n\n`);
      }
      return;
    }
    if (req.url === "/v1/sessions/s1/stop") return json({ status: "stopped" });
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const src = new PresageSource(
    loadConfig({
      bridgeUrl: `http://127.0.0.1:${port}`,
      bridgeToken: "fixture-bridge-token",
      hosted: false,
    }),
  );
  const events: string[] = [];
  src.subscribe((e) => events.push(e.type));
  try {
    await src.start("app-1");
    await expect
      .poll(() => afters.length, { timeout: 8000 })
      .toBeGreaterThanOrEqual(2);
    expect(afters[1]).toBe("1");
    await expect
      .poll(() => events.filter((t) => t === "reading").length, {
        timeout: 8000,
      })
      .toBe(2);
    expect(events.filter((t) => t === "status").length).toBe(1);
  } finally {
    await src.stop();
    server.close();
  }
}, 15000);
