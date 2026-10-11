import SwiftUI

/// Shown before every check-in. State is fresh each time: consent is never
/// remembered between check-ins.
struct ConsentView: View {
    @Bindable var model: CheckInModel
    @State private var consented = false
    @State private var choices = ConsentChoices()
    @State private var starting = false
    @State private var enteredPresageKey = ""
    @State private var rememberPresageKey = true
    @State private var replaceSavedKey = false

    private var needsKeyEntry: Bool {
        !model.configuration.hasPresageCredentials && (!model.hasSavedPresageKey || replaceSavedKey)
    }

    private var canBegin: Bool {
        consented && !starting &&
        (!needsKeyEntry || !enteredPresageKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("BEFORE YOU BEGIN")
                .font(.caption.bold()).tracking(2).foregroundStyle(SGStyle.muted)
            Text("A check-in on your terms.")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(SGStyle.ink)
            Text("Review what happens before the front camera starts.")
                .font(.callout).foregroundStyle(SGStyle.muted)

            VStack(alignment: .leading, spacing: 16) {
                consentPoint("camera", "Camera stays on this phone",
                             "Presage measures pulse and breathing. SiteGuard does not store or send camera frames.")
                consentPoint("waveform.path.ecg", "Only observations are recorded",
                             "Readings include time, value, quality and source. They are not a diagnosis or clearance.")
                consentPoint("lock.shield", model.isPaired ? "You choose what to share" : "Private to this phone",
                             model.isPaired
                             ? "Upload and manager access are separate choices below, off by default."
                             : "No readings are uploaded unless you pair this phone and opt in.")
                Text("Presage uses the internet to verify the app; telemetry is off.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
            }
            .sgCard()

            VStack(alignment: .leading, spacing: 15) {
                Text("Your choices").font(.headline).foregroundStyle(SGStyle.ink)
                Toggle("I voluntarily agree to this check-in", isOn: $consented)
                Text("Asked every time. You may stop the measurement whenever you want.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
                if model.isPaired {
                    Divider()
                    Toggle("Upload this check-in to SiteGuard", isOn: $choices.uploadToSiteGuard)
                    if choices.uploadToSiteGuard {
                        Toggle("Allow my manager to view detailed readings", isOn: $choices.shareWithSupervisor)
                        Text("Only this check-in. You can later withdraw sharing on the worker website.")
                            .font(.footnote).foregroundStyle(SGStyle.muted)
                    }
                }
            }
            .sgCard()

            if !model.configuration.hasPresageCredentials {
                VStack(alignment: .leading, spacing: 9) {
                    Label("Presage key", systemImage: "key").font(.headline).foregroundStyle(SGStyle.ink)
                    if model.hasSavedPresageKey && !replaceSavedKey {
                        Label("Saved securely on this iPhone. You do not need to enter it again.",
                              systemImage: "checkmark.circle")
                            .font(.callout).foregroundStyle(SGStyle.primary)
                        HStack(spacing: 16) {
                            Button("Change key") { replaceSavedKey = true }
                            Button("Forget key") { model.forgetPresageKey() }
                        }
                        .font(.callout.weight(.semibold))
                    } else {
                        SecureField("Enter API key", text: $enteredPresageKey)
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                        Toggle("Remember securely on this iPhone", isOn: $rememberPresageKey)
                        Text("The key stays in this phone's device-only Keychain if you choose to remember it. It is never uploaded to SiteGuard.")
                            .font(.footnote).foregroundStyle(SGStyle.muted)
                        if replaceSavedKey {
                            Button("Keep existing key") {
                                enteredPresageKey = ""
                                replaceSavedKey = false
                            }
                            .font(.footnote.weight(.semibold))
                        }
                    }
                }
                .sgCard()
            }
            if let error = model.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(SGStyle.warning).sgCard()
            }
            Button {
                starting = true
                let key = enteredPresageKey
                enteredPresageKey = ""
                Task {
                    await model.begin(consented: consented, choices: choices,
                                      enteredPresageKey: key, rememberPresageKey: rememberPresageKey)
                    starting = false
                }
            } label: {
                Label(starting ? "Starting…" : "Begin check-in", systemImage: "camera")
            }
            .buttonStyle(SGPrimaryButton())
            .disabled(!canBegin)
            .opacity(canBegin ? 1 : 0.5)
            Button {
                model.cancelConsent()
            } label: {
                Text("Not now")
            }
            .buttonStyle(SGSecondaryButton())
        }
    }

    private func consentPoint(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.callout.weight(.semibold))
                .foregroundStyle(SGStyle.primary)
                .frame(width: 32, height: 32)
                .background(SGStyle.soft, in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.callout.weight(.semibold)).foregroundStyle(SGStyle.ink)
                Text(detail).font(.footnote).foregroundStyle(SGStyle.muted)
            }
        }
    }
}

