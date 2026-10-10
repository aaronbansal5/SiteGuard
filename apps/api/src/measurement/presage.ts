import {
  BridgeEventSchema,
  BridgeHealthSchema,
  BridgeSessionSchema,
  type MeasurementEvent,
  type MeasurementSource,
} from "@siteguard/contracts";
import type { Config } from "../config.js";
export class PresageSource implements MeasurementSource {
  private listeners = new Set<(e: MeasurementEvent) => void>();
  private bridgeSessionId?: string;
  private controller?: AbortController;
  private running = false;
  private task?: Promise<void>;
  private cursor = -1;
  constructor(private config: Config) {}
  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.bridgeToken || ""}`,
    };
  }
  private url(path: string) {
    return new URL(path, this.config.bridgeUrl).toString();
  }
  subscribe(f: (e: MeasurementEvent) => void) {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  }
  private emit(e: MeasurementEvent) {
    for (const f of this.listeners) f(e);
  }
  async start(id: string) {
    if (this.config.hosted)
      throw new Error(
        "Real measurements are restricted to the local application",
      );
    if (!this.config.bridgeToken)
      throw new Error("Presage bridge token is not configured");
    const h = await fetch(this.url("/v1/health"), {
      headers: this.headers(),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!h.ok) throw new Error("Presage bridge health check failed");
    const health = BridgeHealthSchema.parse(await h.json());
    if (health.status !== "ready")
      throw new Error("Presage bridge is not ready");
    const response = await fetch(this.url("/v1/sessions"), {
      method: "POST",
      headers: this.headers(),
      redirect: "error",
      body: JSON.stringify({ appSessionId: id }),
      // Camera + SDK pipeline startup is slower than a health check (observed
      // several seconds on macOS with SmartSpectra 3.4.0).
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error("Presage bridge could not start a camera session");
    this.bridgeSessionId = BridgeSessionSchema.parse(
      await response.json(),
    ).bridgeSessionId;
    this.running = true;
    this.task = this.stream();
  }
  private async stream() {
    let failures = 0;
    while (this.running) {
      this.controller = new AbortController();
      try {
        const connectionDeadline = setTimeout(
          () => this.controller?.abort(),
          15000,
        );
        let response: Response;
        try {
          response = await fetch(
            this.url(
              `/v1/sessions/${encodeURIComponent(this.bridgeSessionId!)}/events?after=${this.cursor}`,
            ),
            {
              headers: this.headers(),
              redirect: "error",
              signal: this.controller.signal,
            },
          );
        } finally {
          clearTimeout(connectionDeadline);
        }
        if (response.status === 409) {
          this.emit({
            type: "error",
            code: "REPLAY_EXPIRED",
            message:
              "Bridge replay expired. Stop this session and begin a new check-in.",
            retryable: false,
          });
          this.running = false;
          break;
        }
        if (!response.ok || !response.body)
          throw new Error("Stream unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
          clearTimeout(watchdog);
          watchdog = setTimeout(() => this.controller?.abort(), 15000);
        };
        arm();
        try {
          while (this.running) {
            const { value, done } = await reader.read();
            if (done) throw new Error("Bridge stream disconnected");
            arm();
            buffer = (buffer + decoder.decode(value, { stream: true })).replace(
              /\r\n/g,
              "\n",
            );
            if (buffer.length > 1024 * 1024)
              throw new Error("Bridge event too large");
            let index: number;
            while ((index = buffer.indexOf("\n\n")) !== -1) {
              const block = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);
              const data = block
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .join("\n");
              if (!data) continue;
              const event = BridgeEventSchema.parse(JSON.parse(data));
              if (event.type === "reading") {
                const raw = block
                  .split("\n")
                  .find((l) => l.startsWith("id:"))
                  ?.slice(3)
                  .trim();
                const sequence = Number(raw);
                if (
                  raw === undefined ||
                  !Number.isSafeInteger(sequence) ||
                  sequence < 0 ||
                  event.reading.source !== "presage"
                )
                  throw new Error("Invalid bridge sequence/source");
                if (sequence <= this.cursor) continue;
                this.cursor = sequence;
                this.emit({ ...event, sequence });
              } else this.emit(event);
              failures = 0;
            }
          }
        } finally {
          clearTimeout(watchdog);
          this.controller?.abort();
          reader.releaseLock();
        }
      } catch {
        if (!this.running) break;
        this.emit({
          type: "error",
          code: "BRIDGE_DISCONNECTED",
          message: "Presage connection interrupted; reconnecting.",
          retryable: failures < 3,
        });
        if (failures >= 3) {
          this.running = false;
          break;
        }
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, [1000, 2000, 4000][failures++]);
          this.controller!.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve(null);
            },
            { once: true },
          );
        });
      }
    }
  }
  async stop() {
    this.running = false;
    this.controller?.abort();
    await this.task;
    if (this.bridgeSessionId) {
      const r = await fetch(
        this.url(
          `/v1/sessions/${encodeURIComponent(this.bridgeSessionId)}/stop`,
        ),
        {
          method: "POST",
          headers: this.headers(),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!r.ok)
        throw new Error(
          "Bridge stop failed; confirm the camera is stopped before retrying",
        );
    }
    this.emit({ type: "status", state: "stopped", message: null });
  }
}
