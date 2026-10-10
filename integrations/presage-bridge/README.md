# Developer 2 handoff: native Presage bridge
This directory is reserved for the independently implemented native SDK bridge. No real SDK integration is claimed or implemented here. Developer 1's tested HTTP/SSE consumer lives in `apps/api/src/measurement/presage.ts`; a fixture transport test is in `apps/api/test/bridge.test.ts`.

Implement exactly `docs/PRESAGE_CONTRACT.md`. Use a separate package/lockfile, outside root workspaces. Verify current vendor docs: https://smartspectra.presagetech.com/docs/nodejs/ . The documented SDK is native Node/Electron, not a browser React dependency.

Checklist: API key; Node/runtime/platform; camera permissions; verified decoded pulse/breathing fields; per-metric validity mapping; monotonic-to-UTC clock mapping; heartbeat/replay; idempotent start/stop; shared token; loopback binding; source honesty; SDK processing/telemetry privacy. Supply normalized sample fixtures and a standalone hardware smoke command.

Once ready, set `PRESAGE_BRIDGE_TOKEN` and `PRESAGE_BRIDGE_URL` in the app's root `.env`. Start the bridge and app on the same laptop. Choose Presage in a new worker check-in. Do not change source in an existing session or compare Presage observations against synthetic history.
