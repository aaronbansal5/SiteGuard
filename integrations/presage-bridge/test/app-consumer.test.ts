import { afterEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
// The application's real bridge consumer (owned by Developer 1). Imported
// read-only to prove end-to-end compatibility, including reconnect/dedup.
import { PresageSource } from "../../../apps/api/src/measurement/presage.js";
import type { Config } from "../../../apps/api/src/config.js";
import type { MeasurementEvent } from "../../../packages/contracts/src/index.js";
import { startFixtureBridge, TOKEN } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function consumer(port: number) {
  return new PresageSource({
    bridgeUrl: `http://127.0.0.1:${port}`,
    bridgeToken: TOKEN,
    hosted: false,
  } as Config);
}

test("apps/api PresageSource consumes the bridge, reconnects after a dropped stream without duplicates, and stops it", async () => {
  const b = await startFixtureBridge("valid-steady", { speed: 10 });
  cleanup.push(() => b.bridge.close());
  const source = consumer(b.port);
  const events: MeasurementEvent[] = [];
  source.subscribe((e) => events.push(e));
  await source.start(randomUUID());
  const readings = () =>
    events.filter(
      (e): e is Extract<MeasurementEvent, { type: "reading" }> =>
        e.type === "reading",
    );
  await expect
    .poll(() => readings().length, { timeout: 5000 })
    .toBeGreaterThanOrEqual(5);
  b.bridge.disconnectStreams();
  await expect
    .poll(() =>
      events.some(
        (e) => e.type === "error" && e.code === "BRIDGE_DISCONNECTED",
      ),
    )
    .toBe(true);
  // Consumer retries after 1s with ?after=<last sequence>; readings continue.
  await expect.poll(() => readings().length, { timeout: 6000 }).toBe(20);
  await source.stop();
  const seq = readings().map((e) => e.sequence);
  expect(new Set(seq).size).toBe(seq.length);
  expect([...seq].sort((a, c) => a - c)).toEqual(seq);
  expect(readings().every((e) => e.reading.source === "presage")).toBe(true);
  expect(b.adapter.activeCaptures).toBe(0);
  expect(events.at(-1)).toEqual({
    type: "status",
    state: "stopped",
    message: null,
  });
});

test("apps/api PresageSource start fails cleanly when the real SDK adapter has no API key", async () => {
  const { PresageBridge } = await import("../src/server.js");
  const { PresageSdkAdapter } = await import("../src/adapters/presage-sdk.js");
  const { systemClock } = await import("../src/adapter.js");
  const bridge = new PresageBridge({
    token: TOKEN,
    adapter: new PresageSdkAdapter(systemClock, {}),
    port: 0,
  });
  const port = await bridge.listen();
  cleanup.push(() => bridge.close());
  await expect(consumer(port).start(randomUUID())).rejects.toThrow(/not ready/);
});
