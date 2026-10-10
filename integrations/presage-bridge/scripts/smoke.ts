/**
 * Standalone bridge smoke test.
 *
 *   npm run smoke            -> in-process bridge + FixtureAdapter (no camera, no SDK)
 *   npm run smoke:hardware   -> in-process bridge + PresageSdkAdapter (real camera);
 *                               currently fails fast because the SDK is UNVERIFIED.
 *
 * Every event is validated with the application's own Zod schemas from
 * packages/contracts (requires the repo root `npm install`).
 * Both modes bind 127.0.0.1 on an ephemeral port with a random token, so they
 * never collide with (or impersonate) a bridge on 4311.
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  BridgeEventSchema,
  BridgeHealthSchema,
  BridgeSessionSchema,
} from "../../../packages/contracts/src/index.js";
import { systemClock, type SdkAdapter } from "../src/adapter.js";
import { FixtureAdapter, loadFixture } from "../src/adapters/fixture.js";
import { PresageSdkAdapter } from "../src/adapters/presage-sdk.js";
import { PresageBridge } from "../src/server.js";

const hardware = process.argv.includes("--hardware");
const token = randomBytes(24).toString("hex");
let failures = 0;
const pass = (m: string) => console.log(`PASS ${m}`);
const fail = (m: string) => {
  failures++;
  console.log(`FAIL ${m}`);
};
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));

const adapter: SdkAdapter = hardware
  ? new PresageSdkAdapter(systemClock)
  : new FixtureAdapter({
      fixture: loadFixture("valid-steady"),
      clock: systemClock,
      speed: 10,
    });
const bridge = new PresageBridge({ token, adapter, port: 0 });
const port = await bridge.listen();
const base = `http://127.0.0.1:${port}`;
console.log(
  `smoke mode=${hardware ? "hardware (PresageSdkAdapter)" : "fixture (valid-steady, SYNTHETIC)"} bridge=${base}`,
);
const call = (path: string, init: RequestInit = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

interface Msg {
  id: number;
  data: unknown;
}
async function read(
  after: number,
  stopWhen: (m: Msg[]) => boolean,
  timeoutMs: number,
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const msgs: Msg[] = [];
  try {
    const res = await call(`/v1/sessions/${sessionId}/events?after=${after}`, {
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`events HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const lines = block.split("\n");
        const data = lines
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data) continue;
        const id = Number(
          lines
            .find((l) => l.startsWith("id:"))
            ?.slice(3)
            .trim(),
        );
        msgs.push({ id, data: JSON.parse(data) });
      }
      if (stopWhen(msgs)) break;
    }
    ctrl.abort();
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
  } finally {
    clearTimeout(timer);
  }
  return msgs;
}

let sessionId = "";
try {
  check(
    (await fetch(`${base}/v1/health`)).status === 401,
    "health without token -> 401",
  );
  const health = BridgeHealthSchema.parse(
    await (await call("/v1/health")).json(),
  );
  pass(
    `health matches app BridgeHealthSchema (status=${health.status}, reason=${JSON.stringify(health.reason)})`,
  );
  if (health.status !== "ready") {
    fail(
      `bridge not ready; ${hardware ? "HARDWARE SMOKE NOT RUN (real SDK not wired/verified)" : "fixture should be ready"}`,
    );
    throw new Error("not ready");
  }
  const appSessionId = randomUUID();
  const started = await call("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ appSessionId }),
  });
  if (started.status !== 201) {
    const body = await started.text();
    check(false, `start -> 201 (got ${started.status}: ${body.slice(0, 300)})`);
    throw new Error("start failed; see bridge error above");
  }
  check(true, "start -> 201");
  sessionId = BridgeSessionSchema.parse(await started.json()).bridgeSessionId;
  const again = await call("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ appSessionId }),
  });
  check(
    again.ok && (await again.json()).bridgeSessionId === sessionId,
    "same appSessionId returns existing session",
  );
  const busy = await call("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ appSessionId: randomUUID() }),
  });
  check(busy.status === 409, "second camera session -> 409");

  const readingCount = (m: Msg[]) =>
    m.filter((x) => (x.data as { type: string }).type === "reading").length;
  const first = await read(
    -1,
    (m) => readingCount(m) >= 5,
    hardware ? 60_000 : 10_000,
  );
  check(
    readingCount(first) >= 5,
    `received ${readingCount(first)} readings on first connection`,
  );
  const cursor = first.at(-1)?.id ?? -1;
  // Simulated reconnect: new connection resuming from the last seen id.
  const second = await read(
    cursor,
    (m) => readingCount(m) >= 5,
    hardware ? 60_000 : 10_000,
  );
  check(
    second.every((m) => m.id > cursor),
    `reconnect with after=${cursor} returned only newer ids`,
  );
  const all = [...first, ...second];
  let ok = true;
  let last = -1;
  for (const m of all) {
    const parsed = BridgeEventSchema.safeParse(m.data);
    if (!parsed.success || !Number.isSafeInteger(m.id) || m.id <= last)
      ok = false;
    if (
      parsed.success &&
      parsed.data.type === "reading" &&
      parsed.data.reading.source !== "presage"
    )
      ok = false;
    last = m.id;
  }
  check(
    ok,
    `${all.length} events match app BridgeEventSchema with strictly increasing numeric ids`,
  );
  const qualities = all.flatMap((m) => {
    const p = BridgeEventSchema.parse(m.data);
    return p.type === "reading" ? [p.reading.quality] : [];
  });
  console.log(
    `info qualities: ${JSON.stringify(qualities.reduce<Record<string, number>>((a, q) => ({ ...a, [q]: (a[q] ?? 0) + 1 }), {}))}`,
  );

  for (let i = 0; i < 2; i++) {
    const s = await call(`/v1/sessions/${sessionId}/stop`, { method: "POST" });
    check(
      s.status === 200 && (await s.json()).status === "stopped",
      `stop #${i + 1} -> {status:"stopped"}`,
    );
  }
  if (adapter instanceof FixtureAdapter)
    check(adapter.activeCaptures === 0, "camera (fixture) released after stop");
  const tail = await read(-1, () => false, 5000);
  check(
    JSON.stringify(tail.at(-1)?.data) ===
      JSON.stringify({ type: "status", state: "stopped", message: null }),
    "stopped session stream replays and ends with status=stopped",
  );
  check(
    (
      await call("/v1/sessions", {
        method: "POST",
        body: JSON.stringify({ appSessionId: randomUUID() }),
      })
    ).status === 201,
    "new session can start after stop",
  );
} catch (e) {
  if (!(e instanceof Error && e.message === "not ready"))
    fail(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await bridge.close();
}
console.log(
  failures ? `SMOKE FAILED (${failures} failure(s))` : "SMOKE PASSED",
);
if (!hardware)
  console.log(
    "note: fixture data is SYNTHETIC; this does not verify the Presage SDK, camera, or vendor output.",
  );
process.exit(failures ? 1 : 0);
