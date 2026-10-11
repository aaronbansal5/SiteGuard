import { afterEach, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import sharp from "sharp";
import {
  BridgeEventSchema,
  BridgeHealthSchema,
  BridgeSessionSchema,
} from "../../../packages/contracts/src/index.js";
import { systemClock, type SdkAdapter } from "../src/adapter.js";
import { PresageSdkAdapter } from "../src/adapters/presage-sdk.js";
import { FIXTURE_NAMES } from "../src/adapters/fixture.js";
import { PresageBridge } from "../src/server.js";
import {
  readSse,
  startFixtureBridge,
  TOKEN,
  type SseMessage,
} from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
async function fixtureBridge(...args: Parameters<typeof startFixtureBridge>) {
  const b = await startFixtureBridge(...args);
  cleanup.push(() => b.bridge.close());
  return b;
}
const isStopped = (m: SseMessage[]) =>
  m.some((x) => (x.data as { state?: string }).state === "stopped");
function assertContract(msgs: SseMessage[]) {
  let last = -1;
  for (const m of msgs) {
    expect(Number.isSafeInteger(m.id)).toBe(true);
    expect(m.id!).toBeGreaterThan(last);
    last = m.id!;
    const parsed = BridgeEventSchema.parse(m.data);
    if (parsed.type === "reading")
      expect(parsed.reading.source).toBe("presage");
  }
}
async function runFixture(name: (typeof FIXTURE_NAMES)[number]) {
  const b = await fixtureBridge(name, { speed: 100 });
  const started = await b.start();
  expect(started.status).toBe(201);
  const { bridgeSessionId } = BridgeSessionSchema.parse(await started.json());
  // Fixtures last <= 20s; at speed 100 they finish in ~200ms.
  await new Promise((r) => setTimeout(r, 400));
  const stop = await b.call(`/v1/sessions/${bridgeSessionId}/stop`, {
    method: "POST",
  });
  expect(await stop.json()).toEqual({ status: "stopped" });
  const res = await b.call(`/v1/sessions/${bridgeSessionId}/events?after=-1`);
  const { msgs, ended } = await readSse(res);
  expect(ended).toBe(true);
  assertContract(msgs);
  return msgs.map((m) => BridgeEventSchema.parse(m.data));
}
const readings = (events: ReturnType<typeof BridgeEventSchema.parse>[]) =>
  events.flatMap((e) => (e.type === "reading" ? [e.reading] : []));

describe("transport and auth", () => {
  test("custom-input frame endpoint is session-bound and rejects malformed frames", async () => {
    const delivered: Array<[number, number, number]> = [];
    const adapter: SdkAdapter = {
      kind: "presage-sdk",
      async probe() {
        return { ready: true, reason: null };
      },
      async open(_handlers, mode) {
        expect(mode).toBe("custom");
        return {
          async close() {},
          sendFrame(frame, width, height) {
            expect(frame.length).toBe(width * height * 3);
            delivered.push([width, height, frame.length]);
          },
        };
      },
    };
    const bridge = new PresageBridge({ token: TOKEN, adapter, port: 0 });
    const port = await bridge.listen();
    cleanup.push(() => bridge.close());
    const base = `http://127.0.0.1:${port}`;
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const started = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ appSessionId: randomUUID(), input: "custom" }),
    });
    expect(started.status).toBe(201);
    const { bridgeSessionId } = BridgeSessionSchema.parse(await started.json());
    let nextTimestampUs = 1700000000000000;
    const frameUrl = () =>
      `${base}/v1/sessions/${bridgeSessionId}/frame?timestampUs=${nextTimestampUs++}`;
    const send = (body: Buffer) =>
      fetch(frameUrl(), {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(body),
      });
    expect((await send(Buffer.alloc(4))).status).toBe(400);
    expect((await send(Buffer.alloc(480 * 360 * 4))).status).toBe(204);
    const jpeg = await sharp({
      create: { width: 480, height: 360, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const sendJpeg = (body: Buffer) =>
      fetch(frameUrl(), {
        method: "POST",
        headers: { ...auth, "Content-Type": "image/jpeg" },
        body: new Uint8Array(body),
      });
    expect((await sendJpeg(jpeg)).status).toBe(204);
    expect((await sendJpeg(Buffer.from([0xff, 0xd8, 0, 0]))).status).toBe(400);
    const portrait = await sharp({
      create: { width: 540, height: 720, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    expect((await sendJpeg(portrait)).status).toBe(204);
    const wrongSize = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    expect((await sendJpeg(wrongSize)).status).toBe(400);
    expect(delivered.map(([w, h]) => [w, h])).toEqual([
      [480, 360],
      [480, 360],
      [540, 720],
    ]);
    expect(
      (
        await fetch(
          `${base}/v1/sessions/${randomUUID()}/frame?timestampUs=1700000000000000`,
          { method: "POST", headers: auth },
        )
      ).status,
    ).toBe(404);
    await fetch(`${base}/v1/sessions/${bridgeSessionId}/stop`, {
      method: "POST",
      headers: auth,
    });
    expect((await send(Buffer.alloc(480 * 360 * 4))).status).toBe(409);
  });

  test("drops late browser frames instead of failing the camera session", async () => {
    const timestamps: number[] = [];
    const adapter: SdkAdapter = {
      kind: "presage-sdk",
      async probe() {
        return { ready: true, reason: null };
      },
      async open() {
        return {
          async close() {},
          sendFrame(_frame, _width, _height, timestampUs) {
            timestamps.push(timestampUs);
          },
        };
      },
    };
    const bridge = new PresageBridge({ token: TOKEN, adapter, port: 0 });
    const port = await bridge.listen();
    cleanup.push(() => bridge.close());
    const base = `http://127.0.0.1:${port}`;
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const started = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ appSessionId: randomUUID(), input: "custom" }),
    });
    const { bridgeSessionId } = BridgeSessionSchema.parse(await started.json());
    const frame = new Uint8Array(480 * 360 * 4);
    const send = (timestampUs: number) =>
      fetch(
        `${base}/v1/sessions/${bridgeSessionId}/frame?timestampUs=${timestampUs}`,
        {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/octet-stream" },
          body: frame,
        },
      );
    expect((await send(200)).status).toBe(204);
    expect((await send(100)).status).toBe(204);
    expect(timestamps).toEqual([200]);
  });

  test("releases an orphaned camera session after its app event stream closes", async () => {
    let closes = 0;
    const adapter: SdkAdapter = {
      kind: "presage-sdk",
      async probe() {
        return { ready: true, reason: null };
      },
      async open() {
        return {
          async close() {
            closes++;
          },
          sendFrame() {},
        };
      },
    };
    const bridge = new PresageBridge({
      token: TOKEN,
      adapter,
      port: 0,
      orphanGraceMs: 10,
    });
    const port = await bridge.listen();
    cleanup.push(() => bridge.close());
    const base = `http://127.0.0.1:${port}`;
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const start = async () =>
      fetch(`${base}/v1/sessions`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ appSessionId: randomUUID(), input: "custom" }),
      });
    const first = await start();
    expect(first.status).toBe(201);
    const { bridgeSessionId } = BridgeSessionSchema.parse(await first.json());
    const events = await fetch(
      `${base}/v1/sessions/${bridgeSessionId}/events?after=-1`,
      { headers: auth },
    );
    expect(events.status).toBe(200);
    bridge.disconnectStreams();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(closes).toBe(1);
    expect((await start()).status).toBe(201);
  });
  test("binds loopback only, on an ephemeral port in tests", async () => {
    const b = await fixtureBridge("valid-steady");
    const a = b.bridge.address();
    expect(a && typeof a === "object" && a.address).toBe("127.0.0.1");
  });

  test("rejects missing/wrong bearer tokens and browser Origin requests", async () => {
    const b = await fixtureBridge("valid-steady");
    expect((await fetch(`${b.base}/v1/health`)).status).toBe(401);
    expect(
      (
        await fetch(`${b.base}/v1/health`, {
          headers: { Authorization: "Bearer nope" },
        })
      ).status,
    ).toBe(401);
    // fetch() forbids setting Origin, so use node:http directly.
    const status = await new Promise<number>((resolve, reject) => {
      const r = request(
        `${b.base}/v1/health`,
        {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Origin: "http://evil.example",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      r.on("error", reject);
      r.end();
    });
    expect(status).toBe(403);
  });

  test("refuses to construct without a sufficiently long token", () => {
    expect(
      () =>
        new PresageBridge({
          token: "",
          adapter: new PresageSdkAdapter(systemClock),
        }),
    ).toThrow(/PRESAGE_BRIDGE_TOKEN/);
    expect(
      () =>
        new PresageBridge({
          token: "short",
          adapter: new PresageSdkAdapter(systemClock),
        }),
    ).toThrow(/PRESAGE_BRIDGE_TOKEN/);
  });
});

