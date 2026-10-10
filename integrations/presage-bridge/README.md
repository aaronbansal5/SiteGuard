# Presage bridge (Developer 2)

Loopback-only HTTP/SSE bridge implementing `docs/PRESAGE_CONTRACT.md` v1. The
application consumer is `apps/api/src/measurement/presage.ts`.

**Status: the real Presage SmartSpectra SDK is NOT wired in and NOT verified.**
The bridge server, contract behavior, fixtures, tests, and smoke command are
done. The production entry point (`npm start`) uses `PresageSdkAdapter`, which
reports `status: "unavailable"` and refuses to start sessions until someone
with SDK access, credentials, and a camera finishes it (see "What remains").
No SDK success is claimed or simulated outside the explicitly labelled fixture
adapter.

## Layout

| Path                          | Purpose                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/server.ts`               | `PresageBridge`: routes, auth, session lifecycle, SSE, heartbeat, replay                             |
| `src/adapter.ts`              | **Vendor boundary**: `SdkAdapter`, `AdapterSample`, `Clock`. SiteGuard-owned types, not Presage APIs |
| `src/adapters/presage-sdk.ts` | `PresageSdkAdapter` stub. Throws `SdkNotVerifiedError`; TODOs list every field it must fill          |
| `src/adapters/fixture.ts`     | `FixtureAdapter`: replays `fixtures/*.json`. Tests and smoke only; the CLI never uses it             |
| `src/normalize.ts`            | Sample to contract `VitalReading`(s): validity mapping, metric splitting, monotonic-to-UTC           |
| `src/event-log.ts`            | Per-session numeric event IDs and the 120 s replay window                                            |
| `src/cli.ts`                  | `npm start` entry point                                                                              |
| `fixtures/`                   | Synthetic, hand-authored adapter samples (see below)                                                 |
| `test/`                       | Vitest contract tests, validated against `packages/contracts` schemas and the app's `PresageSource`  |
| `scripts/smoke.ts`            | Standalone smoke command                                                                             |

This is its own package with its own `package-lock.json`, outside the root
workspaces. Tests and smoke import the app's schemas from
`packages/contracts` and its consumer from `apps/api` by relative path, so you
need to run the repo root `npm install` too.

## Run

```sh
# from the repo root (needed for packages/contracts' zod)
npm install
cd integrations/presage-bridge
npm install
npm test               # vitest contract tests (fixture adapter)
npm run typecheck
npm run smoke          # in-process bridge + FixtureAdapter; exits 0 on pass
npm run smoke:hardware # in-process bridge + PresageSdkAdapter; exits 1 until the SDK is wired
PRESAGE_BRIDGE_TOKEN=<same value as the app's .env> npm start
```

Both smoke modes bind `127.0.0.1` on an ephemeral port with a random token,
so they never collide with a bridge on 4311.

## App identity (Presage portal)

Bundle ID: `com.siteguard.adaptivebreak.presagebridge`

Register exactly this value when creating the Presage SDK key. Any native host app
built for the SDK (for example a macOS/iOS app in Xcode: Target → General →
Identity → Bundle Identifier) must use the identical string, or the key may be
rejected. It is also recorded in `package.json` under `presage.bundleId`.

## Environment

| Variable               | Required          | Meaning                                                                                                                       |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PRESAGE_BRIDGE_TOKEN` | yes               | Shared bearer token (at least 16 characters). Must match the app's root `.env`. The bridge exits with code 2 if it is missing |
| `SMARTSPECTRA_API_KEY` | yes (real camera) | Presage SmartSpectra API key from https://physiology.presagetech.com. Bridge process env only; never in the app or browser    |
| `PRESAGE_BRIDGE_PORT`  | no                | Defaults to `4311` (the contract port). If you change it, also change `PRESAGE_BRIDGE_URL` in the app                         |

The host is fixed to `127.0.0.1` and cannot be configured.

## Contract behavior implemented

- `GET /v1/health` returns `{protocolVersion:1, source:"presage", status, reason}`. It reports `ready` only when the adapter's probe says so.
- `POST /v1/sessions {appSessionId: UUID}`:
  - **201** `{bridgeSessionId}` when a new session starts.
  - **200** with the same `bridgeSessionId` when the same `appSessionId` is already active.
  - **409 `CAMERA_BUSY`** when a different session holds the camera.
  - **409 `SESSION_ALREADY_STOPPED`** when that `appSessionId` was already stopped.
  - **503 `SDK_UNAVAILABLE`** when the adapter is not ready.
  - **503 `START_FAILED`** when the adapter fails to open. No camera stays held.
  - **400** for a bad body.
- `GET /v1/sessions/:id/events?after=N` streams SSE:
  - Every event has a numeric, strictly increasing `id:`, starting at 0 per session.
  - Data is `reading`, `status`, or `error` exactly as in the contract.
  - A `: heartbeat` comment is sent every 5 s.
  - Events with `id > after` are replayed from the last 120 s. `after` defaults to `-1`.
  - **409 `REPLAY_EXPIRED`** if any requested event was already pruned.
  - **400** for a malformed cursor.
  - For a stopped session, the stream replays and then closes.
- `POST /v1/sessions/:id/stop` returns `{status:"stopped"}`:
  - It is idempotent.
  - It awaits `capture.close()` (camera release), then emits `status: stopped` and ends open streams.
  - If release fails it returns **500 `STOP_FAILED`** and keeps the camera locked so a retry calls `close()` again.
- Security:
  - Every request needs `Authorization: Bearer <token>`. The check is constant-time, and a failure returns 401.
  - Non-loopback peers get 403.
  - Any request carrying an `Origin` header (that is, a browser) gets 403.
- Shutdown: SIGINT/SIGTERM stop all sessions, releasing the camera, before the process exits.

### Validity mapping (the only place quality is decided)

`quality` comes **only** from the explicit per-metric SDK status that the
adapter reports in `MetricObservation.status`. An adapter must map that from
a documented vendor status/confidence field, or report `"unknown"` if there
is none. In `normalize.ts`:

- `valid`, `invalid`, and `unknown` pass through unchanged.
- Numbers never upgrade or downgrade a status. A plausible 72 bpm marked `invalid` stays `invalid`, and 250 bpm marked `valid` stays `valid`. This is tested.
- Only one adjustment happens: a status of `valid` with no usable rate (null, NaN, infinite, or ≤ 0) becomes `unknown`, because a missing number cannot be "valid".
- Non-positive or non-finite rates are emitted as `null`, so `Rates finite and positive when present` holds.
- If pulse and breathing qualities differ, the bridge emits two readings with the same timestamp, each with the other rate `null`. A sample with only one metric produces one reading. A sample with neither produces nothing.
- Rates on `invalid`/`unknown` readings are passed through as the SDK reported them. The app excludes them from analytics.

### Timing

When the camera capture opens, the bridge records one anchor:
`(performance.now(), Date.now())`. The adapter reports each sample's time on
the bridge's monotonic clock (`AdapterSample.monotonicMs`). The bridge then
computes `timestamp = anchorWall + (monotonicMs − anchorMono)`, written as an
ISO 8601 UTC string. This keeps readings monotonic even if the wall clock
jumps mid-session. Samples timed before the anchor are dropped and an
`error SAMPLE_TIME_INVALID` (retryable) is emitted. **The SDK's own timestamp
semantics and how to convert them to `monotonicMs` are UNVERIFIED** (TODO in
`presage-sdk.ts`).

## Fixtures

The files in `fixtures/*.json` (`fixtureFormat: 1`) were written by hand in
the bridge's normalized `AdapterSample` form. They are **synthetic**: they
were not recorded from the SDK or a camera and contain no vendor field names.

| Fixture          | Case                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `valid-steady`   | 20 one-second samples, both metrics valid                                                        |
| `low-quality`    | invalid/unknown statuses, plausible numbers marked invalid, valid-with-null, non-positive values |
| `mixed-validity` | per-metric validity differs (the split rule); single-metric and empty samples                    |
| `signal-gap`     | positioning status with a 9 s gap and no samples (none invented), then measuring resumes         |
| `sdk-error`      | retryable and non-retryable adapter errors forwarded                                             |

Reconnect and replay are covered in the tests:

- A dropped SSE connection is followed by the app's real `PresageSource` reconnecting with `?after=` and getting no duplicates.
- An expired cursor returns 409.

The fixture adapter's readings carry `source:"presage"` because the wire
contract has no other value. Never point the app at a fixture-backed bridge
for a real check-in. `npm start` cannot select it.

## Real SDK adapter (`src/adapters/presage-sdk.ts`)

- **SDK:** `@smartspectra/node-sdk` **3.4.0** (pinned). Native builds for macOS Apple Silicon, Linux x64/arm64 (glibc ≥ 2.35), Windows x64. Node ≥ 20 (24 recommended).
- **Requested metrics:** only `MetricType.PULSE_RATE` and `MetricType.BREATHING_RATE`.
- **Validity:** taken only from the vendor's `stable` flag on each `MeasurementWithConfidence` (vendor docs: `stable` means confidence ≥ 40 for pulse and ≥ 45 for breathing). `true` → `valid`, `false` → `invalid`, missing → `unknown`. Numbers never change the status.
- **Timing:** vendor `timestamp` is microseconds since the Unix epoch. It is converted to the bridge monotonic clock once per sample, then to UTC through the session anchor. Packets with no new timestamp are ignored.
- **Status:** `validationStatus` `kOk` → `measuring`; any other code → `positioning` with the vendor's hint text.
- **Errors:** vendor `error` events are forwarded as `SmartSpectraErrorCode` names (for example `kAuthenticationFailed`, `kInputUnavailable`) with the vendor's `retryable` flag. A start-time error rejects `open()` and releases the SDK.
- **Privacy:** per vendor docs, all metric computation runs on-device; the network is used only to validate the API key/subscription. The adapter sets `enableTelemetry: false` (the vendor default is on). No frames are stored by the bridge or SiteGuard.
- **Tests:** `test/presage-sdk-adapter.test.ts` exercises the adapter against a fake module with the same names and shapes as the 3.4.0 type declarations.

## What remains (needs the demo laptop, camera and API key)

1. **Observed camera session:** on the demo Mac, with `SMARTSPECTRA_API_KEY` and `PRESAGE_BRIDGE_TOKEN` set, run `npm run smoke:hardware`, then a check-in in the app with Presage selected. Record start/stop/reconnect results here.
2. **Camera permission:** the first run triggers the macOS camera prompt for the terminal app running the bridge.
3. **Vendor terms:** confirm subscription/credit limits for the hackathon key (`kCreditExhausted` is surfaced as an error).
