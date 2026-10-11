# SiteGuard on phones: recurring voluntary check-ins

Two phone paths:

- **A. Phone web layout** at `/mobile` in `apps/web`. Works in any phone browser. Implemented and tested here.
- **B. Native iOS app** in `apps/mobile-ios` (SwiftUI + SmartSpectra Swift SDK). Physical iPhone capture and pulse readings were observed. Local HTTPS-only device pairing and optional normalized-reading upload are implemented in code and API-tested, but not yet verified by a fresh phone-to-desktop run.

The canonical API contract now includes a separate local-demo native upload endpoint. The original bridge ingest and hosted-mode rejection remain unchanged.

## Status

| Item                                                                         | State                                                                                     | Evidence                                                                                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/mobile` phone layout, reminders, consent, synthetic check-in, insights     | Implemented                                                                               | `tests/integration/mobile-checkin.spec.ts` (390×844 phone viewport, touch)                                                               |
| Reminder interval logic (60 s demo default, pause, dismiss, bounds, storage) | Implemented                                                                               | `apps/web/src/lib/checkin-reminder.test.ts` (Vitest fake timers)                                                                         |
| iOS reading mapping matches the contract and the Presage bridge              | TypeScript half verified; Swift half written, not run                                     | `packages/contracts/src/mobile-ios-fixture.test.ts` checks the shared fixture; `ReadingMapperTests.swift` checks the same fixture on Mac |
| Browser camera → local Presage bridge                                        | Implemented; live iPhone pulse/breathing **not verified**                                 | Aspect-preserving JPEG frames are proxied and decoded transiently; bridge and API tests pass                                            |
| iOS app builds and measures on a device                                      | **Partially verified**                                                                     | User's iPhone screenshot: 51 s, 38 readings, 30 valid pulse, 1 valid breathing; new upload build installed, fresh measurement pending.    |
| Phone → SiteGuard upload                                                     | **Implemented in code; device E2E unverified**                                            | `SiteGuardUploader.swift`; unsigned iOS build passed. User must opt in per check-in.                                                       |
| Phone ingestion API (pairing tokens, TLS, consent)                           | **Implemented for local demo; fixture-tested**                                            | `apps/api/test/device-upload.test.ts`; in-memory credentials and no production identity verification.                                    |

## Browser camera relay

Presage has no browser SDK. After consent and camera permission, `/mobile` encodes phone-camera frames as JPEG over same-origin HTTPS to the local API; the API forwards them to the loopback-only Node bridge, where they are decoded in memory for `useCustomInput` / `sendFrame`. Frames are bounded, session-bound, processed transiently and not written to the database or filesystem. The SDK key and bridge token stay server-side. Synthetic mode is a separate, explicitly selected demo option and is never a fallback after a camera failure. This path is implemented but has not yet produced live iPhone pulse and breathing readings; do not mark it verified.

The phone must reach a trusted HTTPS origin. `SITEGUARD_WEB_HOST=0.0.0.0 SITEGUARD_HTTPS_KEY=/absolute/path/key.pem SITEGUARD_HTTPS_CERT=/absolute/path/cert.pem npm run dev:live` enables HTTPS on Vite port 5173 while the API and bridge remain loopback-only. Use a certificate trusted by the iPhone for the Mac's LAN hostname; never commit the private key. Plain `http://<mac-LAN-IP>:5173` cannot use the camera in Safari. Keep this demo service on a trusted local network only: demo role selection is not production authentication. Do not use `HOST=0.0.0.0` for this command: that also exposes the API listener on plain HTTP.

## A. Phone web layout (`/mobile`)

### Files

