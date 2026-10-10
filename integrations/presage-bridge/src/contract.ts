/**
 * Wire types for docs/PRESAGE_CONTRACT.md v1 (application-owned protocol).
 *
 * The bridge is an independent package, so these are a local mirror of the
 * shapes in packages/contracts/src/measurement.ts and models.ts. The contract
 * tests in test/ validate real bridge output against the application's Zod
 * schemas so the two cannot silently drift.
 */
export type Quality = "valid" | "invalid" | "unknown";

export interface VitalReading {
  /** ISO 8601 UTC, derived from the capture's monotonic-to-UTC anchor. */
  timestamp: string;
  heartRateBpm: number | null;
  respiratoryRateBrpm: number | null;
  quality: Quality;
  source: "presage";
}

export type BridgeEvent =
  | { type: "reading"; reading: VitalReading }
  | {
      type: "status";
      state: "positioning" | "measuring" | "stopped";
      message: string | null;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

export interface BridgeHealth {
  protocolVersion: 1;
  source: "presage";
  status: "ready" | "unavailable";
  reason: string | null;
}

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_PORT = 4311;
/** Contract: bridge listens on loopback only. Not configurable on purpose. */
export const LOOPBACK_HOST = "127.0.0.1";
export const HEARTBEAT_MS = 5000;
export const REPLAY_WINDOW_MS = 120_000;
