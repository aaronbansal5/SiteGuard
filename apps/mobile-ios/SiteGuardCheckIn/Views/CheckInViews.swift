import SwiftUI

/// Shown before every check-in. State is fresh each time: consent is never
/// remembered between check-ins.
struct ConsentView: View {
    @Bindable var model: CheckInModel
    @State private var consented = false
    @State private var choices = ConsentChoices()
    @State private var starting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Before you begin").font(.title2.bold())
            VStack(alignment: .leading, spacing: 10) {
                Text("**Camera, on this phone only.** Presage measures pulse and breathing from the front camera on the device. Frames are not stored or sent by SiteGuard.")
                Text("**Only normalized observations.** Timestamped pulse, breathing rate, source and quality.")
                Text("**No identification, no clearance.** Readings cannot show that you have recovered or are fit to return to work.")
                Text("**Not uploaded yet.** This build is not connected to SiteGuard, so readings stay on this screen and are discarded afterwards.")
                Text("**Presage needs the internet** to verify the app; telemetry is turned off.")
            }
            .font(.callout)
            // Sharing with safety operations is offered once uploads exist;
            // until then there is nothing to share (choices stay default/private).
            Toggle("I understand the limitations and voluntarily agree to record this check-in.", isOn: $consented)
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red).font(.callout)
            }
            Button {
                starting = true
                Task {
                    await model.begin(consented: consented, choices: choices)
                    starting = false
                }
            } label: {
                Text(starting ? "Starting…" : "Begin check-in").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .disabled(!consented || starting)
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
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("Camera preview for positioning")
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
            Text(
                "\(model.collector.validPulseCount) valid pulse and \(model.collector.validBreathingCount) valid breathing readings so far."
            )
            .font(.footnote)
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
            Text(
                "Your summary and personal comparison are computed by SiteGuard after upload, so they are not available in this build."
            )
            .font(.footnote).foregroundStyle(.secondary)
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