struct MeasuringView: View {
    @Bindable var model: CheckInModel
    let startedAt: Date

    var body: some View {
        let elapsed = max(0, Int(model.now.timeIntervalSince(startedAt)))
        let target = model.configuration.recommendedCheckInSeconds
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("LIVE CHECK-IN")
                        .font(.caption.bold()).tracking(2).foregroundStyle(SGStyle.muted)
                    Text("Sit comfortably and rest.")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(SGStyle.ink)
                }
                Spacer()
                Image(systemName: "waveform.path.ecg")
                    .foregroundStyle(SGStyle.primary)
                    .frame(width: 38, height: 38)
                    .background(SGStyle.soft, in: RoundedRectangle(cornerRadius: 11))
            }
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Front camera preview", systemImage: "camera")
                        .font(.callout.weight(.semibold)).foregroundStyle(SGStyle.ink)
                    Spacer()
                    Text("ON DEVICE").font(.caption2.bold()).tracking(1)
                        .foregroundStyle(SGStyle.primary)
                }
                if let image = model.preview {
                    // Live positioning preview only; never saved.
                    Image(uiImage: image).resizable().scaledToFit()
                        .frame(maxWidth: .infinity)
                        .frame(height: 245)
                        .background(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .accessibilityLabel("Camera preview for positioning")
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "camera").font(.title)
                        Text("Starting front camera").font(.callout)
                    }
                    .foregroundStyle(SGStyle.muted)
                    .frame(maxWidth: .infinity, minHeight: 190)
                    .background(SGStyle.background, in: RoundedRectangle(cornerRadius: 14))
                }
                Label(model.guidance ?? "Face the camera and hold still.", systemImage: "info.circle")
                    .font(.callout).foregroundStyle(SGStyle.muted)
            }
            .sgCard()

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("ELAPSED").font(.caption.bold()).tracking(1.5).foregroundStyle(SGStyle.muted)
                        Text(formatCountdown(elapsed))
                            .font(.system(size: 44, weight: .bold, design: .rounded))
                            .monospacedDigit().foregroundStyle(SGStyle.ink)
                    }
                    Spacer()
                    Text("Suggested: \(target)s").font(.footnote).foregroundStyle(SGStyle.muted)
                }
                ProgressView(value: Double(min(elapsed, target)), total: Double(target))
                    .tint(SGStyle.primary)
                Text(elapsed >= target
                     ? "Suggested time reached. Finish whenever you are ready."
                     : "Time is a data-sufficiency guide, not a medical threshold.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
            }
            .sgCard()

            HStack(spacing: 12) {
                measurementCard("Pulse", icon: "waveform.path.ecg", value: model.pulseRateBpm, unit: "bpm")
                measurementCard("Breathing", icon: "wind", value: model.breathingRateBrpm, unit: "brpm")
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("\(model.collector.envelopes.count) observations · \(model.collector.validPulseCount) valid pulse · \(model.collector.validBreathingCount) valid breathing")
                    .font(.callout.weight(.medium)).foregroundStyle(SGStyle.ink)
                Text("Only stable Presage readings appear above. A dash means no valid value yet.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
            }
            .sgCard()
            if let error = model.errorMessage {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(SGStyle.warning).sgCard()
            }
            Button {
                Task { await model.finish() }
            } label: {
                Label("Finish check-in", systemImage: "stop.fill")
            }
            .buttonStyle(SGPrimaryButton())
            .disabled(model.isFinishing)
            .opacity(model.isFinishing ? 0.6 : 1)
        }
    }

    private func measurementCard(_ title: String, icon: String, value: Double?, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon).font(.callout.weight(.semibold)).foregroundStyle(SGStyle.ink)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value.map { "\(Int($0.rounded()))" } ?? "—")
                    .font(.system(size: 30, weight: .bold, design: .rounded)).monospacedDigit()
                Text(unit).font(.caption.weight(.medium))
            }
            .foregroundStyle(SGStyle.primary)
            .accessibilityLabel("\(title): \(value.map { "\(Int($0.rounded())) \(unit)" } ?? "no valid reading yet")")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .sgCard()
    }
}

