import { useEffect, useState } from "react";
import { BridgeEventSchema, VitalReadingSchema } from "@siteguard/contracts";
import type { ReadingEnvelope, MeasurementEvent } from "@siteguard/contracts";
export function useSessionStream(id: string, enabled: boolean) {
  const [readings, setReadings] = useState<ReadingEnvelope[]>([]),
    [status, setStatus] = useState("Connecting to measurement source…"),
    [error, setError] = useState("");
  useEffect(() => {
    setReadings([]);
    setError("");
    setStatus("Connecting to measurement source…");
    if (!enabled) return;
    const stream = new EventSource(`/api/sessions/${id}/events`);
    stream.onopen = () => {
      setStatus("Connected");
      setError("");
    };
    stream.onmessage = (e) => {
      let event: MeasurementEvent;
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.type === "reading") {
          if (!Number.isSafeInteger(parsed.sequence) || parsed.sequence < 0)
            throw new Error("Invalid reading sequence");
          event = {
            type: "reading",
            sequence: parsed.sequence,
            reading: VitalReadingSchema.parse(parsed.reading),
          };
        } else {
          const decoded = BridgeEventSchema.parse(parsed);
          if (decoded.type === "reading") throw new Error("Missing sequence");
          event = decoded;
        }
      } catch {
        setError(
          "An invalid measurement event was ignored. No safety conclusion can be drawn.",
        );
        setStatus("Measurement data interrupted");
        return;
      }
      if (event.type === "reading") {
        setStatus("Connected · receiving observations");
        setError("");
        setReadings((previous) =>
          previous.some((x) => x.sequence === event.sequence)
            ? previous
            : [
                ...previous,
                { sequence: event.sequence, reading: event.reading },
              ].sort((a, b) => a.sequence - b.sequence),
        );
      } else if (event.type === "error") {
        setError(event.message);
        setStatus("Measurement interrupted");
        // Access ended for this viewer; reconnecting would only be refused.
        if (event.code === "SHARING_WITHDRAWN") stream.close();
      } else {
        setStatus(event.message || event.state);
        if (event.state === "stopped") stream.close();
      }
    };
    stream.onerror = () => {
      setStatus("Connection interrupted · reconnecting");
      setError("The stream is unavailable. No safety conclusion can be drawn.");
    };
    return () => stream.close();
  }, [id, enabled]);
  return { readings, status, error };
}
