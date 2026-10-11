import { expect, it } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { encodePreview } from "../src/preview.js";
import { PresageBridge } from "../src/server.js";
import type { SdkAdapter } from "../src/adapter.js";
it("renders padded BGRA in the correct colors and rejects unsupported/truncated frames", async () => {
  const jpeg = await encodePreview(
    Buffer.from([0, 0, 255, 255, 99, 99]),
    1,
    1,
    6,
    3,
  );
  const pixel = await sharp(jpeg!).raw().toBuffer();
  expect(pixel[0]).toBeGreaterThan(220);
  expect(pixel[1]).toBeLessThan(20);
  expect(pixel[2]).toBeLessThan(20);
  expect(await encodePreview(Buffer.alloc(1), 10, 10, 30, 0)).toBeNull();
  expect(await encodePreview(Buffer.alloc(4), 1, 1, 4, 99)).toBeNull();
});
it("authenticates preview access and clears the frame after camera stop", async () => {
  const jpeg = await encodePreview(Buffer.from([255, 0, 0]), 1, 1, 3, 0);
  const adapter: SdkAdapter = {
    kind: "fixture",
    probe: async () => ({ ready: true, reason: null }),
    open: async (handlers) => {
      handlers.onPreview?.(jpeg!);
      return { close: async () => {} };
    },
  };
  const bridge = new PresageBridge({
    adapter,
    token: "preview-test-token",
    port: 0,
  });
  const port = await bridge.listen();
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    Authorization: "Bearer preview-test-token",
    "Content-Type": "application/json",
  };
  const appSessionId = randomUUID();
  try {
    const response = await fetch(base + "/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ appSessionId }),
    });
    const { bridgeSessionId } = await response.json();
    await new Promise((r) => setTimeout(r, 20));
    expect((await fetch(base + `/v1/previews/${appSessionId}`)).status).toBe(
      401,
    );
    const frame = await fetch(base + `/v1/previews/${appSessionId}`, {
      headers,
    });
    expect(frame.status).toBe(200);
    expect(frame.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await frame.arrayBuffer())).toEqual(jpeg);
    await fetch(base + `/v1/sessions/${bridgeSessionId}/stop`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(
      (await fetch(base + `/v1/previews/${appSessionId}`, { headers })).status,
    ).toBe(204);
  } finally {
    await bridge.close();
  }
});