- `apps/web/src/pages/Mobile.tsx`: the phone experience, rendered without the desktop sidebar (`App.tsx` routes `/mobile` to it, reusing the same identity and APIs).
- `apps/web/src/lib/checkin-reminder.ts` + `.test.ts`: reminder state machine, interval parsing, storage, and the opt-in notification helper.
- `apps/web/src/styles.css`: the `.mobile-*` section (touch targets ≥ 48 px, 16 px inputs so iOS Safari does not zoom, safe-area padding).
- `apps/web/vite.config.ts`: dev server host comes from `SITEGUARD_WEB_HOST` (default `127.0.0.1`); the API host remains separate.
- `tests/integration/mobile-checkin.spec.ts`: Playwright at a phone viewport.

### Flow

1. **Worker choice**: large buttons for the fictional roster (demo login, not production authentication).
2. **Home**: break status, the reminder card, "Start check-in", and support actions (request rest, report a symptom, request assistance). Support needs no measurement and no consent.
3. **Reminder**: a countdown "Next optional reminder in mm:ss". The setting reads "Check-in reminder every N seconds" and shows a **Demo interval** badge in `DEMO_MODE`. The default is **60 s in `DEMO_MODE`** (`/api/health` → `measurementSources.mock`) and 30 min otherwise, bounded 30 s–4 h. Settings are stored per device in `localStorage`, guarded with try/catch.
4. **When due**: a calm in-app card (`role="status"`, not an alert): "Check-in available · optional … Skipping has no effect on your breaks or requests", with "Review consent and check in" and "Not now". "Not now" restarts a full interval. The card stays until the worker answers; it never repeats or escalates.
5. **Consent, every time**: the form state is new on each visit, so consent is never remembered. On secure browsers with a configured bridge, Presage camera is the default; synthetic demo mode can be explicitly selected when enabled. Workload and temperature are optional. Sharing with safety operations is off by default.
6. **Measuring**: the front-camera preview, elapsed time, suggested length, latest valid pulse and breathing (or blanks), and "Finish check-in" at any time. Any camera or relay failure is shown explicitly. Reminders are paused from consent until the check-in ends.
7. **Done**: observed pulse and breathing changes (or "Insufficient data"), then the worker-only **personal-insights panel** (`PersonalInsightsPanel`, `docs/RECOVERY_MODEL.md`), a link to the full summary, and the next reminder countdown, which restarts at completion.

An active session found on load (after a reload, for example) is resumed instead of starting a second one.

### Reminder rules (`CheckInReminder`)

`off → waiting → due`; `due --Not now--> waiting` (from now); `waiting|due --consent opened--> checking_in` (paused); `checking_in --finished or cancelled--> waiting` (from now). Changing the interval restarts the countdown. `onDue` fires exactly once per cycle. The class has no access to the session API, so it **cannot start a measurement**; a unit test asserts its API has no measurement, session or consent methods.

### Notifications (optional)

The browser Notification API is used only after the worker taps "Also notify me when SiteGuard is in the background", and only while the page is hidden. The text says only that an optional check-in is available. The button is not shown without a secure context (HTTPS or `localhost`), so on a LAN `http://` address reminders stay in the app. On iPhone, a normal Safari tab cannot deliver reliable timed background alerts; the UI now directs workers to the native SiteGuard app for local notifications instead of offering a misleading browser opt-in. iOS Web Push would require an installed Home Screen web app, a service worker, a push subscription and server-side push delivery. On Android Chrome, `new Notification()` throws without a service worker; the helper catches that and keeps the in-app prompt. Phones also throttle or suspend timers in background tabs, so a reminder may appear late or only when the page is reopened.

### Invariants kept

- **Voluntary**: nothing starts a measurement except the worker's Begin tap after consent on that check-in.
- **Synthetic is labeled** on every screen. The source is fixed per session by the existing API.
- **Worker-only physiology**: personal insights render only for the session owner, and the endpoint already returns 403 to supervisors. The supervisor overview is unchanged.
- **Protected breaks**: the existing rule stands. A check-in can start only during the worker's current break (the API returns `409 BREAK_INACTIVE` otherwise). Outside a break, the phone shows "Check-ins open during your scheduled break (next: hh:mm)". Reminders never move or shorten breaks.
- **Assistance always available** without measurement: on home, consent, measuring and done screens, and outside breaks (tested).
- No diagnosis, clearance, score or "optimal rest" wording. A test asserts the page contains none of `risk|diagnos|safe to work|fit for work|fatigue score`.

