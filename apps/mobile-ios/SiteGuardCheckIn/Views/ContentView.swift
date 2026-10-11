import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var model: CheckInModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label(
                        model.configuration.demoMode
                            ? "Demo build · fictional workforce" : "SiteGuard check-in",
                        systemImage: "shield")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                    switch model.stage {
                    case .home:
                        HomeView(model: model)
                    case .consent:
                        ConsentView(model: model)
                    case .measuring(let startedAt):
                        MeasuringView(model: model, startedAt: startedAt)
                    case .completed(let result):
                        CompletedView(model: model, result: result)
                    }
                    SupportView(webURL: model.configuration.siteGuardWebURL)
                    Text(
                        "Observations support a conversation. They do not establish recovery or fitness for work."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                .padding()
            }
            .navigationTitle("SiteGuard")
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { Task { await model.stopForBackground() } }
        }
    }
}

struct HomeView: View {
    @Bindable var model: CheckInModel
    @State private var intervalText = ""
    @State private var pairingCode = ""
    @State private var serverURL = ""
    @State private var selectedWorkerId = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            GroupBox("Desktop connection") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.isPaired
                         ? "Paired to \(model.availableWorkers.first(where: { $0.id == model.pairedWorkerId })?.displayName ?? model.pairedWorkerId ?? "worker"). You choose whether to upload and share each check-in."
                         : "Not paired. Readings remain on this phone unless you pair and opt in.")
                        .font(.callout)
                    Text("Choose your demo worker name here. On the SiteGuard worker web page, choose the same name and get a one-time code.")
                        .font(.footnote).foregroundStyle(.secondary)
                    TextField("https://Mac-address:5173", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.URL)
                    Button("Load worker names") {
                        Task { await model.loadWorkers(serverURL: serverURL) }
                    }
                    if !model.availableWorkers.isEmpty {
                        Picker("Your name", selection: $selectedWorkerId) {
                            Text("Select a worker").tag("")
                            ForEach(model.availableWorkers) { worker in
                                Text(worker.displayName).tag(worker.id)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    TextField("8-character pairing code", text: $pairingCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                    Button(model.isPaired ? "Pair again" : "Pair phone") {
                        Task { await model.pair(
                            code: pairingCode, serverURL: serverURL,
                            selectedWorkerId: selectedWorkerId) }
                    }
                    .disabled(pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).count != 8 || selectedWorkerId.isEmpty)
                    if let message = model.pairingMessage {
                        Text(message).font(.footnote)
                    }
                }
            }
            if model.reminderPrompt {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Check-in available · optional").font(.caption.weight(.bold))
                    Text("Would you like to check in?").font(.title3.bold())
                    Text("Only if you want to. Skipping has no effect on your breaks or requests.")
                    Button("Review consent and check in") { model.openConsent() }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                    Button("Not now") { model.dismissReminder() }
                        .buttonStyle(.bordered).controlSize(.large)
                }
                .padding()
                .background(.green.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityElement(children: .contain)
            }

            GroupBox {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Check-in reminders").font(.headline)
                        Spacer()
                        if model.configuration.demoMode {
                            Text("Demo interval").font(.caption.weight(.semibold))
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(.yellow.opacity(0.2), in: Capsule())
                        }
                    }
                    switch model.reminder.phase {
                    case .waiting:
                        Text("Next optional reminder in").foregroundStyle(.secondary)
                        Text(formatCountdown(model.reminder.remainingSeconds(now: model.now)))
                            .font(.system(size: 44, weight: .bold, design: .rounded).monospacedDigit())
                    case .due:
                        Text("Reminder: now").font(.title.bold())
                    case .off, .checkingIn:
                        Text("Reminders off").font(.title.bold())
                    }
                    HStack {
                        TextField("Seconds", text: $intervalText)
                            .keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder)
                            .frame(minHeight: 44)
                        Button("Set interval") {
                            if let value = Int(intervalText) { model.setReminderInterval(value) }
                            intervalText = String(model.reminder.intervalSeconds)
                        }
                        .buttonStyle(.bordered).controlSize(.large)
                    }
                    Text(
                        "Check-in reminder every \(model.reminder.intervalSeconds) seconds. A reminder is a convenience, not a rest or health recommendation. It never starts a measurement."
                    )
                    .font(.footnote).foregroundStyle(.secondary)
                    Toggle(
                        "Remind me to check in",
                        isOn: Binding(
                            get: { model.reminder.phase != .off },
                            set: { model.setRemindersEnabled($0) }))
                    if !model.notificationsAllowed {
                        Button("Also notify me in the background") {
                            Task { await model.requestNotificationPermission() }
                        }
                        .controlSize(.large)
                    }
                    if let message = model.notificationStatusMessage {
                        Text(message).font(.footnote).foregroundStyle(.orange)
                    }
                }
            }
            .onAppear {
                intervalText = String(model.reminder.intervalSeconds)
                serverURL = model.serverURLText
                selectedWorkerId = model.pairedWorkerId ?? ""
                if serverURL.hasPrefix("https://") {
                    Task { await model.loadWorkers(serverURL: serverURL) }
                }
            }

            Button {
                model.openConsent()
            } label: {
                Text("Start check-in").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .disabled(model.isPaired && selectedWorkerId != model.pairedWorkerId)
            if model.isPaired && selectedWorkerId != model.pairedWorkerId {
                Text("Pair this phone to the selected worker before starting a check-in.")
                    .font(.footnote).foregroundStyle(.orange)
            }
            Text(
                "Voluntary, about \(model.configuration.recommendedCheckInSeconds) seconds including camera warm-up. You can stop at any time."
            )
            .font(.footnote).foregroundStyle(.secondary)
        }
    }
}
