import SwiftUI

/// Brand palette sampled from the SiteGuard logo: navy, lime, and the ember pulse line.
enum SGStyle {
    static let night = Color(red: 2.0 / 255, green: 8.0 / 255, blue: 24.0 / 255)
    static let navy = Color(red: 0, green: 18.0 / 255, blue: 52.0 / 255)
    static let lime = Color(red: 120.0 / 255, green: 200.0 / 255, blue: 0)
    static let limeBright = Color(red: 172.0 / 255, green: 236.0 / 255, blue: 70.0 / 255)
    static let ember = Color(red: 248.0 / 255, green: 80.0 / 255, blue: 0)
    static let sky = Color(red: 64.0 / 255, green: 196.0 / 255, blue: 1)
    static let ink = Color.white
    static let muted = Color.white.opacity(0.64)
    static let primary = limeBright
    static let soft = Color.white.opacity(0.09)
    static let border = Color.white.opacity(0.14)
    static let background = Color.white.opacity(0.06)
    static let warning = Color(red: 1, green: 0.66, blue: 0.4)
    static let headline = LinearGradient(colors: [.white, limeBright], startPoint: .topLeading,
                                         endPoint: .bottomTrailing)
}

extension View {
    func sgCard() -> some View {
        self.padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .strokeBorder(LinearGradient(colors: [.white.opacity(0.3), .white.opacity(0.04)],
                                                 startPoint: .topLeading, endPoint: .bottomTrailing),
                                  lineWidth: 1))
            .shadow(color: .black.opacity(0.35), radius: 24, y: 12)
    }

    func sgTitle(size: CGFloat = 30) -> some View {
        self.font(.system(size: size, weight: .heavy, design: .rounded))
            .foregroundStyle(SGStyle.headline)
            .fixedSize(horizontal: false, vertical: true)
    }

    func sgField() -> some View {
        self.padding(.horizontal, 14)
            .frame(minHeight: 46)
            .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(SGStyle.border))
            .foregroundStyle(SGStyle.ink)
    }
}

struct SGPrimaryButton: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.bold))
            .foregroundStyle(SGStyle.night)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(LinearGradient(colors: [SGStyle.limeBright, SGStyle.lime],
                                       startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: Capsule())
            .shadow(color: SGStyle.lime.opacity(isEnabled ? 0.55 : 0), radius: 18, y: 6)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct SGSecondaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(SGStyle.ink)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Color.white.opacity(configuration.isPressed ? 0.14 : 0.08), in: Capsule())
            .overlay(Capsule().strokeBorder(SGStyle.border))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Slowly drifting brand-colored glows behind every screen.