### Run on a phone on the same Wi-Fi (trusted network only)

The browser camera requires HTTPS. Use a locally trusted certificate whose subject alternative name includes the Mac's current LAN IP or `.local` hostname. Keep its private key outside Git (this Mac's temporary files are under ignored `.local-tls/`); install **only the public CA certificate** on the iPhone and manually enable full trust under Settings → General → About → Certificate Trust Settings. Remove that local CA from the iPhone after the demo. [Apple's trust instructions](https://support.apple.com/en-us/102390).

Run the bridge, API and frontend with a configured local `.env`, then open `https://<laptop-ip>:5173/mobile` on the same private Wi-Fi. Set `SITEGUARD_WEB_HOST=0.0.0.0` and `SITEGUARD_HTTPS_KEY` / `SITEGUARD_HTTPS_CERT` to absolute local files; leave `HOST=127.0.0.1` so the API is not exposed over plain HTTP. `npm run dev:live` starts all three services. Vite proxies `/api` to the loopback API. Demo role selection is not production authentication; do not use venue or public Wi-Fi.

Choose **Worker W-01** during an active protected break. Stop the services with Ctrl+C when done. If the Mac changes IP or the certificate expires, generate a new leaf certificate and retrust only if the CA itself changes.

## B. Native iOS app (`apps/mobile-ios`)

Setup steps are in `apps/mobile-ios/README.md`. Summary:

- **SwiftUI, iOS 17+.** The Swift quick start says SmartSpectra "Requires iOS 17 or later" (llms.txt). Bundle ID `com.siteguard.adaptivebreak.presagebridge`, already registered by the team.
- **Package**: `https://github.com/Presage-Security/SmartSpectra-Swift/`, product `SmartSpectra`, pinned with "Exact Version" (`docs/swift/option-1-api-key.md`). `project.yml` (XcodeGen) pins `3.4.0`, the example tag in the docs; confirm the newest release before building.
- **Credentials, never in source**:
  - Development: `SMARTSPECTRA_API_KEY` in the untracked `Config/Secrets.xcconfig` → `Info.plist` → `sdk.config.apiKey` (the documented property, `docs/swift/api-reference.md`). A key in Info.plist is still inside the built app, so such builds stay on Mohit's own device.
  - Anything distributed: OAuth (`docs/swift/option-2-oauth.md`). Register the bundle ID and Team ID, download `PresageService-Info.plist` (gitignored here), add the **App Attest** capability, and test on a physical device. When OAuth is enabled, it takes precedence and any API key is ignored.
- **SDK use**, all documented: `SmartSpectraSDK.shared`; `config.requestedMetrics = SmartSpectraConfig.breathingMetrics + [.pulseRate]` (`metrics.md`); `config.enableTelemetry = false`; `start()` / `stop()` (`async throws`); `metrics.cardio.pulseRate.last` and `metrics.breathing.rate.last`; `validationStatus.code`; `error.code` / `.message` / `.retryable` (`api-reference.md`). Samples carry `value` (Float) and `timestamp` (Int64 µs since epoch) (`use-case-examples.md`, `data-types.md`). The app polls the latest samples once per second.
- **Validity**: taken only from the sample's explicit `stable` flag (`data-types.md`: "Whether the measurement is considered stable/reliable"; pulse corresponds to confidence ≥ 40, breathing to ≥ 45). The mapping is the same as the bridge's `statusFromStable` and `normalizeSample`. The Swift docs show `.confidence` on pulse samples in the official sample but do not spell out `.stable` for Swift. It is a field of the language-agnostic payload, so the first Mac build must confirm the accessor name.
- **Check-in cycle**: the reminder defaults to 60 s (`SITEGUARD_CHECKIN_INTERVAL_SECONDS`, changeable in the app). Each check-in suggests 90 s, because real Presage needs about 30–45 s of warm-up (`docs/PRESAGE_OPPORTUNITIES.md` R1). Reminders pause during a check-in. Local notifications are scheduled only after the worker opts in.
- **Consent**: the consent screen appears before every check-in, with fresh state. The camera starts only after consent and Begin. iOS also shows its own camera prompt (`NSCameraUsageDescription`) on first use.
- **Network layer**: `LocalHTTPSUploader` uses normal iOS certificate validation and stores a scoped token in the device-only Keychain. Pair via a one-time code displayed to the signed-in worker on `/mobile`. Upload and supervisor sharing are separate, default-off per-check-in choices. A failed upload retains readings on the result screen for one retry; leaving discards them. The desktop worker summary and consented supervisor detail are available only after successful upload.
- **Expired demo break**: the phone upload must fit entirely inside that worker's protected break. If the fictional schedule has expired, a supervisor can use **Local demo controls → Open fresh protected demo break** for the paired worker. This adds a 15-minute protected break without deleting earlier sessions or measurements. Do not use the destructive demo reset when real Presage sessions exist. The phone now displays the API's public rejection code and reason alongside the HTTP status.
- **Support**: always visible. Because the native app cannot send requests yet, it says so and offers a link to the web `/mobile` page (if `SITEGUARD_WEB_URL` is set) or "tell your supervisor directly". It never implies that a request was sent.

## Longer-term phone ingestion contract (design only)

Status: **proposal for production-style deployment, not implemented**. The current path is local-demo-only and intentionally simpler: short-lived pairing and device tokens live in server memory, upload occurs once at check-in completion, and real phone data never reaches hosted demo mode. The following is a future design, not a claim that these endpoints exist.

### Goals and non-goals

- Let a paired phone running the native SDK upload `source=presage` readings for **its own worker only**, over TLS, with per-session consent, without weakening the bridge path or the hosted-demo rule.
- Not a general device-management system and not production SSO. The hosted fictional demo stays fictional: device ingestion is **off unless explicitly enabled** and refused when `HOSTED=true && DEMO_MODE=true`.

### Configuration

`DEVICE_INGEST=enabled|disabled` (default `disabled`). When enabled, the server requires `HOSTED=true` with HTTPS (HSTS already set in hosted mode), or a loopback-only development listener. Plain HTTP on a LAN is rejected for device routes.

### Pairing (per-device token)

1. `POST /api/devices/pairings` (worker cookie) → `201 {pairingId, code, expiresAt}`. An 8-character code from a CSPRNG, valid 5 minutes, single use, at most 3 open codes per worker. Shown on the worker's own web screen (`/mobile`), never sent anywhere else.
2. `POST /api/devices/pair {code, deviceName, platform:"ios"|"android", appVersion, sdkVersion}` (no cookie) → `201 {deviceId, deviceToken, workerId, expiresAt}`. `deviceToken` is 32 random bytes (base64url), returned **once**. The server stores only `SHA-256(deviceToken)`. Tokens expire after 30 days. Failed codes count toward a lockout of 10 attempts per IP per 10 minutes.
3. The app keeps `deviceToken` in the iOS Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), never in `UserDefaults` or files.
4. `GET /api/devices` (worker: own devices; supervisor: device list without physiology) and `DELETE /api/devices/:id` (the owning worker or a supervisor) revoke immediately. Every pairing and revocation is audited.
5. Optional hardening: bind the token to an App Attest key. The SDK's OAuth path already requires App Attest, so the capability will exist.

