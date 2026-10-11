import SwiftUI

enum SGStyle {
    static let background = Color(red: 244.0 / 255, green: 247.0 / 255, blue: 245.0 / 255)
    static let ink = Color(red: 33.0 / 255, green: 61.0 / 255, blue: 55.0 / 255)
    static let muted = Color(red: 82.0 / 255, green: 101.0 / 255, blue: 93.0 / 255)
    static let primary = Color(red: 36.0 / 255, green: 74.0 / 255, blue: 60.0 / 255)
    static let soft = Color(red: 234.0 / 255, green: 242.0 / 255, blue: 228.0 / 255)
    static let border = Color(red: 220.0 / 255, green: 229.0 / 255, blue: 220.0 / 255)
    static let warning = Color(red: 141.0 / 255, green: 72.0 / 255, blue: 38.0 / 255)
}

extension View {
    func sgCard() -> some View {
        self.padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(SGStyle.border, lineWidth: 1))
    }
}

struct SGPrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(SGStyle.primary, in: RoundedRectangle(cornerRadius: 15))
            .opacity(configuration.isPressed ? 0.82 : 1)
    }
}

struct SGSecondaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(SGStyle.primary)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(SGStyle.soft, in: RoundedRectangle(cornerRadius: 15))
            .opacity(configuration.isPressed ? 0.76 : 1)
    }
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var model: CheckInModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 11) {
                        Image(systemName: "shield.lefthalf.filled")
                            .font(.title3)
                            .foregroundStyle(SGStyle.primary)
                            .frame(width: 40, height: 40)
                            .background(SGStyle.soft, in: RoundedRectangle(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("SiteGuard").font(.title3.bold()).foregroundStyle(SGStyle.ink)
                            Text("AdaptiveBreak").font(.caption).foregroundStyle(SGStyle.muted)
                        }
                        Spacer()
                        if model.configuration.demoMode {
                            Text("DEMO")
                                .font(.caption2.bold())
                                .tracking(1.3)
                                .foregroundStyle(SGStyle.primary)
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .background(SGStyle.soft, in: Capsule())
                        }
                    }
                    .padding(.bottom, 4)

                    switch model.stage {
                    case .home: HomeView(model: model)
                    case .consent: ConsentView(model: model)
                    case .measuring(let startedAt): MeasuringView(model: model, startedAt: startedAt)
                    case .completed(let result): CompletedView(model: model, result: result)
                    }

                    SupportView(webURL: model.configuration.siteGuardWebURL)
                    Text("Observations support a conversation. They do not establish recovery or fitness for work.")
                        .font(.footnote)
                        .foregroundStyle(SGStyle.muted)
                        .padding(.horizontal, 4)
                        .padding(.bottom, 20)
                }
                .padding(.horizontal, 18)
                .padding(.top, 16)
            }
            .background(SGStyle.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
        .tint(SGStyle.primary)
        .preferredColorScheme(.light)
        .onChange(of: scenePhase) { _, phase in
            if phase == .background || phase == .inactive {
                Task { await model.stopForBackground() }
            }
        }
    }
}

struct HomeView: View {
    @Bindable var model: CheckInModel
    @State private var intervalText = ""
    @State private var pairingCode = ""
    @State private var serverURL = ""
    @State private var selectedWorkerId = ""
    @State private var connectionExpanded = false