describe("health", () => {
  test("fixture adapter is ready and says it is a fixture", async () => {
    const b = await fixtureBridge("valid-steady");
    const h = BridgeHealthSchema.parse(
      await (await b.call("/v1/health")).json(),
    );
    expect(h.status).toBe("ready");
    expect(h.reason).toMatch(/FIXTURE REPLAY/);
  });

  test("real SDK adapter without SMARTSPECTRA_API_KEY reports unavailable and refuses to start", async () => {
    const bridge = new PresageBridge({
      token: TOKEN,
      adapter: new PresageSdkAdapter(systemClock, {}),
      port: 0,
    });
    const port = await bridge.listen();
    cleanup.push(() => bridge.close());
    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    };
    const h = BridgeHealthSchema.parse(
      await (
        await fetch(`http://127.0.0.1:${port}/v1/health`, { headers })
      ).json(),
    );
    expect(h).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/SMARTSPECTRA_API_KEY is not set/),
    });
    const s = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appSessionId: randomUUID() }),
    });
    expect(s.status).toBe(503);
    expect((await s.json()).code).toBe("SDK_UNAVAILABLE");
  });
});

describe("session control", () => {
  test("start validates body, is idempotent per appSessionId, and 409s a second camera", async () => {
    const b = await fixtureBridge("valid-steady");
    expect(
      (await b.call("/v1/sessions", { method: "POST", body: "{}" })).status,
    ).toBe(400);
    expect(
      (
        await b.call("/v1/sessions", {
          method: "POST",
          body: JSON.stringify({ appSessionId: "x" }),
        })
      ).status,
    ).toBe(400);
    const app = randomUUID();
    const first = await b.start(app);
    expect(first.status).toBe(201);
    const { bridgeSessionId } = BridgeSessionSchema.parse(await first.json());
    const again = await b.start(app);
    expect(again.ok).toBe(true);
    expect((await again.json()).bridgeSessionId).toBe(bridgeSessionId);
    const other = await b.start(randomUUID());
    expect(other.status).toBe(409);
    expect((await other.json()).code).toBe("CAMERA_BUSY");
    expect(b.adapter.activeCaptures).toBe(1);
    expect(b.adapter.openCount).toBe(1);
  });

  test("stop is idempotent, releases the camera, and allows a new session", async () => {
    const b = await fixtureBridge("valid-steady");
    const app = randomUUID();
    const { bridgeSessionId } = await (await b.start(app)).json();
    for (let i = 0; i < 2; i++) {
      const r = await b.call(`/v1/sessions/${bridgeSessionId}/stop`, {
        method: "POST",
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ status: "stopped" });
    }
    expect(b.adapter.activeCaptures).toBe(0);
    const restart = await b.start(app);
    expect(restart.status).toBe(409);
    expect((await restart.json()).code).toBe("SESSION_ALREADY_STOPPED");
    expect((await b.start()).status).toBe(201);
    expect(
      (await b.call(`/v1/sessions/nope/stop`, { method: "POST" })).status,
    ).toBe(404);
  });

  test("adapter open failure is a 503 and leaves no camera held", async () => {
    const b = await fixtureBridge("valid-steady", {
      adapterOptions: { failOpen: "fixture camera missing" },
    });
    const r = await b.start();
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("START_FAILED");
    expect(b.adapter.activeCaptures).toBe(0);
  });
});

