# Presage bridge (Developer 2)

Loopback-only HTTP/SSE bridge implementing `docs/PRESAGE_CONTRACT.md` v1. The
application consumer is `apps/api/src/measurement/presage.ts`.

**Status: the real Presage SmartSpectra adapter is implemented (SDK 3.4.0) and
partially verified on hardware.** `npm start` uses `PresageSdkAdapter`, built
on `@smartspectra/node-sdk` 3.4.0 (see "Real SDK adapter"). It is unit-tested
against a fake module with the vendor's shapes. Hardware smoke runs on the demo
Mac have confirmed that the camera and pipeline start, that validation-status
events arrive, and that readings reach the bridge (these runs drove the start
and status-flood fixes). Not yet observed end to end: a full app check-in with
real readings producing an `available` summary, and the vendor warm-up timing
(see "What remains"). Without `SMARTSPECTRA_API_KEY`, a loadable SDK and a
camera, the bridge reports `status: "unavailable"` and refuses sessions. No SDK
success is claimed or simulated outside the explicitly labelled fixture adapter.

## Layout

| Path                          | Purpose                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/server.ts`               | `PresageBridge`: routes, auth, session lifecycle, SSE, heartbeat, replay                             |
| `src/adapter.ts`              | **Vendor boundary**: `SdkAdapter`, `AdapterSample`, `Clock`. SiteGuard-owned types, not Presage APIs |
| `src/adapters/presage-sdk.ts` | `PresageSdkAdapter`: real SmartSpectra 3.4.0 adapter (metrics, validity, status guidance, errors)    |
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
need to install the repository root dependencies too.

## Run

```sh
# from the repo root (needed for packages/contracts' zod)
npm ci
cd integrations/presage-bridge
npm ci
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
`error SAMPLE_TIME_INVALID` (retryable) is emitted. The real adapter converts
the vendor's epoch-microsecond sample timestamps to `monotonicMs` (see "Real
SDK adapter"); this conversion follows the vendor docs and has not yet been
checked against a full hardware session.

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
- **Status:** `validationStatus` `kOk` → `measuring`; any other code → `positioning` with a fixed SiteGuard guidance message per `ValidationCode` (`VALIDATION_GUIDANCE` in `src/adapters/presage-sdk.ts`; unknown codes → "Adjust position so your face is centered"). The vendor hint text is not forwarded (it is logged only with `PRESAGE_DEBUG=1`). The first `measuring` status of a capture carries the one-time message "Measuring — readings become reliable after about 30–45 seconds".
- **Errors:** vendor `error` events are forwarded as `SmartSpectraErrorCode` names (for example `kAuthenticationFailed`, `kInputUnavailable`) with the vendor's `retryable` flag. A start-time error rejects `open()` and releases the SDK.
- **Privacy and network use** (vendor docs, [SDK Telemetry & Privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy)):
  - All metric computation runs on-device. The SDK contacts Presage to validate the API key/subscription.
  - The SDK's optional telemetry is one aggregate summary per session (SDK build, runtime/device model, session outcome, performance and validation counts, timestamp). It never includes frames, metric values, file paths, free text, or user/device identifiers.
  - Telemetry defaults **on**; this adapter sets `enableTelemetry: false`, so no telemetry session is started and nothing is transmitted for it.
  - Neither the bridge nor SiteGuard stores frames or footage. If SiteGuard were distributed with telemetry enabled, that collection would need to be disclosed to users per Presage's privacy policy.
- **Tests:** `test/presage-sdk-adapter.test.ts` exercises the adapter against a fake module with the same names and shapes as the 3.4.0 type declarations.

## Debug: `npm run inspect:metrics` (opt-in, needs the real SDK)

Runs the real SDK on a video file (`--file clip.mp4`, via `useFile`) or the
default camera (`--camera`) and prints **which** metric fields each packet
populates, with sample counts, `stable` counts and the latest `confidence`,
plus a summary of when each field first appeared and first became stable. It
never prints or writes metric values, frames or footage, and it runs with
telemetry off. It needs `SMARTSPECTRA_API_KEY` and network access, and every
run uses subscription quota. `--strict` requests only the Strict codes,
because SDK 3.4.0 rejects sessions that mix strict and standard metrics. Other
flags: `--all`, `--max-seconds N`, `--interframe-ms N`, `--verbose`. The
bridge server never uses it. See `docs/PRESAGE_OPPORTUNITIES.md` §6. It has
not been run against a real session (no key in CI or dev sandboxes).

## What remains (needs the demo laptop, camera and API key)

1. **Full observed check-in:** start-up, status events and readings have been seen in hardware smoke runs. Still to record: on the demo Mac, with `SMARTSPECTRA_API_KEY` and `PRESAGE_BRIDGE_TOKEN` set, run `npm run smoke:hardware`, then a 90 s check-in in the app with Presage selected; confirm the summary is `available` and record start/stop/reconnect results and first-valid times (`npm run inspect:metrics`) here.
2. **Camera permission:** the first run triggers the macOS camera prompt for the terminal app running the bridge.
3. **Vendor terms:** confirm subscription/credit limits for the hackathon key (`kCreditExhausted` is surfaced as an error).
