import type { BridgeEvent } from "./contract.js";

export interface LoggedEvent {
  id: number;
  atMonotonicMs: number;
  event: BridgeEvent;
}

export type ReplayResult =
  { ok: true; events: LoggedEvent[] } | { ok: false; code: "REPLAY_EXPIRED" };

/**
 * Per-session event log with numeric monotonic IDs (starting at 0) and a
 * time-bounded replay window (contract: replay latest 120 seconds).
 */
export class EventLog {
  private entries: LoggedEvent[] = [];
  private nextId = 0;
  /** Highest ID that has been pruned from the window; -1 if none. */
  private prunedThrough = -1;
  private listeners = new Set<(e: LoggedEvent) => void>();

  constructor(
    private windowMs: number,
    private now: () => number,
  ) {}

  append(event: BridgeEvent): LoggedEvent {
    const entry = { id: this.nextId++, atMonotonicMs: this.now(), event };
    this.entries.push(entry);
    this.prune();
    for (const l of this.listeners) l(entry);
    return entry;
  }

  prune() {
    const cutoff = this.now() - this.windowMs;
    let i = 0;
    while (i < this.entries.length && this.entries[i].atMonotonicMs < cutoff)
      i++;
    if (i > 0) {
      this.prunedThrough = this.entries[i - 1].id;
      this.entries = this.entries.slice(i);
    }
  }

  /** Events with id > after. Expired if any such event was already pruned. */
  replay(after: number): ReplayResult {
    this.prune();
    if (after < this.prunedThrough)
      return { ok: false, code: "REPLAY_EXPIRED" };
    return { ok: true, events: this.entries.filter((e) => e.id > after) };
  }

  subscribe(f: (e: LoggedEvent) => void) {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  }

  get lastId() {
    return this.nextId - 1;
  }
}
