# SiteGuard Check-in (iOS, SwiftUI)

A native scaffold for voluntary recurring check-ins measured on the iPhone with the Presage SmartSpectra Swift SDK. Architecture, privacy and the proposed upload contract: [`docs/MOBILE_APP.md`](../../docs/MOBILE_APP.md).

> **Status:** A prior build ran live on Hitayu's iPhone and showed 38 readings in 51 seconds (30 valid pulse, 1 valid breathing); it uploaded nothing. A newer build with optional local HTTPS upload and worker-name selection was signed, installed and launched. Pairing and a real phone-to-desktop upload have not yet been verified. No Presage key is embedded in the installed build.

## What it does

- A reminder countdown every **60 s** by default (demo interval, configurable). The reminder only prompts and never starts the camera. After the worker opts in, a local alert is scheduled for the next due time; permission is restored on relaunch and a banner can appear while the app is foregrounded.
- A consent screen before **every** check-in. Then a Presage measurement of pulse and breathing on the front camera, with a live in-memory preview, stable-reading cards, positioning guidance, and a 90 s suggested length (real-Presage warm-up). Camera use stops when the app goes into the background.
- Every sample in each SDK metrics update is mapped to the SiteGuard `VitalReading` contract (`Sources/ReadingMapper.swift`); the app no longer polls only the last sample once per second. Validity comes only from the SDK's `stable` flag, as in the Presage bridge. Rate output remains event-driven, not one reading per camera frame.
- Optional local HTTPS pairing and per-check-in upload of normalized readings, with a second default-off switch for manager access. If upload is unselected or fails, readings stay on the result screen for retry and are discarded when you leave.
- A support section that is always visible and directs to the web `/mobile` page or a supervisor in person (it cannot send requests yet).

## Layout

```
apps/mobile-ios/
  project.yml                     XcodeGen spec (generates the gitignored .xcodeproj)
  Config/Base.xcconfig            non-secret settings (interval, demo mode)
  Config/Secrets.example.xcconfig template for the untracked Config/Secrets.xcconfig
  SiteGuardCheckIn/
    Info.plist                    camera usage text; $(…) placeholders filled from xcconfig
    SiteGuardCheckInApp.swift
    Sources/PresageMeasurement.swift   the only file importing SmartSpectra (doc citations inside)
    Sources/ReadingMapper.swift        SDK sample -> VitalReading (pure Swift)
    Sources/ReminderSchedule.swift     reminder state machine (pure Swift)
    Sources/PositioningGuidance.swift  ValidationCode -> SiteGuard guidance
    Sources/CheckInModel.swift         flow: reminder -> consent -> measuring -> result
    Sources/SiteGuardUploader.swift    local HTTPS upload; token in device-only Keychain
    Sources/AppConfiguration.swift     reads Info.plist values
    Views/                             SwiftUI screens
  SiteGuardCheckInTests/          XCTest; Fixtures/mapped-readings.json is shared with TypeScript tests
```

## Run on Mohit's Mac (Apple Silicon) and iPhone

Requirements: a recent Xcode with the iOS 17+ SDK (SmartSpectra "Requires iOS 17 or later"), a **physical iPhone** (the Simulator has no camera, per `docs/swift/troubleshooting.md`), an internet connection on the phone (the SDK validates the key or subscription online), and an Apple Developer team that holds the registered bundle ID `com.siteguard.adaptivebreak.presagebridge`.

1. **Get the code.**
   ```sh
   git fetch && git checkout feature/mobile-app
   cd apps/mobile-ios
   ```
