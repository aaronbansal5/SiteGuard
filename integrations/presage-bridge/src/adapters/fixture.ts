import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  AdapterCapture,
  AdapterHandlers,
  AdapterProbe,
  Clock,
  SdkAdapter,
} from "../adapter.js";

/**
 * FIXTURE ADAPTER -- replays adapter-level samples from JSON fixtures.
 *
 * Fixtures are hand-authored in the normalized AdapterSample form. They are NOT
 * recordings of Presage SDK output (none was available) and contain no vendor
 * field names. Readings produced from them are labelled source "presage" only
 * because the bridge wire contract has no other value; never point the
 * application at a fixture-backed bridge for a real check-in. The CLI
 * (src/cli.ts) therefore never uses this adapter.
 */
const Metric = z.strictObject({
  // NaN/Infinity cannot be expressed in JSON; null covers "no number".
  value: z.number().nullable(),
  status: z.enum(["valid", "invalid", "unknown"]),
});
const FixtureEvent = z.discriminatedUnion("type", [
  z.strictObject({
    atMs: z.number().nonnegative(),
    type: z.literal("sample"),
    pulse: Metric.nullable(),
    breathing: Metric.nullable(),
  }),
  z.strictObject({
    atMs: z.number().nonnegative(),
    type: z.literal("status"),
    state: z.enum(["positioning", "measuring"]),
    message: z.string().nullable(),
  }),
  z.strictObject({
    atMs: z.number().nonnegative(),
    type: z.literal("error"),
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export const FixtureSchema = z.strictObject({
  fixtureFormat: z.literal(1),
  name: z.string().min(1),
  provenance: z.string().min(1),
  description: z.string(),
  events: z.array(FixtureEvent).min(1),
});
export type Fixture = z.infer<typeof FixtureSchema>;

export const FIXTURE_NAMES = [
  "valid-steady",
  "low-quality",
  "mixed-validity",
  "signal-gap",
  "sdk-error",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function loadFixture(name: FixtureName): Fixture {
  const path = fileURLToPath(
    new URL(`../../fixtures/${name}.json`, import.meta.url),
  );
  return FixtureSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export interface FixtureAdapterOptions {
  fixture: Fixture;
  clock: Clock;
  /** Replay speed multiplier for wall-clock scheduling (timestamps unaffected). */
  speed?: number;
  /** Simulate a probe failure (e.g. camera missing). */
  unavailableReason?: string;
  /** Simulate open() failure. */
  failOpen?: string;
}

export class FixtureAdapter implements SdkAdapter {
  readonly kind = "fixture" as const;
  /** Number of captures currently holding the (simulated) camera. */
  activeCaptures = 0;
  openCount = 0;
  constructor(private options: FixtureAdapterOptions) {}

  async probe(): Promise<AdapterProbe> {
    if (this.options.unavailableReason)
      return { ready: false, reason: this.options.unavailableReason };
    return {
      ready: true,
      reason: `FIXTURE REPLAY '${this.options.fixture.name}': not a real Presage measurement`,
    };
  }

  async open(handlers: AdapterHandlers): Promise<AdapterCapture> {
    if (this.options.failOpen) throw new Error(this.options.failOpen);
    const { fixture, clock } = this.options;
    const speed = this.options.speed ?? 1;
    const startMono = clock.monotonicMs();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let closed = false;
    this.activeCaptures++;
    this.openCount++;
    for (const e of fixture.events) {
      timers.push(
        setTimeout(() => {
          if (closed) return;
          if (e.type === "sample")
            handlers.onSample({
              monotonicMs: startMono + e.atMs,
              pulse: e.pulse,
              breathing: e.breathing,
            });
          else if (e.type === "status") handlers.onStatus(e.state, e.message);
          else handlers.onError(e.code, e.message, e.retryable);
        }, e.atMs / speed),
      );
    }
    return {
      close: async () => {
        if (closed) return;
        closed = true;
        for (const t of timers) clearTimeout(t);
        this.activeCaptures--;
      },
    };
  }
}
