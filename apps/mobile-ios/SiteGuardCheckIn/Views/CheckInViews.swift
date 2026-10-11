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
        VStack(alignment: .leading, spacing: 16) {
            Text("A check-in on your terms.").sgTitle()

            VStack(alignment: .leading, spacing: 12) {
                consentPoint("camera", "The camera stays on this phone. Frames are never saved or sent.")
                consentPoint("waveform.path.ecg", "Pulse and breathing are observations, not a diagnosis or clearance.")
                consentPoint("lock.shield", model.isPaired
                             ? "You choose below whether to upload or share. Both are off by default."
                             : "Nothing leaves this phone unless you pair it and opt in.")
            }
            .sgCard()

            VStack(alignment: .leading, spacing: 14) {
                Toggle("I voluntarily agree to this check-in", isOn: $consented)
                if model.isPaired {
                    Toggle("Upload and get a rest suggestion", isOn: $choices.uploadToSiteGuard)
                    if choices.uploadToSiteGuard {
                        Toggle("Let my manager see the readings", isOn: $choices.shareWithSupervisor)
                    }
                }
                Text(choices.uploadToSiteGuard
                     ? "Only this check-in. You can withdraw manager access later on the website."
                     : "Asked every time. You can stop whenever you want.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
            }
            .font(.callout.weight(.medium))
            .foregroundStyle(SGStyle.ink)
            .sgCard()

            if !model.configuration.hasPresageCredentials {
                VStack(alignment: .leading, spacing: 10) {
                    if model.hasSavedPresageKey && !replaceSavedKey {
                        HStack {
                            Label("Presage key saved", systemImage: "key.fill")
                                .font(.callout.weight(.semibold)).foregroundStyle(SGStyle.primary)
                            Spacer()
                            Menu("Manage") {
                                Button("Change key") { replaceSavedKey = true }
                                Button("Forget key", role: .destructive) { model.forgetPresageKey() }
                            }
                            .font(.callout.weight(.semibold))
                        }
                    } else {
                        Label("Presage key", systemImage: "key").font(.headline).foregroundStyle(SGStyle.ink)
                        SecureField("Enter API key", text: $enteredPresageKey)
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .sgField()
                        Toggle("Remember on this iPhone", isOn: $rememberPresageKey)
                            .font(.callout)
                        Text("Kept only in this phone's Keychain. Never uploaded to SiteGuard.")
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
            Button("Not now") { model.cancelConsent() }
                .buttonStyle(SGSecondaryButton())
            Text("Presage uses the internet to verify the app; telemetry is off.")
                .font(.footnote).foregroundStyle(SGStyle.muted)
        }
    }

    private func consentPoint(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.callout.weight(.semibold))
                .foregroundStyle(SGStyle.primary)
                .frame(width: 34, height: 34)
                .background(SGStyle.lime.opacity(0.14), in: Circle())
                .overlay(Circle().strokeBorder(SGStyle.lime.opacity(0.35)))
            Text(text).font(.callout).foregroundStyle(SGStyle.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct MeasuringView: View {
    @Bindable var model: CheckInModel
    let startedAt: Date

    var body: some View {
        let elapsed = max(0, Int(model.now.timeIntervalSince(startedAt)))
        let target = model.configuration.recommendedCheckInSeconds
        VStack(alignment: .leading, spacing: 16) {
            Text("Sit comfortably and rest.").sgTitle(size: 28)

            VStack(alignment: .leading, spacing: 10) {
                Group {
                    if let image = model.preview {
                        // Live positioning preview only; never saved.
                        Image(uiImage: image).resizable().scaledToFit()
                            .frame(maxWidth: .infinity)
                            .frame(height: 230)
                            .background(.black)
                            .accessibilityLabel("Camera preview for positioning")
                    } else {
                        VStack(spacing: 8) {
                            Image(systemName: "camera.fill").font(.title)
                            Text("Starting front camera").font(.callout)
                        }
                        .foregroundStyle(SGStyle.muted)
                        .frame(maxWidth: .infinity, minHeight: 190)
                        .background(SGStyle.background)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(LinearGradient(colors: [SGStyle.lime, SGStyle.sky.opacity(0.5)],
                                                     startPoint: .topLeading, endPoint: .bottomTrailing),
                                      lineWidth: 1.5))
                .shadow(color: SGStyle.lime.opacity(0.3), radius: 14)
                Label(model.guidance ?? "Face the camera and hold still.", systemImage: "info.circle")
                    .font(.callout).foregroundStyle(SGStyle.muted)
            }
            .sgCard()

            VStack(spacing: 18) {
                ZStack {
                    Circle().stroke(Color.white.opacity(0.08), lineWidth: 14)
                    Circle()
                        .trim(from: 0, to: CGFloat(min(elapsed, target)) / CGFloat(max(target, 1)))
                        .stroke(AngularGradient(colors: [SGStyle.lime, SGStyle.limeBright, SGStyle.sky, SGStyle.lime],
                                                center: .center),
                                style: StrokeStyle(lineWidth: 14, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .shadow(color: SGStyle.lime.opacity(0.7), radius: 12)
                        .animation(.linear(duration: 1), value: elapsed)
                    VStack(spacing: 2) {
                        Text(formatCountdown(elapsed))
                            .font(.system(size: 46, weight: .heavy, design: .rounded))
                            .monospacedDigit().foregroundStyle(SGStyle.ink)
                        Text(elapsed >= target ? "Finish when ready" : "of \(target) seconds")
                            .font(.footnote).foregroundStyle(SGStyle.muted)
                    }
                }
                .frame(width: 210, height: 210)
                .padding(.top, 4)
                HStack(spacing: 12) {
                    reading("Pulse", icon: "heart.fill", tint: SGStyle.ember,
                            value: model.pulseRateBpm, unit: "bpm")
                    reading("Breathing", icon: "wind", tint: SGStyle.sky,
                            value: model.breathingRateBrpm, unit: "brpm")
                }
                Text("Only stable Presage readings are shown. Time is a guide, not a medical threshold.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity)
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

    private func reading(_ title: String, icon: String, tint: Color, value: Double?, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: icon)
                .font(.caption.weight(.semibold)).foregroundStyle(tint)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value.map { "\(Int($0.rounded()))" } ?? "—")
                    .font(.system(size: 32, weight: .heavy, design: .rounded)).monospacedDigit()
                    .foregroundStyle(SGStyle.ink)
                Text(unit).font(.caption.weight(.medium)).foregroundStyle(SGStyle.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(tint.opacity(0.35)))
        .shadow(color: tint.opacity(value == nil ? 0 : 0.35), radius: 12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title): \(value.map { "\(Int($0.rounded())) \(unit)" } ?? "no valid reading yet")")
    }
}

struct CompletedView: View {
    @Bindable var model: CheckInModel
    let result: CheckInResult

    private var uploaded: Bool { result.receipt != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "checkmark")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(SGStyle.night)
                    .frame(width: 48, height: 48)
                    .background(SGStyle.lime, in: Circle())
                    .shadow(color: SGStyle.lime.opacity(0.7), radius: 16)
                    .padding(.bottom, 4)
                Text("Check-in complete.").sgTitle()
                Text("\(Int(result.endedAt.timeIntervalSince(result.startedAt))) seconds · \(result.validPulseCount) pulse and \(result.validBreathingCount) breathing readings")
                    .font(.callout).foregroundStyle(SGStyle.muted)
                Label(uploaded ? "Saved to your SiteGuard history" :
                        model.canRetryUpload ? "Upload not confirmed" : "Kept on this phone only",
                      systemImage: uploaded ? "checkmark.icloud" :
                        model.canRetryUpload ? "exclamationmark.icloud" : "iphone")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(model.canRetryUpload ? SGStyle.warning : SGStyle.ink)
                    .padding(.top, 4)
                if model.canRetryUpload {
                    Text(result.uploadMessage).font(.footnote).foregroundStyle(SGStyle.warning)
                }
            }
            .sgCard()

            if let receipt = result.receipt, let suggestion = receipt.suggestion {
                SuggestionCard(suggestion: suggestion, observations: receipt.observations,
                               checkInURL: URL(string: model.serverURLText)?
                                   .appending(path: "sessions/\(receipt.sessionId)"))
            } else if !uploaded && !model.canRetryUpload {
                Label(model.isPaired
                      ? "Turn on “Upload and get a rest suggestion” next time to get a personal suggestion."
                      : "Connect this phone to SiteGuard to get a personal rest suggestion after each check-in.",
                      systemImage: "lightbulb")
                    .font(.callout).foregroundStyle(SGStyle.muted)
                    .sgCard()
            }

            if model.canRetryUpload {
                Button("Retry upload") { Task { await model.retryUpload() } }
                    .buttonStyle(SGSecondaryButton())
            }
            Button("Done") { model.leaveResult() }
                .buttonStyle(SGPrimaryButton())
            Text("These observations do not establish recovery or fitness for work.")
                .font(.footnote).foregroundStyle(SGStyle.muted)
        }
    }
}

/// Shown only after SiteGuard stored the check-in. The worker decides whether
/// to ask for rest; a supervisor approves and schedules it on the website.
struct SuggestionCard: View {
    let suggestion: RestSuggestion
    let observations: CheckInObservations?
    let checkInURL: URL?
    @State private var detailsExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 18) {
                AuraPulse(size: 112) {
                    ZStack {
                        Circle()
                            .stroke(AngularGradient(colors: [SGStyle.lime, SGStyle.limeBright, SGStyle.sky, SGStyle.lime],
                                                    center: .center), lineWidth: 6)
                            .shadow(color: SGStyle.lime.opacity(0.6), radius: 8)
                        VStack(spacing: -2) {
                            Text("\(suggestion.suggestedMinutes)")
                                .font(.system(size: 36, weight: .heavy, design: .rounded))
                                .foregroundStyle(SGStyle.ink)
                            Text("min").font(.caption.weight(.bold)).foregroundStyle(SGStyle.muted)
                        }
                    }
                    .frame(width: 88, height: 88)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("SUGGESTED REST")
                        .font(.caption.bold()).tracking(1.5).foregroundStyle(SGStyle.primary)
                    Text("About \(suggestion.suggestedMinutes) minutes").sgTitle(size: 24)
                }
            }

            if let observations {
                VStack(spacing: 8) {
                    changeRow("Pulse", unit: "bpm", observations.pulse, observations.pulseComparison)
                    changeRow("Breathing", unit: "brpm", observations.breathing, observations.breathingComparison)
                }
            }

            Text("You decide whether to ask for it. A supervisor approves and schedules any extra rest. Not medical advice.")
                .font(.callout).foregroundStyle(SGStyle.ink)

            DisclosureGroup("Why this suggestion?", isExpanded: $detailsExpanded) {
                VStack(alignment: .leading, spacing: 8) {
                    if suggestion.origin != "gemini" {
                        Text("Standard suggestion: the AI assistant was unavailable.")
                            .font(.footnote.weight(.semibold)).foregroundStyle(SGStyle.muted)
                    }
                    ForEach(suggestion.rationale, id: \.self) { reason in
                        Text("• \(reason)").font(.callout).foregroundStyle(SGStyle.ink)
                    }
                    ForEach(suggestion.limitations, id: \.self) { limitation in
                        Text(limitation).font(.footnote).foregroundStyle(SGStyle.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
            }
            .font(.callout.weight(.semibold))
            .foregroundStyle(SGStyle.primary)

            if let checkInURL {
                Link(destination: checkInURL) {
                    Label("Ask for rest on SiteGuard", systemImage: "arrow.up.right")
                }
                .buttonStyle(SGSecondaryButton())
            }
        }
        .sgCard()
    }

    private func changeRow(_ title: String, unit: String, _ change: ObservedChange,
                           _ usual: UsualChange) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.callout.weight(.semibold)).foregroundStyle(SGStyle.ink)
                Spacer()
                if change.status == "available", let start = change.initialMedian, let end = change.finalMedian {
                    Text("\(whole(start)) → \(whole(end)) \(unit)")
                        .font(.callout.weight(.semibold)).monospacedDigit().foregroundStyle(SGStyle.primary)
                } else {
                    Text("Not enough data").font(.callout).foregroundStyle(SGStyle.muted)
                }
            }
            if change.status == "available", usual.status == "available", let usualDelta = usual.historicalMedianDelta {
                Text("Usually \(signed(usualDelta)) \(unit)")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SGStyle.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(SGStyle.border))
    }

    private func whole(_ value: Double) -> String { String(Int(value.rounded())) }
    private func signed(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        let text = rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
        return rounded > 0 ? "+\(text)" : text
    }
}

/// Always visible. The native app cannot send support requests itself, so it
/// says so plainly and points to working channels.
struct SupportView: View {
    let webURL: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Need help? You never need a check-in to ask. Talk to your supervisor, or use SiteGuard on the web.")
                .font(.footnote).foregroundStyle(SGStyle.muted)
            if let webURL {
                Link("Open worker support", destination: webURL.appending(path: "mobile"))
                    .font(.footnote.weight(.semibold))
            }
            Text("Observations support a conversation. They do not establish recovery or fitness for work.")
                .font(.footnote).foregroundStyle(SGStyle.muted)
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
    }
}