struct AuraBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    var body: some View {
        ZStack {
            LinearGradient(colors: [SGStyle.night, SGStyle.navy, SGStyle.night],
                           startPoint: .top, endPoint: .bottom)
            Circle().fill(SGStyle.lime.opacity(0.34)).frame(width: 360).blur(radius: 120)
                .offset(x: drift ? 130 : -70, y: drift ? -250 : -330)
            Circle().fill(SGStyle.sky.opacity(0.26)).frame(width: 320).blur(radius: 130)
                .offset(x: drift ? -150 : 60, y: drift ? 160 : 300)
            Circle().fill(SGStyle.ember.opacity(0.16)).frame(width: 240).blur(radius: 110)
                .offset(x: drift ? 90 : 170, y: drift ? 460 : 360)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 10).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

/// Breathing glow and ripples around a central element.
struct AuraPulse<Content: View>: View {
    var size: CGFloat = 170
    var color: Color = SGStyle.lime
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animate = false

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { ring in
                Circle()
                    .stroke(color.opacity(0.5 - Double(ring) * 0.13), lineWidth: 1.5)
                    .scaleEffect(animate ? 1.05 + CGFloat(ring) * 0.2 : 0.8 + CGFloat(ring) * 0.12)
                    .opacity(animate ? 0.25 : 0.9)
            }
            Circle()
                .fill(RadialGradient(colors: [color.opacity(0.5), .clear], center: .center,
                                     startRadius: 4, endRadius: size * 0.6))
                .scaleEffect(animate ? 1.12 : 0.9)
            content
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 2.6).repeatForever(autoreverses: true)) { animate = true }
        }
    }
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var model: CheckInModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Image("SiteGuardLogo")
                            .resizable()
                            .scaledToFit()
                            .frame(height: 28)
                            .padding(.horizontal, 14).padding(.vertical, 9)
                            .background(.white, in: Capsule())
                            .shadow(color: SGStyle.lime.opacity(0.35), radius: 14)
                            .accessibilityLabel("SiteGuard")
                        Spacer()
                        if model.configuration.demoMode {
                            Text("DEMO")
                                .font(.caption2.bold())
                                .tracking(1.3)
                                .foregroundStyle(SGStyle.primary)
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .background(SGStyle.soft, in: Capsule())
                                .overlay(Capsule().strokeBorder(SGStyle.lime.opacity(0.4)))
                        }
                    }

                    Group {
                        switch model.stage {
                        case .home: HomeView(model: model)
                        case .consent: ConsentView(model: model)
                        case .measuring(let startedAt): MeasuringView(model: model, startedAt: startedAt)
                        case .completed(let result): CompletedView(model: model, result: result)
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .bottom)))

                    SupportView(webURL: model.configuration.siteGuardWebURL)
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)
                .padding(.bottom, 28)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: model.stage)
            }
            .scrollIndicators(.hidden)
            .background(AuraBackground())
            .toolbar(.hidden, for: .navigationBar)
        }
        .tint(SGStyle.lime)
        .preferredColorScheme(.dark)
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
    @State private var reminderSettingsExpanded = false

    private var selectedMatchesPairing: Bool {
        !model.isPaired || model.rosterRequiresSignIn || selectedWorkerId == model.pairedWorkerId
    }

    private var pairedName: String {
        model.pairedWorkerName
            ?? model.availableWorkers.first(where: { $0.id == model.pairedWorkerId })?.displayName
            ?? "your account"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(spacing: 18) {
                AuraPulse(size: 190) {
                    Image("SiteGuardShield")
                        .resizable()
                        .scaledToFit()
                        .frame(height: 92)
                        .shadow(color: SGStyle.lime.opacity(0.6), radius: 18)
                }
                .padding(.top, 6)
                VStack(spacing: 8) {
                    Text("Take a moment\nto check in.")
                        .multilineTextAlignment(.center)
                        .sgTitle(size: 34)
                    Text("About \(model.configuration.recommendedCheckInSeconds) seconds with the front camera. Optional, and you can stop anytime.")
                        .multilineTextAlignment(.center)
                        .font(.callout).foregroundStyle(SGStyle.muted)
                }
                Button { model.openConsent() } label: {
                    Label("Start check-in", systemImage: "sparkles")
                }
                .buttonStyle(SGPrimaryButton())
                .disabled(!selectedMatchesPairing)
                .opacity(selectedMatchesPairing ? 1 : 0.5)
                if !selectedMatchesPairing {
                    Label("Pair this phone to the selected worker first.", systemImage: "exclamationmark.circle")
                        .font(.footnote).foregroundStyle(SGStyle.warning)
                }
            }
            .frame(maxWidth: .infinity)
            .sgCard()

            if model.reminderPrompt {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Check-in available", systemImage: "bell.badge.fill")
                        .font(.headline).foregroundStyle(SGStyle.primary)
                    Text("Optional. Skipping does not affect your break or requests.")
                        .font(.callout).foregroundStyle(SGStyle.muted)
                    HStack(spacing: 10) {
                        Button("Not now") { model.dismissReminder() }
                            .buttonStyle(SGSecondaryButton())
                        Button("Check in") { model.openConsent() }
                            .buttonStyle(SGPrimaryButton())
                    }
                }
                .sgCard()
            }

            connectionCard
            reminderCard
        }
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

    private func statusIcon(_ name: String, glowing: Bool) -> some View {
        Image(systemName: name)
            .font(.headline)
            .foregroundStyle(glowing ? SGStyle.night : SGStyle.ink)
            .frame(width: 40, height: 40)
            .background(glowing ? AnyShapeStyle(SGStyle.lime) : AnyShapeStyle(SGStyle.soft), in: Circle())
            .shadow(color: SGStyle.lime.opacity(glowing ? 0.6 : 0), radius: 10)
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                statusIcon(model.isPaired ? "checkmark" : "link", glowing: model.isPaired)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.isPaired ? "Connected" : "Not connected")
                        .font(.headline).foregroundStyle(SGStyle.ink)
                    Text(model.isPaired
                         ? "As \(pairedName)"
                         : "Connect to save check-ins and get suggestions")
                        .font(.footnote).foregroundStyle(SGStyle.muted)
                }
                Spacer()
                Button(connectionExpanded ? "Close" : (model.isPaired ? "Change" : "Connect")) {
                    withAnimation(.spring(response: 0.4)) { connectionExpanded.toggle() }
                }
                .font(.callout.weight(.semibold))
                .foregroundStyle(SGStyle.primary)
            }

            if connectionExpanded {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Your Mac's SiteGuard address")
                        .font(.footnote.weight(.semibold)).foregroundStyle(SGStyle.muted)
                    HStack(spacing: 8) {
                        TextField("https://Mac-address:5173", text: $serverURL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .sgField()
                            .accessibilityLabel("SiteGuard desktop HTTPS address")
                        Button("Check") {
                            Task { await model.loadWorkers(serverURL: serverURL) }
                        }
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(SGStyle.primary)
                    }
                    if !model.availableWorkers.isEmpty {
                        Picker("Your name", selection: $selectedWorkerId) {
                            Text("Select your name").tag("")
                            ForEach(model.availableWorkers) { worker in
                                Text(worker.displayName).tag(worker.id)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    Text("One-time code from the SiteGuard website")
                        .font(.footnote.weight(.semibold)).foregroundStyle(SGStyle.muted)
                    TextField("8-character code", text: $pairingCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(.title3, design: .monospaced).weight(.semibold))
                        .sgField()
                    Button(model.isPaired ? "Pair again" : "Pair phone") {
                        Task { await model.pair(code: pairingCode, serverURL: serverURL,
                                                selectedWorkerId: selectedWorkerId) }
                    }
                    .buttonStyle(SGPrimaryButton())
                    .disabled(pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).count != 8
                              || (selectedWorkerId.isEmpty && !model.rosterRequiresSignIn))
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            if let message = model.pairingMessage {
                Label(message, systemImage: model.isPaired ? "checkmark.circle" : "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(model.isPaired ? SGStyle.primary : SGStyle.warning)
            }
        }
        .sgCard()
    }

    private var reminderStatus: String {
        switch model.reminder.phase {
        case .waiting: return "Next in \(formatCountdown(model.reminder.remainingSeconds(now: model.now)))"
        case .due: return "Check-in available now"
        case .off, .checkingIn: return "Off"
        }
    }

    private var reminderCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                statusIcon("bell.fill", glowing: model.reminder.phase != .off)
                Toggle(isOn: Binding(
                    get: { model.reminder.phase != .off },
                    set: { model.setRemindersEnabled($0) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Reminders").font(.headline).foregroundStyle(SGStyle.ink)
                        Text(reminderStatus)
                            .font(.footnote).monospacedDigit().foregroundStyle(SGStyle.muted)
                    }
                }
            }
            if model.reminder.phase != .off && !model.notificationsAllowed {
                Button("Allow notifications") {
                    Task { await model.requestNotificationPermission() }
                }
                .font(.callout.weight(.semibold))
                .foregroundStyle(SGStyle.primary)
            }
            if let message = model.notificationStatusMessage {
                Text(message).font(.footnote).foregroundStyle(SGStyle.warning)
            }
            DisclosureGroup("Interval", isExpanded: $reminderSettingsExpanded) {
                HStack {
                    TextField("Seconds", text: $intervalText)
                        .keyboardType(.numberPad)
                        .sgField()
                        .accessibilityLabel("Reminder interval in seconds")
                    Button("Set") {
                        if let value = Int(intervalText) { model.setReminderInterval(value) }
                        intervalText = String(model.reminder.intervalSeconds)
                    }
                    .font(.callout.weight(.semibold))
                }
                .padding(.top, 8)
                Text("A reminder never starts the camera.")
                    .font(.footnote).foregroundStyle(SGStyle.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
            }
            .font(.callout.weight(.semibold))
            .foregroundStyle(SGStyle.primary)
        }
        .sgCard()
    }
}