describe("events stream", () => {
  test("live SSE: numeric monotonic ids, contract-valid events, heartbeat comments, ends on stop", async () => {
    const b = await fixtureBridge("valid-steady", {
      speed: 20,
      heartbeatMs: 50,
    });
    const { bridgeSessionId } = await (await b.start()).json();
    const res = await b.call(`/v1/sessions/${bridgeSessionId}/events`);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    setTimeout(() => {
      void b.call(`/v1/sessions/${bridgeSessionId}/stop`, { method: "POST" });
    }, 600);
    const { msgs, comments, ended } = await readSse(res);
    expect(ended).toBe(true);
    expect(comments).toBeGreaterThan(0);
    assertContract(msgs);
    expect(msgs.at(-1)!.data).toEqual({
      type: "status",
      state: "stopped",
      message: null,
    });
    expect(
      msgs.filter((m) => (m.data as { type: string }).type === "reading")
        .length,
    ).toBeGreaterThan(5);
  });

  test("after cursor replays only later events; bad cursors rejected", async () => {
    const b = await fixtureBridge("valid-steady", { speed: 100 });
    const { bridgeSessionId } = await (await b.start()).json();
    await new Promise((r) => setTimeout(r, 400));
    await b.call(`/v1/sessions/${bridgeSessionId}/stop`, { method: "POST" });
    const all = (
      await readSse(
        await b.call(`/v1/sessions/${bridgeSessionId}/events?after=-1`),
      )
    ).msgs;
    const tail = (
      await readSse(
        await b.call(`/v1/sessions/${bridgeSessionId}/events?after=10`),
      )
    ).msgs;
    expect(tail.map((m) => m.id)).toEqual(
      all.filter((m) => m.id! > 10).map((m) => m.id),
    );
    for (const bad of ["abc", "-2", "1.5", ""])
      expect(
        (await b.call(`/v1/sessions/${bridgeSessionId}/events?after=${bad}`))
          .status,
      ).toBe(400);
    expect((await b.call(`/v1/sessions/unknown/events`)).status).toBe(404);
  });

  test("expired cursor returns 409 REPLAY_EXPIRED", async () => {
    const b = await fixtureBridge("valid-steady", {
      speed: 50,
      replayWindowMs: 100,
    });
    const { bridgeSessionId } = await (await b.start()).json();
    await new Promise((r) => setTimeout(r, 450));
    const r = await b.call(`/v1/sessions/${bridgeSessionId}/events?after=-1`);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("REPLAY_EXPIRED");
  });
});