struct CompletedView: View {
    @Bindable var model: CheckInModel
    let result: CheckInResult

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 36)).foregroundStyle(SGStyle.primary)
                Text("Check-in complete.")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .foregroundStyle(SGStyle.ink)
                Text("Thanks for taking a moment to rest. These observations do not establish recovery or fitness for work.")
                    .font(.callout).foregroundStyle(SGStyle.muted)
            }
            .sgCard()

            VStack(alignment: .leading, spacing: 14) {
                Text("This check-in").font(.headline).foregroundStyle(SGStyle.ink)
                HStack(spacing: 12) {
                    resultMetric("DURATION", "\(Int(result.endedAt.timeIntervalSince(result.startedAt)))s")
                    resultMetric("READINGS", "\(result.readingCount)")
                }
                HStack(spacing: 12) {
                    resultMetric("VALID PULSE", "\(result.validPulseCount)")
                    resultMetric("VALID BREATHING", "\(result.validBreathingCount)")
                }
            }
            .sgCard()

            VStack(alignment: .leading, spacing: 9) {
                Label(result.uploadMessage.hasPrefix("Uploaded") ? "Sent to SiteGuard" :
                      model.canRetryUpload ? "Upload not confirmed" : "Kept on this phone",
                      systemImage: result.uploadMessage.hasPrefix("Uploaded") ? "checkmark.icloud" :
                      model.canRetryUpload ? "exclamationmark.icloud" : "iphone")
                    .font(.headline).foregroundStyle(SGStyle.ink)
                Text(result.uploadMessage)
                    .font(.callout)
                    .foregroundStyle(model.canRetryUpload ? SGStyle.warning : SGStyle.muted)
                if result.uploadMessage.hasPrefix("Uploaded") {
                    Text("Open your worker history on the desktop. A manager sees detailed readings only if you chose sharing for this check-in.")
                        .font(.footnote).foregroundStyle(SGStyle.muted)
                }
            }
            .sgCard()
            if model.canRetryUpload {
                Button("Retry upload") { Task { await model.retryUpload() } }
                    .buttonStyle(SGSecondaryButton())
            }
            Button {
                model.leaveResult()
            } label: {
                Label("Back to check-ins", systemImage: "arrow.left")
            }
            .buttonStyle(SGPrimaryButton())
        }
    }

    private func resultMetric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.caption2.bold()).tracking(1).foregroundStyle(SGStyle.muted)
            Text(value).font(.title2.bold()).monospacedDigit().foregroundStyle(SGStyle.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(SGStyle.background, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Always visible. The native app cannot send requests until the network
/// layer exists, so it says so plainly and points to working channels.
struct SupportView: View {
    let webURL: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Need support?", systemImage: "person.crop.circle.badge.questionmark")
                .font(.headline).foregroundStyle(SGStyle.ink)
            Text("You never need a measurement to ask for help. Tell your supervisor directly, or use SiteGuard on the web. This app cannot send support requests yet.")
                .font(.callout).foregroundStyle(SGStyle.muted)
            if let webURL {
                Link(destination: webURL.appending(path: "mobile")) {
                    Label("Open worker support", systemImage: "arrow.up.right")
                }
                .buttonStyle(SGSecondaryButton())
            }
        }
        .sgCard()
    }
}
