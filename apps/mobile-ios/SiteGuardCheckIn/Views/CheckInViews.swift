import SwiftUI

/// Shown before every check-in. State is fresh each time: consent is never
/// remembered between check-ins.
struct ConsentView: View {
    @Bindable var model: CheckInModel
    @State private var consented = false
    @State private var choices = ConsentChoices()
    @State private var starting = false
    @State private var enteredPresageKey = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Before you begin").font(.title2.bold())
            VStack(alignment: .leading, spacing: 10) {
                Text("**Camera, on this phone only.** Presage measures pulse and breathing from the front camera on the device. Frames are not stored or sent by SiteGuard.")
                Text("**Only normalized observations.** Timestamped pulse, breathing rate, source and quality.")
                Text("**No identification, no clearance.** Readings cannot show that you have recovered or are fit to return to work.")
                Text(model.isPaired
                     ? "**Upload is optional.** Without the upload switch below, readings stay on this phone and are discarded after this screen."
                     : "**Not uploaded.** This phone is not paired with SiteGuard, so readings stay on this screen and are discarded afterwards.")
                Text("**Presage needs the internet** to verify the app; telemetry is turned off.")
            }
            .font(.callout)
            Toggle("I understand the limitations and voluntarily agree to record this check-in.", isOn: $consented)
            if model.isPaired {
                Toggle("Upload this check-in's pulse and breathing readings to SiteGuard", isOn: $choices.uploadToSiteGuard)
                if choices.uploadToSiteGuard {
                    Toggle("Allow my manager to view the detailed readings for this check-in", isOn: $choices.shareWithSupervisor)
                }
            }
            if !model.configuration.hasPresageCredentials {
                SecureField("Presage API key", text: $enteredPresageKey)
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Text("Personal test only. The key stays in memory for this check-in and is not saved in the app or uploaded to SiteGuard.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red).font(.callout)
            }
            Button {
                starting = true
                let key = enteredPresageKey
                enteredPresageKey = ""
                Task {
                    await model.begin(consented: consented, choices: choices, enteredPresageKey: key)
                    starting = false
                }
            } label: {
                Text(starting ? "Starting…" : "Begin check-in").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .disabled(!consented || starting ||
                (!model.configuration.hasPresageCredentials &&
                 enteredPresageKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            Button {
                model.cancelConsent()
            } label: {
                Text("Not now").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered).controlSize(.large)
            Text("Consent version v1 · asked every check-in · you can stop at any time.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}

struct MeasuringView: View {
    @Bindable var model: CheckInModel
    let startedAt: Date

    var body: some View {
        let elapsed = max(0, Int(model.now.timeIntervalSince(startedAt)))
        let target = model.configuration.recommendedCheckInSeconds
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Checking in").font(.title2.bold())
                Spacer()
                Text("Presage measurement").font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(.teal.opacity(0.15), in: Capsule())
            }
            if let image = model.preview {
                // Live positioning preview only; never saved.
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(maxWidth: .infinity)
                    .frame(height: 260)
                    .background(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("Camera preview for positioning")
            } else {
                ContentUnavailableView("Starting front camera", systemImage: "camera")
                    .frame(maxWidth: .infinity, minHeight: 180)
            }
            Text(model.guidance ?? "Sit still, face the camera and stay quiet.")
                .font(.callout)
            Text(formatCountdown(elapsed))
                .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
            ProgressView(value: Double(min(elapsed, target)), total: Double(target))
            Text(
                elapsed >= target
                    ? "\(target) seconds reached. Finish when you are ready."
                    : "Suggested length: \(target) seconds (a data-sufficiency guide, not a medical threshold)."
            )
            .font(.footnote).foregroundStyle(.secondary)
            HStack(spacing: 12) {
                measurementCard("Pulse", value: model.pulseRateBpm, unit: "bpm")
                measurementCard("Breathing", value: model.breathingRateBrpm, unit: "brpm")
            }
            Text("Only stable Presage readings are shown. A dash means no valid reading yet.")
                .font(.footnote).foregroundStyle(.secondary)
            Text(
                "\(model.collector.envelopes.count) Presage observations captured · "
                    + "\(model.collector.validPulseCount) valid pulse · "
                    + "\(model.collector.validBreathingCount) valid breathing."
            )
            .font(.footnote)
            Text("Rate readings arrive when Presage detects a new event, not for every camera frame. Unstable observations are captured but not called valid.")
                .font(.footnote).foregroundStyle(.secondary)
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red).font(.callout)
            }
            Button {
                Task { await model.finish() }
            } label: {
                Text("Finish check-in").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
        }
    }

    private func measurementCard(_ title: String, value: Double?, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            Text(value.map { "\(Int($0.rounded())) \(unit)" } ?? "— \(unit)")
                .font(.title2.bold()).monospacedDigit()
                .accessibilityLabel("\(title): \(value.map { "\(Int($0.rounded())) \(unit)" } ?? "no valid reading yet")")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.teal.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct CompletedView: View {
    @Bindable var model: CheckInModel
    let result: CheckInResult

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Thanks for checking in.").font(.title2.bold())
            Text(
                "\(Int(result.endedAt.timeIntervalSince(result.startedAt))) seconds · \(result.readingCount) readings (\(result.validPulseCount) valid pulse, \(result.validBreathingCount) valid breathing)."
            )
            Text(result.uploadMessage).font(.callout)
            if model.canRetryUpload {
                Button("Retry upload") { Task { await model.retryUpload() } }
                    .buttonStyle(.bordered).controlSize(.large)
            }
            if result.uploadMessage.hasPrefix("Uploaded") {
                Text("Open the desktop worker history for your summary. A manager can open detailed charts only if you enabled sharing for this check-in.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Button {
                model.leaveResult()
            } label: {
                Text("Back to check-ins").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
        }
    }
}

/// Always visible. The native app cannot send requests until the network
/// layer exists, so it says so plainly and points to working channels.
struct SupportView: View {
    let webURL: URL?

    var body: some View {
        GroupBox("Need support?") {
            VStack(alignment: .leading, spacing: 10) {
                Text(
                    "You never need a measurement to ask for help. This app cannot send requests yet: tell your supervisor directly, or use SiteGuard on the web."
                )
                .font(.callout)
                if let webURL {
                    Link(destination: webURL.appending(path: "mobile")) {
                        Text("Open SiteGuard support on the web").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered).controlSize(.large)
                }
            }
        }
    }
}
