# SiteGuard Check-in (iOS, SwiftUI)

A native scaffold for voluntary recurring check-ins measured on the iPhone with the Presage SmartSpectra Swift SDK. Architecture, privacy and the proposed upload contract: [`docs/MOBILE_APP.md`](../../docs/MOBILE_APP.md).

> **Status: not built or tested yet.** The code was written against the official SmartSpectra docs in a Linux environment with no Swift toolchain. Expect small fixes on the first Xcode build. **It uploads nothing to SiteGuard**: the network layer is a fail-closed TODO (`Sources/SiteGuardUploader.swift`).

## What it does

- A reminder countdown every **60 s** by default (demo interval, configurable). The reminder only prompts and never starts the camera.
- A consent screen before **every** check-in. Then a Presage measurement of pulse and breathing on the front camera, with positioning guidance and a 90 s suggested length (real-Presage warm-up).
- Readings mapped to the SiteGuard `VitalReading` contract (`Sources/ReadingMapper.swift`). Validity comes only from the SDK's `stable` flag, as in the Presage bridge.
- A result screen that states plainly that nothing was uploaded. Readings are discarded when you leave it.
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
    Sources/SiteGuardUploader.swift    TODO network layer (fails closed)
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
5. **Run tests** (Product → Test, or `xcodebuild test -scheme SiteGuardCheckIn -destination 'platform=iOS Simulator,name=iPhone 16'`). The unit tests need no camera. `ReadingMapperTests` reads `Fixtures/mapped-readings.json` through `#filePath`, so run them from this checkout.
6. **Run on the iPhone.** Connect it, select it as the destination, and press Run. Trust the developer certificate on the phone if asked (Settings → General → VPN & Device Management). Allow camera access at the first check-in.
7. **Demo.** Wait for the 60 s reminder (or tap Start check-in), read and accept consent, then sit still facing the front camera, upper chest visible and even light. Finish after about 90 s. The result screen shows reading counts and says nothing was uploaded.

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

Frames stay on the phone. The preview is shown only for positioning and is never saved. SiteGuard requests only pulse and breathing (no face, expression, EDA or HRV metrics) and sets `enableTelemetry = false`. The SDK still contacts Presage to validate the key or subscription. No readings leave the app in this version.