### Device endpoints (`Authorization: Bearer <deviceToken>`)

The token resolves to `{deviceId, workerId}`. It can never act for another worker, read history, or use supervisor routes.

- `GET /api/device/breaks/current` → `{break|null}` for that worker, so the phone knows whether a check-in is allowed.
- `POST /api/device/sessions {breakId, consentVersion:"v1", consentedAt, shareWithSupervisor, context}` → `201 {session}`. The server sets `source:"presage"` itself; the device cannot choose it. Existing rules apply unchanged: worker owns the break, the break is current, one active session. The session records `captureDevice:{kind:"ios-sdk", deviceId, sdkVersion}`, so phone and bridge measurements remain distinguishable. Source never changes for the session.
- `POST /api/device/sessions/:id/readings {readings:ReadingEnvelope[]}`: the same strict Zod schema, max 100 per batch, whole-batch validation, `reading.source` must be `"presage"`, timestamps within session start and receipt (+ small skew allowance), identical replay deduplicated and a changed payload → 409. The same parameterized repository code as the bridge path.
- `POST /api/device/sessions/:id/complete {}` → `{session, summary}`. Personal insights stay on the worker-cookie endpoint (worker-only).
- `POST /api/device/rest-requests` and `POST /api/device/symptom-reports`: same bodies and atomic assistance linkage as the cookie routes, so support works from the native app with or without a measurement.

