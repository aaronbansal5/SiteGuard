import SwiftUI

struct ContentView: View {
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
    }
}

struct HomeView: View {
    @Bindable var model: CheckInModel
    @State private var intervalText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
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
                }
            }
            .onAppear { intervalText = String(model.reminder.intervalSeconds) }

            Button {
                model.openConsent()
            } label: {
                Text("Start check-in").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            Text(
                "Voluntary, about \(model.configuration.recommendedCheckInSeconds) seconds including camera warm-up. You can stop at any time."
            )
            .font(.footnote).foregroundStyle(.secondary)
        }
    }
}