describe("fixtures produce contract-valid output with explicit validity mapping", () => {
  test.each(FIXTURE_NAMES)("%s validates against app schemas", async (name) => {
    const events = await runFixture(name);
    expect(events.at(-1)).toEqual({
      type: "status",
      state: "stopped",
      message: null,
    });
  });

  test("valid-steady: 20 valid readings, 1s apart, both rates present", async () => {
    const r = readings(await runFixture("valid-steady"));
    expect(r).toHaveLength(20);
    expect(
      r.every(
        (x) => x.quality === "valid" && x.heartRateBpm && x.respiratoryRateBrpm,
      ),
    ).toBe(true);
    const t = r.map((x) => Date.parse(x.timestamp));
    expect(t.slice(1).map((v, i) => v - t[i])).toEqual(Array(19).fill(1000));
  });

  test("low-quality: nothing is promoted to valid", async () => {
    const r = readings(await runFixture("low-quality"));
    expect(r.map((x) => x.quality)).toEqual([
      "invalid",
      "unknown",
      "unknown",
      "invalid",
      "invalid",
      "unknown",
    ]);
    expect(r[3]).toMatchObject({
      heartRateBpm: null,
      respiratoryRateBrpm: null,
    });
    expect(r[0]).toMatchObject({ heartRateBpm: 88, quality: "invalid" });
  });

  test("mixed-validity: splits readings when per-metric validity differs", async () => {
    const r = readings(await runFixture("mixed-validity"));
    expect(
      r.map((x) => [x.heartRateBpm, x.respiratoryRateBrpm, x.quality]),
    ).toEqual([
      [95, null, "valid"],
      [null, 17, "invalid"],
      [94.5, null, "valid"],
      [null, 16.8, "unknown"],
      [94, null, "invalid"],
      [null, 16.5, "valid"],
      [93.6, null, "valid"],
      [null, 16.2, "valid"],
      [93, 16, "valid"],
    ]);
  });

  test("signal-gap: no readings are invented during the gap; positioning status is forwarded", async () => {
    const events = await runFixture("signal-gap");
    const r = readings(events);
    expect(r).toHaveLength(11);
    const t = r.map((x) => Date.parse(x.timestamp));
    expect(t[5] - t[4]).toBe(10_000);
    expect(events).toContainEqual({
      type: "status",
      state: "positioning",
      message: "Fixture: face not detected.",
    });
  });

  test("sdk-error: adapter errors are forwarded with retryability", async () => {
    const errors = (await runFixture("sdk-error")).filter(
      (e) => e.type === "error",
    );
    expect(errors).toEqual([
      {
        type: "error",
        code: "FIXTURE_TRANSIENT",
        message: "Fixture: transient processing error.",
        retryable: true,
      },
      {
        type: "error",
        code: "FIXTURE_FATAL",
        message: "Fixture: camera disconnected.",
        retryable: false,
      },
    ]);
  });
});