### Privacy and safety

- Frames never leave the phone. The SDK computes on device and calls Presage only to validate the key or subscription (SmartSpectra skill: "never to compute or score metrics remotely"). Telemetry is set off (`enableTelemetry = false`). The bridge research also observed a device-pairing call (`docs/PRESAGE_OPPORTUNITIES.md` §4); ask Presage what it sends before claiming no device identifiers leave the phone.
- Consent: the session stores `consentVersion` and `consentedAt`. No session starts without both, and the app asks every time.
- Supervisor views remain physiology-free unless the worker shares a summary. Personal insights remain worker-only.
- Real phone data and synthetic data never mix: comparisons are per source, and `demo:reset` already refuses to delete presage sessions.

### Tests required before enabling

Pairing expiry, single use and lockout; hashed token storage; revocation takes effect immediately; a token for worker A cannot touch worker B's sessions, breaks or requests; the device cannot set `source` or ingest `mock`; break, active-session and timestamp rules; replay and 409 behavior; HTTPS-only enforcement; hosted fictional demo refuses device routes; supervisor endpoints unchanged; plus an on-device end-to-end run with a real key.

## Limitations

- The browser relay is not yet verified with live iPhone pulse and breathing data. It requires HTTPS trusted by the phone, a running local Presage bridge and a valid key.
- Timers in background tabs are throttled on phones. Browser notifications need HTTPS and are unreliable on Android without a service worker. Neither is required for the in-app flow.
- `SITEGUARD_WEB_HOST=0.0.0.0` exposes the HTTPS demo frontend to the local network. Use a trusted network and stop the servers afterwards; leave the API listener on loopback.
- The prior iOS build measured on a physical device; the new upload build still needs signing, installation and a fresh phone-to-desktop check. The Simulator has no camera (`docs/swift/troubleshooting.md`).
- The updated iOS app can upload normalized readings after trusted-HTTPS pairing and fresh per-check-in consent; a physical-device upload is still unverified. Its support section still points to other channels because native support requests are not implemented.
- The demo protected break for W-01 lasts 15 minutes from server start. Reset the demo to reopen it.

## Verification record

Run on 2026-10-10 in this worktree (Linux, Node 24.21.0):

| Command                                           | Result                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run typecheck`                               | passed                                                                                  |
| `npm run test`                                    | 19 files passed, 1 skipped; 147 tests passed, 5 skipped (pre-existing PostgreSQL skips) |
| `npm run build`                                   | passed                                                                                  |
| `npx prettier --check .`                          | passed                                                                                  |
| `npx playwright test -c .data/pw.local.config.ts` | 55 passed, including the 4 phone tests in `mobile-checkin.spec.ts`                      |

Not run: any Swift build or test (no toolchain here), any real Presage measurement, any phone hardware. The phone layout was exercised only in desktop Chromium emulating a 390×844 touch viewport.
