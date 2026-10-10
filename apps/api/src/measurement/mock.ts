import type { MeasurementSource, MeasurementEvent } from "@siteguard/contracts";
import { mockReading } from "@siteguard/mock-data";
export class MockSource implements MeasurementSource {
  private listeners = new Set<(e: MeasurementEvent) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private startTime = "";
  private sequence = -1;
  constructor(private intervalMs = 1000) {}
  subscribe(f: (e: MeasurementEvent) => void) {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  }
  private emit(e: MeasurementEvent) {
    for (const f of this.listeners) f(e);
  }
  async start() {
    this.startTime = new Date().toISOString();
    this.emit({
      type: "status",
      state: "measuring",
      message: "Synthetic demonstration stream. No camera is used.",
    });
    const tick = () => {
      const elapsed = Math.floor(
        (Date.now() - Date.parse(this.startTime)) / 1000,
      );
      if (elapsed > this.sequence) {
        this.sequence = elapsed;
        this.emit({ type: "reading", ...mockReading(this.startTime, elapsed) });
      }
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }
  async stop() {
    clearInterval(this.timer);
    this.emit({ type: "status", state: "stopped", message: null });
  }
}
