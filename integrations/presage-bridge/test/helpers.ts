import { randomUUID } from "node:crypto";
import { systemClock, type Clock } from "../src/adapter.js";
import {
  FixtureAdapter,
  loadFixture,
  type FixtureAdapterOptions,
  type FixtureName,
} from "../src/adapters/fixture.js";
import { PresageBridge, type BridgeOptions } from "../src/server.js";

export const TOKEN = "test-token-0123456789abcdef";

export async function startFixtureBridge(
  name: FixtureName,
  opts: Partial<BridgeOptions> & {
    speed?: number;
    adapterOptions?: Partial<FixtureAdapterOptions>;
    clock?: Clock;
  } = {},
) {
  const clock = opts.clock ?? systemClock;
  const adapter = new FixtureAdapter({
    fixture: loadFixture(name),
    clock,
    speed: opts.speed ?? 50,
    ...opts.adapterOptions,
  });
  const bridge = new PresageBridge({
    token: TOKEN,
    adapter,
    clock,
    port: 0,
    ...opts,
  });
  const port = await bridge.listen();
  const base = `http://127.0.0.1:${port}`;
  const call = (path: string, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  const start = (appSessionId: string = randomUUID()) =>
    call("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ appSessionId }),
    });
  return { bridge, adapter, base, port, call, start };
}

export interface SseMessage {
  id: number | null;
  data: unknown;
}

/** Read an SSE response until it ends, `until` returns true, or timeout. */
export async function readSse(
  res: Response,
  until: (msgs: SseMessage[]) => boolean = () => false,
  timeoutMs = 5000,
) {
  const msgs: SseMessage[] = [];
  let comments = 0;
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  let ended = false;
  try {
    while (Date.now() < deadline) {
      const timer = new Promise<"timeout">((r) =>
        setTimeout(() => r("timeout"), Math.max(1, deadline - Date.now())),
      );
      const next = await Promise.race([reader.read(), timer]);
      if (next === "timeout") break;
      if (next.done) {
        ended = true;
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      let i: number;
      while ((i = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const lines = block.split("\n");
        if (lines.every((l) => l.startsWith(":"))) {
          comments++;
          continue;
        }
        const idLine = lines.find((l) => l.startsWith("id:"));
        const data = lines
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        msgs.push({
          id: idLine ? Number(idLine.slice(3).trim()) : null,
          data: JSON.parse(data),
        });
      }
      if (until(msgs)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { msgs, comments, ended };
}

export class ManualClock implements Clock {
  constructor(
    public mono = 1000,
    public wall = Date.parse("2026-10-10T12:00:00.000Z"),
  ) {}
  monotonicMs() {
    return this.mono;
  }
  wallMs() {
    return this.wall;
  }
  advance(ms: number) {
    this.mono += ms;
    this.wall += ms;
  }
}
