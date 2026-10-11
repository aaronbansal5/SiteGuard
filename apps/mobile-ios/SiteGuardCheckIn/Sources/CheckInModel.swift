// Check-in flow: reminder -> consent (every time) -> measuring -> result.
// The reminder never starts the camera; only the worker's explicit consent
// and "Begin" tap do. Readings live in memory for the current check-in only.
import Foundation
import Observation
import UIKit
import UserNotifications

struct CheckInResult: Equatable {
    var startedAt: Date
    var endedAt: Date
    var readingCount: Int
    var validPulseCount: Int
    var validBreathingCount: Int
    var uploadMessage: String
}

struct ConsentChoices: Equatable {
    var uploadToSiteGuard = false
    var shareWithSupervisor = false
    var workload: String? = nil
    var temperatureC: Double? = nil
}

@MainActor
@Observable
final class CheckInModel {
    enum Stage: Equatable {
        case home
        case consent
        case measuring(startedAt: Date)
        case completed(CheckInResult)
    }

    let configuration: AppConfiguration
    private let uploader: SiteGuardUploader
    private let measurement = PresageMeasurement()

    private(set) var stage: Stage = .home
    private(set) var reminder: ReminderSchedule
    private(set) var now = Date()
    private(set) var reminderPrompt = false
    private(set) var collector = ReadingCollector()
    private(set) var guidance: String?
    private(set) var errorMessage: String?
    private(set) var notificationsAllowed = false
    private(set) var notificationStatusMessage: String?
    private(set) var preview: UIImage?
    private(set) var pulseRateBpm: Double?
    private(set) var breathingRateBrpm: Double?
    private(set) var pairingMessage: String?
    private(set) var hasSavedPresageKey = false
    var pairedWorkerId: String? { uploader.pairedWorkerId }
    private(set) var pairedWorkerName = UserDefaults.standard.string(forKey: "siteguard-paired-worker-name")
    private(set) var serverURLText: String
    private(set) var availableWorkers: [DeviceWorker] = []
    /// True when the server keeps its worker list behind sign-in; the pairing code identifies the worker.
    private(set) var rosterRequiresSignIn = false
    private(set) var canRetryUpload = false
    private(set) var isFinishing = false
    var isPaired: Bool { uploader.isPaired }

    private var ticker: Task<Void, Never>?
    private var sampler: Task<Void, Never>?
    private var previewUpdater: Task<Void, Never>?
    private var currentChoices = ConsentChoices()
    private var pendingUpload: DeviceCheckIn?
    private static let notificationId = "siteguard-checkin-reminder"
    private static let notificationOptInKey = "siteguard-checkin-notification-opt-in"

