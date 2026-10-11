import type { MeasurementEvent, MeasurementSource } from "@siteguard/contracts";
import type { Repository } from "../db/repository.js";
import type { Config } from "../config.js";
import { MockSource } from "./mock.js";
import { PresageSource, PresageStartError } from "./presage.js";
export class MeasurementManager {
  private active = new Map<
    string,
    {
      source: MeasurementSource;
      pending: Promise<unknown>;
      starting: Promise<void>;
      unsubscribe: () => void;
    }
  >();
  private listeners = new Map<string, Set<(e: MeasurementEvent) => void>>();
  private states = new Map<string, MeasurementEvent>();
  constructor(
    private repo: Repository,
    private config: Config,
  ) {}
  subscribe(id: string, listener: (e: MeasurementEvent) => void) {
    const set = this.listeners.get(id) || new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }
  status(id: string) {
    return this.states.get(id);
  }
  private publish(id: string, event: MeasurementEvent) {
    if (event.type !== "reading") {
      this.states.set(id, event);
      if (this.states.size > 1000) {
        for (const key of this.states.keys()) {
          if (!this.active.has(key)) this.states.delete(key);
          if (this.states.size <= 1000) break;
        }
      }
    }
    for (const f of this.listeners.get(id) || []) f(event);
  }
  async start(
    id: string,
    kind: "mock" | "presage",
    input: "camera" | "custom" = "camera",
  ) {
    const source =
      kind === "mock"
        ? new MockSource(this.config.mockIntervalMs)
        : new PresageSource(this.config, input);
    const state = {
      source,
      pending: Promise.resolve() as Promise<unknown>,
      starting: Promise.resolve(),
      unsubscribe: () => {},
    };
    state.unsubscribe = source.subscribe((event) => {
      state.pending = state.pending
        .then(async () => {
          if (event.type === "reading") {
            await this.repo.ingest(id, [
              { sequence: event.sequence, reading: event.reading },
            ]);
          } else if (event.type === "error") {
            await this.repo.transaction(async (r) => {
              const s = await r.get("sessions", id);
              if (s) {
                s.interruption =
                  "The measurement stream was interrupted; the summary includes available observations only.";
                await r.put("sessions", s);
              }
            });
          }
          this.publish(id, event);
        })
        .catch(() => {
          this.publish(id, {
            type: "error",
            code: "MEASUREMENT_STORAGE",
            message:
              "A measurement could not be saved. No safety conclusion can be drawn.",
            retryable: true,
          });
        });
    });
    this.active.set(id, state);
    try {
      state.starting = source.start(id);
      await state.starting;
    } catch (error) {
      const message =
        error instanceof PresageStartError
          ? error.message
          : "Presage could not connect or finish camera startup. Check the bridge and begin a fresh check-in.";
      this.publish(id, {
        type: "error",
        code: "SOURCE_UNAVAILABLE",
        message,
        retryable: false,
      });
      await this.repo.transaction(async (r) => {
        const s = await r.get("sessions", id);
        if (s) {
          s.interruption = `Measurement source failed to start. ${message}`;
          await r.put("sessions", s);
        }
      });
    }
  }
  async sendFrame(
    id: string,
    frame: Buffer,
    timestampUs: number,
    contentType:
      "application/octet-stream" | "image/jpeg" = "application/octet-stream",
  ) {
    const state = this.active.get(id);
    if (!state || !(state.source instanceof PresageSource))
      throw new Error("Presage session is not active");
    await state.starting;
    await state.source.sendFrame(frame, timestampUs, contentType);
  }
  async stop(id: string) {
    const state = this.active.get(id);
    if (!state) return;
    // Completion must not race a bridge start and leave a camera running after
    // the session is marked completed. A failed start is still stoppable.
    await state.starting.catch(() => {});
    await state.source.stop();
    await state.pending;
    state.unsubscribe();
    this.active.delete(id);
  }
  async close() {
    for (const id of this.active.keys())
      try {
        await this.stop(id);
      } catch {
        /* next startup visibly finalizes interrupted sessions */
      }
  }
}