2. **Choose credentials. Never put a key in source.**
- _Personal check-ins without embedding the key:_ leave `Config/Secrets.xcconfig` absent. The consent screen offers a secure Presage API key field. Choose **Remember securely on this iPhone** to save it in the device-only Keychain for later check-ins, or switch that off to use it for this check-in only. You can change or forget the saved key from the consent screen. The key is never stored in the project, app bundle, or SiteGuard API.
   - _Development on your own phone (fastest):_
     ```sh
     cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig   # gitignored
     ```
     Set `SMARTSPECTRA_API_KEY` in it to your key from the Presage developer portal (<https://physiology.presagetech.com>). The app reads it from Info.plist and sets `sdk.config.apiKey`, the documented property (`docs/swift/option-1-api-key.md`). The key ends up inside the built app, so do not hand that build to anyone.
   - _Anything you share (TestFlight, teammates):_ use OAuth per `docs/swift/option-2-oauth.md`. In the Presage portal, register the bundle ID (exact, case-sensitive) and your 10-character Team ID. Download **`PresageService-Info.plist`** and put it in `SiteGuardCheckIn/` (it is gitignored). Leave `SMARTSPECTRA_API_KEY` empty; when OAuth is enabled it takes precedence. You add the App Attest capability in step 4.
3. **Create the Xcode project.** Option A, XcodeGen (recommended):

   ```sh
   brew install xcodegen
   xcodegen generate          # writes SiteGuardCheckIn.xcodeproj from project.yml
   open SiteGuardCheckIn.xcodeproj
   ```

   `project.yml` adds the SmartSpectra package as documented. Package URL: `https://github.com/Presage-Security/SmartSpectra-Swift/`. Product: `SmartSpectra`. Pinned to Exact Version `3.4.0`, the example tag on the docs page; check the repo's releases and update `exactVersion` if there is a newer one.

   Option B, by hand: Xcode → New Project → iOS App (SwiftUI) named `SiteGuardCheckIn`. Delete the generated `ContentView.swift` and app file, then drag in `SiteGuardCheckIn/` (Sources, Views, app file and Info.plist) and `SiteGuardCheckInTests/` as a unit-test target. Untick target membership for `Info.plist` and `Fixtures/` (they must not be copied as resources). Under Build Settings, set _Info.plist File_ to `SiteGuardCheckIn/Info.plist`, turn _Generate Info.plist File_ off, and use `Config/Base.xcconfig` as the project configuration file for Debug and Release. Then **File → Add Package Dependencies…**, paste the package URL above, choose **Exact Version**, and attach the **SmartSpectra** product to the app target.

4. **Signing.** Target → Signing & Capabilities: choose your team and keep the bundle ID `com.siteguard.adaptivebreak.presagebridge`. For OAuth, add **App Attest** here.
   A local command-line build can also use Xcode automatic provisioning without saving a personal team ID in the project: `xcodebuild -project SiteGuardCheckIn.xcodeproj -scheme SiteGuardCheckIn -destination 'platform=iOS,id=YOUR_DEVICE_ID' -allowProvisioningUpdates DEVELOPMENT_TEAM=YOUR_TEAM_ID CODE_SIGN_STYLE=Automatic build`. On first install, the phone may require you to trust that developer in Settings → General → VPN & Device Management.
5. **Run tests** (Product → Test, or `xcodebuild test -scheme SiteGuardCheckIn -destination 'platform=iOS Simulator,name=iPhone 16'`). The unit tests need no camera. `ReadingMapperTests` reads `Fixtures/mapped-readings.json` through `#filePath`, so run them from this checkout.
6. **Run on the iPhone.** Connect it, select it as the destination, and press Run. Trust the developer certificate on the phone if asked (Settings → General → VPN & Device Management). Allow camera access at the first check-in.
7. **Demo.** On the Mac, open `http://127.0.0.1:3001/mobile`, choose a worker and tap **Get one-time pairing code** at the top of the worker page. Code issuance is loopback-only; the phone exchange and uploads still require HTTPS. In the native app enter the Mac's trusted HTTPS origin (currently `https://10.0.0.35:5173`), tap **Load worker names**, pick the **same worker name**, and enter the code under **Desktop connection**. Pairing refuses a code for a different worker. The iPhone must fully trust the local CA; bypassing a Safari warning is not enough for URLSession. The phone remembers the HTTPS origin and pairing in its device-only Keychain. The server keeps only a token hash for 30 days, surviving restarts; a demo reset or expiration requires a new code. Start a new check-in during that worker's protected break, accept consent, and separately enable **Upload** and (only if desired) **Allow my manager**. Finish after about 90 s. The result screen reports upload success or a retryable error. On the Mac, enter the supervisor demo and open **Consented check-ins → View detailed readings**. The previous 38-reading check-in cannot be uploaded retroactively.

### Settings

| Build setting (xcconfig)             | Default | Purpose                                                                                                   |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| `SMARTSPECTRA_API_KEY`               | empty   | Development key (in `Secrets.xcconfig` only)                                                              |
| `SITEGUARD_CHECKIN_INTERVAL_SECONDS` | `60`    | Demo reminder interval (30–14400); also changeable in the app                                             |
| `SITEGUARD_DEMO_MODE`                | `true`  | Shows the "Demo interval" label                                                                           |
| `SITEGUARD_WEB_URL`                  | empty   | Web origin for the support link, e.g. `http:/$()/192.168.1.20:5173` (xcconfig needs `/$()/` to keep `//`) |

### First-build checklist (unverified SDK details)

- `sample.stable`: documented in the language-agnostic payload (`docs/data-types.md`, `MeasurementWithConfidence.stable`). The Swift pages show `.confidence` and `.value` but not `.stable`. If the accessor differs, keep validity tied to the SDK's explicit stability field only. **Never** derive it from the number or by applying a confidence threshold of your own without updating `docs/PRESAGE_CONTRACT.md`.
- `ValidationStatus.code.rawValue`: the docs list `case ok = 0 … faceNotForward = 17`; adjust the `Int(...)` conversion if the raw type differs.
- `SmartSpectraError.Code` cases used: `authenticationFailed`, `creditExhausted`, `networkError`, `inputUnavailable` (`docs/swift/api-reference.md`).

## Privacy

Frames stay on the phone. The preview is shown only for positioning and is never saved. SiteGuard requests only pulse and breathing (no face, expression, EDA or HRV metrics) and sets `enableTelemetry = false`. The SDK still contacts Presage to validate the key or subscription. Normalized readings leave the app only when the worker enables upload for that check-in; manager access requires its own consent switch. This local demo uses fictional role selection, not production authentication.