    init(configuration: AppConfiguration = .load(), uploader: SiteGuardUploader? = nil) {
        self.configuration = configuration
        let saved = UserDefaults.standard.string(forKey: "siteguard-device-origin")
        let address = saved ?? configuration.siteGuardWebURL?.absoluteString ?? ""
        self.serverURLText = address
        self.uploader = uploader ?? LocalHTTPSUploader(origin: URL(string: address))
        self.hasSavedPresageKey = PresageKeyStore.load() != nil
        reminder = ReminderSchedule(intervalSeconds: configuration.reminderIntervalSeconds)
        reminder.enable(now: Date())
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                self?.tick()
            }
        }
        Task { [weak self] in await self?.restoreNotificationPermission() }
    }

    private func tick() {
        now = Date()
        if reminder.tick(now: now) { reminderPrompt = true }
    }

    // MARK: Reminder settings

    func setReminderInterval(_ seconds: Int) {
        reminder.setInterval(seconds, now: Date())
        reminderPrompt = false
        scheduleNotification()
    }

    func setRemindersEnabled(_ enabled: Bool) {
        if enabled { reminder.enable(now: Date()) } else { reminder.disable() }
        reminderPrompt = false
        scheduleNotification()
    }

    func dismissReminder() {
        reminder.dismiss(now: Date())
        reminderPrompt = false
        scheduleNotification()
    }

    /// Asked only from an explicit button. Notifications say only that an
    /// optional check-in is available; they never start a measurement.
    func requestNotificationPermission() async {
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert])
        let settings = await center.notificationSettings()
        notificationsAllowed = settings.authorizationStatus == .authorized
            && settings.alertSetting == .enabled
        UserDefaults.standard.set(notificationsAllowed, forKey: Self.notificationOptInKey)
        notificationStatusMessage = notificationsAllowed ? nil
            : "Notifications are off. Enable alerts in iPhone Settings → SiteGuard → Notifications."
        scheduleNotification()
    }

    private func restoreNotificationPermission() async {
        guard UserDefaults.standard.bool(forKey: Self.notificationOptInKey) else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationsAllowed = settings.authorizationStatus == .authorized
            && settings.alertSetting == .enabled
        notificationStatusMessage = notificationsAllowed ? nil
            : "Notifications are off. Enable alerts in iPhone Settings → SiteGuard → Notifications."
        scheduleNotification()
    }

    private func scheduleNotification() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.notificationId])
        guard notificationsAllowed, let due = reminder.dueDate else { return }
        let content = UNMutableNotificationContent()
        content.title = "SiteGuard check-in available"
        content.body = "Optional. Open SiteGuard if you would like to check in. Skipping changes nothing."
        let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: max(1, due.timeIntervalSinceNow), repeats: false)
        center.add(UNNotificationRequest(identifier: Self.notificationId, content: content, trigger: trigger))
    }

    // MARK: Check-in flow

    func openConsent() {
        reminder.beginCheckIn()
        reminderPrompt = false
        errorMessage = nil
        scheduleNotification()
        stage = .consent
    }

    func loadWorkers(serverURL: String) async {
        do {
            guard let origin = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines))
            else { throw UploadError.notConfigured }
            try uploader.configure(origin: origin)
            availableWorkers = try await uploader.workers()
            rosterRequiresSignIn = availableWorkers.isEmpty
            pairingMessage = rosterRequiresSignIn
                ? "Connected. Sign in on the SiteGuard website, get a one-time code, and enter it below."
                : nil
        } catch {
            availableWorkers = []
            rosterRequiresSignIn = false
            pairingMessage = error.localizedDescription
        }
    }

    func pair(code: String, serverURL: String, selectedWorkerId: String) async {
        do {
            if !rosterRequiresSignIn {
                guard availableWorkers.contains(where: { $0.id == selectedWorkerId }) else {
                    throw UploadError.wrongWorker
                }
            }
            guard let origin = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines))
            else { throw UploadError.notConfigured }
            try uploader.configure(origin: origin)
            let worker = try await uploader.pair(
                code: code.trimmingCharacters(in: .whitespacesAndNewlines),
                expectedWorkerId: rosterRequiresSignIn ? nil : selectedWorkerId)
            serverURLText = origin.absoluteString
            UserDefaults.standard.set(serverURLText, forKey: "siteguard-device-origin")
            pairedWorkerName = worker.displayName
                ?? availableWorkers.first(where: { $0.id == worker.id })?.displayName
            UserDefaults.standard.set(pairedWorkerName, forKey: "siteguard-paired-worker-name")
            pairingMessage = "Paired to \(pairedWorkerName ?? "your account"). Upload remains optional for every check-in."
        } catch {
            pairingMessage = error.localizedDescription
        }
    }

    func cancelConsent() {
        reminder.endCheckIn(now: Date())
        scheduleNotification()
        stage = .home
    }

    func forgetPresageKey() {
        PresageKeyStore.delete()
        hasSavedPresageKey = false
    }

    /// Starts the camera only after explicit consent for this check-in.
    func begin(consented: Bool, choices: ConsentChoices, enteredPresageKey: String? = nil,
               rememberPresageKey: Bool = false) async {
        guard consented, stage == .consent else { return }
        let localKey = enteredPresageKey?.trimmingCharacters(in: .whitespacesAndNewlines)
        let enteredKey = localKey?.isEmpty == false ? localKey : nil
        let key = configuration.smartSpectraAPIKey ?? enteredKey ?? PresageKeyStore.load()
        guard configuration.usesOAuth || key != nil else {
            errorMessage = "Enter a Presage API key to start this check-in."
            return
        }
        collector = ReadingCollector()
        currentChoices = choices
        pendingUpload = nil
        canRetryUpload = false
        isFinishing = false
        preview = nil
        pulseRateBpm = nil
        breathingRateBrpm = nil
        guidance = nil
        errorMessage = nil
        let startedAt = Date()
        do {
            try measurement.configure(apiKey: key)
            try await measurement.start()
        } catch {
            errorMessage = measurement.errorDescription?.message
                ?? "The measurement could not start. Nothing was recorded."
            try? await measurement.stop()
            return
        }
        // Store only a key the worker typed for this check-in, and only after
        // Presage accepted startup. A failed camera start does not overwrite
        // a previously working key.
        if let enteredKey {
            if rememberPresageKey {
                hasSavedPresageKey = PresageKeyStore.save(enteredKey)
                if !hasSavedPresageKey {
                    errorMessage = "The key could not be saved on this phone; this check-in can continue."
                }
            } else if hasSavedPresageKey {
                forgetPresageKey()
            }
        }
        stage = .measuring(startedAt: startedAt)
        measurement.observeMetrics { [weak self] pulses, breathings in
            self?.ingest(pulses: pulses, breathings: breathings)
        }
        // SmartSpectra owns the camera, as the desktop SDK does. Copy only its
        // latest in-memory preview into observable UI state; never save frames.
        previewUpdater = Task { [weak self] in
            while !Task.isCancelled {
                if let image = self?.measurement.preview, self?.preview !== image {
                    self?.preview = image
                }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        sampler = Task { [weak self] in
            while !Task.isCancelled {
                self?.refreshStatus()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func ingest(pulses: [MetricSample], breathings: [MetricSample]) {
        let added = collector.ingest(pulses: pulses, breathings: breathings)
        for envelope in added {
            if let pulse = envelope.reading.heartRateBpm {
                pulseRateBpm = envelope.reading.quality == .valid ? pulse : nil
            }
            if let breathing = envelope.reading.respiratoryRateBrpm {
                breathingRateBrpm = envelope.reading.quality == .valid ? breathing : nil
            }
        }
        refreshStatus()
    }

    private func refreshStatus() {
        guidance = measurement.guidance ?? (collector.envelopes.isEmpty ? nil : PositioningGuidance.warmUp)
        if let error = measurement.errorDescription { errorMessage = error.message }
    }

    func finish() async {
        guard case let .measuring(startedAt) = stage, !isFinishing else { return }
        isFinishing = true
        defer { isFinishing = false }
        sampler?.cancel()
        sampler = nil
        previewUpdater?.cancel()
        previewUpdater = nil
        measurement.stopObservingMetrics()
        let finalSamples = measurement.currentSamples()
        ingest(pulses: finalSamples.pulse, breathings: finalSamples.breathing)
        try? await measurement.stop()
        refreshStatus()
        preview = nil
        let endedAt = Date()
        var uploadMessage = "Not uploaded. Readings stay on this result screen only and are discarded when you leave."
        if currentChoices.uploadToSiteGuard && uploader.isPaired && !collector.envelopes.isEmpty {
            let timestamp: (Date) -> String = { date in
                ReadingMapper.isoTimestamp(micros: Int64(date.timeIntervalSince1970 * 1_000_000))
            }
            let checkIn = DeviceCheckIn(
                id: UUID().uuidString.lowercased(),
                startedAt: timestamp(startedAt), endedAt: timestamp(endedAt),
                shareWithSupervisor: currentChoices.shareWithSupervisor,
                context: .init(workload: currentChoices.workload,
                               temperatureC: currentChoices.temperatureC),
                readings: collector.envelopes)
            pendingUpload = checkIn
            do {
                let id = try await uploader.upload(checkIn)
                pendingUpload = nil
                uploadMessage = "Uploaded to SiteGuard. Desktop session: \(id)."
            } catch {
                uploadMessage = "Upload not confirmed: \(error.localizedDescription) Retry before leaving this screen."
            }
        }
        canRetryUpload = pendingUpload != nil
        stage = .completed(
            CheckInResult(
                startedAt: startedAt,
                endedAt: endedAt,
                readingCount: collector.envelopes.count,
                validPulseCount: collector.validPulseCount,
                validBreathingCount: collector.validBreathingCount,
                uploadMessage: uploadMessage))
        // The next optional reminder interval starts when the check-in ends.
        reminder.endCheckIn(now: Date())
        scheduleNotification()
    }

    func retryUpload() async {
        guard let checkIn = pendingUpload,
              case .completed(var result) = stage else { return }
        do {
            let id = try await uploader.upload(checkIn)
            pendingUpload = nil
            canRetryUpload = false
            result.uploadMessage = "Uploaded to SiteGuard. Desktop session: \(id)."
        } catch {
            result.uploadMessage = "Upload not confirmed: \(error.localizedDescription) Retry before leaving this screen."
        }
        stage = .completed(result)
    }

    /// Camera use ends when the worker leaves the app during a check-in.
    func stopForBackground() async {
        if case .measuring = stage { await finish() }
    }

    func leaveResult() {
        pendingUpload = nil
        canRetryUpload = false
        collector = ReadingCollector()  // discard in-memory readings
        pulseRateBpm = nil
        breathingRateBrpm = nil
        stage = .home
    }
}