    private var selectedMatchesPairing: Bool {
        !model.isPaired || selectedWorkerId == model.pairedWorkerId
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 12) {
                Text("WORKER CHECK-IN")
                    .font(.caption.bold()).tracking(2).foregroundStyle(SGStyle.muted)
                Text("Take a moment to check in.")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(SGStyle.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("A voluntary camera check-in during your break. You control whether readings leave this phone.")
                    .font(.callout).foregroundStyle(SGStyle.muted)
                Button { model.openConsent() } label: {
                    Label("Start check-in", systemImage: "arrow.right")
                }
                .buttonStyle(SGPrimaryButton())
                .disabled(!selectedMatchesPairing)
                .opacity(selectedMatchesPairing ? 1 : 0.5)
                if !selectedMatchesPairing {
                    Label("Pair this phone to the selected worker first.", systemImage: "exclamationmark.circle")
                        .font(.footnote).foregroundStyle(SGStyle.warning)
                }
                Text("About \(model.configuration.recommendedCheckInSeconds) seconds, including camera warm-up. Stop whenever you want.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
            }
            .sgCard()

            if model.reminderPrompt {
                VStack(alignment: .leading, spacing: 10) {
                    Label("CHECK-IN AVAILABLE · OPTIONAL", systemImage: "bell.badge")
                        .font(.caption.bold()).foregroundStyle(SGStyle.primary)
                    Text("Ready when you are.").font(.title3.bold()).foregroundStyle(SGStyle.ink)
                    Text("Skipping does not affect your break or requests.")
                        .font(.callout).foregroundStyle(SGStyle.muted)
                    Button("Review consent and check in") { model.openConsent() }
                        .buttonStyle(SGPrimaryButton())
                    Button("Not now") { model.dismissReminder() }
                        .buttonStyle(SGSecondaryButton())
                }
                .sgCard()
            }

            connectionCard
            reminderCard
        }
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Desktop connection", systemImage: "desktopcomputer")
                    .font(.headline).foregroundStyle(SGStyle.ink)
                Spacer()
                Text(model.isPaired ? "PAIRED" : "OPTIONAL")
                    .font(.caption2.bold()).tracking(1)
                    .foregroundStyle(SGStyle.primary)
                    .padding(.horizontal, 9).padding(.vertical, 6)
                    .background(SGStyle.soft, in: Capsule())
            }
            Text(model.isPaired
                 ? "Paired to \(model.availableWorkers.first(where: { $0.id == model.pairedWorkerId })?.displayName ?? model.pairedWorkerId ?? "worker"). Upload and manager sharing are still off unless you choose them for each check-in."
                 : "You can measure locally now. Pair to send a future check-in to the desktop.")
                .font(.callout).foregroundStyle(SGStyle.muted)
            DisclosureGroup(model.isPaired ? "Change pairing" : "Connect this phone", isExpanded: $connectionExpanded) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("1. Enter the trusted HTTPS address shown on your Mac.")
                        .font(.footnote).foregroundStyle(SGStyle.muted)
                    TextField("https://Mac-address:5173", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("SiteGuard desktop HTTPS address")
                    Button("Load worker names") {
                        Task { await model.loadWorkers(serverURL: serverURL) }
                    }
                    .buttonStyle(SGSecondaryButton())
                    if !model.availableWorkers.isEmpty {
                        Picker("Your name", selection: $selectedWorkerId) {
                            Text("Select a worker").tag("")
                            ForEach(model.availableWorkers) { worker in
                                Text(worker.displayName).tag(worker.id)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    Text("2. On the worker web page, choose the same name and get a one-time code.")
                        .font(.footnote).foregroundStyle(SGStyle.muted)
                    TextField("8-character pairing code", text: $pairingCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                    Button(model.isPaired ? "Pair again" : "Pair phone") {
                        Task { await model.pair(code: pairingCode, serverURL: serverURL,
                                                selectedWorkerId: selectedWorkerId) }
                    }
                    .buttonStyle(SGPrimaryButton())
                    .disabled(pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).count != 8 || selectedWorkerId.isEmpty)
                    if let message = model.pairingMessage {
                        Label(message, systemImage: model.isPaired ? "checkmark.circle" : "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(model.isPaired ? SGStyle.primary : SGStyle.warning)
                    }
                }
                .padding(.top, 12)
            }
            .font(.callout.weight(.semibold))
            .foregroundStyle(SGStyle.primary)
        }
        .sgCard()
    }

    private var reminderCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Check-in reminders", systemImage: "bell")
                .font(.headline).foregroundStyle(SGStyle.ink)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                switch model.reminder.phase {
                case .waiting:
                    Text(formatCountdown(model.reminder.remainingSeconds(now: model.now)))
                        .font(.system(size: 40, weight: .bold, design: .rounded)).monospacedDigit()
                    Text("until the next optional prompt").font(.footnote)
                case .due:
                    Text("Now").font(.title.bold())
                    Text("check-in available").font(.footnote)
                case .off, .checkingIn:
                    Text("Off").font(.title.bold())
                    Text("no reminder scheduled").font(.footnote)
                }
            }
            .foregroundStyle(SGStyle.ink)
            Toggle("Remind me to check in", isOn: Binding(
                get: { model.reminder.phase != .off },
                set: { model.setRemindersEnabled($0) }))
            if !model.notificationsAllowed {
                Button("Enable background notification") {
                    Task { await model.requestNotificationPermission() }
                }
                .buttonStyle(SGSecondaryButton())
            }
            if let message = model.notificationStatusMessage {
                Text(message).font(.footnote).foregroundStyle(SGStyle.warning)
            }
            DisclosureGroup("Change reminder interval") {
                HStack {
                    TextField("Seconds", text: $intervalText)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Reminder interval in seconds")
                    Button("Set") {
                        if let value = Int(intervalText) { model.setReminderInterval(value) }
                        intervalText = String(model.reminder.intervalSeconds)
                    }
                    .buttonStyle(SGSecondaryButton())
                    .frame(width: 82)
                }
                Text("A convenience reminder only. It never starts a camera measurement.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
            }
            .font(.callout.weight(.semibold))
        }
        .sgCard()
        .onAppear {
            intervalText = String(model.reminder.intervalSeconds)
            serverURL = model.serverURLText
            selectedWorkerId = model.pairedWorkerId ?? ""
            connectionExpanded = !model.isPaired
            if serverURL.hasPrefix("https://") {
                Task { await model.loadWorkers(serverURL: serverURL) }
            }
        }
    }
}
