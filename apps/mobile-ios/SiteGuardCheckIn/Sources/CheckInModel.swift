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
    var preview: UIImage? { measurement.preview }

    private var ticker: Task<Void, Never>?
    private var sampler: Task<Void, Never>?
    private static let notificationId = "siteguard-checkin-reminder"

    init(configuration: AppConfiguration = .load(), uploader: SiteGuardUploader = UnpairedUploader()) {
        self.configuration = configuration
        self.uploader = uploader
        reminder = ReminderSchedule(intervalSeconds: configuration.reminderIntervalSeconds)
        reminder.enable(now: Date())
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                self?.tick()
            }
        }
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
        notificationsAllowed = (try? await center.requestAuthorization(options: [.alert])) ?? false
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

    func cancelConsent() {
        reminder.endCheckIn(now: Date())
        scheduleNotification()
        stage = .home
    }

    /// Starts the camera only after explicit consent for this check-in.
    func begin(consented: Bool, choices: ConsentChoices) async {
        guard consented, stage == .consent else { return }
        guard configuration.hasPresageCredentials else {
            errorMessage = "Presage is not configured in this build. See the README."
            return
        }
        collector = ReadingCollector()
        guidance = nil
        errorMessage = nil
        measurement.configure(apiKey: configuration.smartSpectraAPIKey)
        do {
            try await measurement.start()
        } catch {
            errorMessage = measurement.errorDescription?.message
                ?? "The measurement could not start. Nothing was recorded."
            return
        }
        let startedAt = Date()
        stage = .measuring(startedAt: startedAt)
        sampler = Task { [weak self] in
            while !Task.isCancelled {
                self?.sample()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func sample() {
        let latest = measurement.latestSamples()
        _ = collector.ingest(pulse: latest.pulse, breathing: latest.breathing)
        guidance = measurement.guidance ?? (collector.envelopes.isEmpty ? nil : PositioningGuidance.warmUp)
        if let error = measurement.errorDescription { errorMessage = error.message }
    }

    func finish() async {
        guard case let .measuring(startedAt) = stage else { return }
        sampler?.cancel()
        sampler = nil
        try? await measurement.stop()
        sample()
        let uploadMessage: String
        if uploader.isPaired {
            // Unreachable in this scaffold; see SiteGuardUploader.swift TODO.
            uploadMessage = "Uploaded to SiteGuard."
        } else {
            uploadMessage = UploadError.notPaired.errorDescription!
                + " Readings were kept only in this app's memory and are discarded when you leave this screen."
        }
        stage = .completed(
            CheckInResult(
                startedAt: startedAt,
                endedAt: Date(),
                readingCount: collector.envelopes.count,
                validPulseCount: collector.validPulseCount,
                validBreathingCount: collector.validBreathingCount,
                uploadMessage: uploadMessage))
        // The next optional reminder interval starts when the check-in ends.
        reminder.endCheckIn(now: Date())
        scheduleNotification()
    }

    func leaveResult() {
        collector = ReadingCollector()  // discard in-memory readings
        stage = .home
    }
}
