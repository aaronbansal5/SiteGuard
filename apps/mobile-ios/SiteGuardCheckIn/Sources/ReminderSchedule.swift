// Voluntary check-in reminder cycle. Same rules as the web phone layout
// (apps/web/src/lib/checkin-reminder.ts): a reminder only prompts; it never
// starts a measurement, and consent is asked on every check-in.
import Foundation

struct ReminderSchedule: Equatable {
    static let demoIntervalSeconds = 60
    static let minimumIntervalSeconds = 30
    static let maximumIntervalSeconds = 4 * 60 * 60

    enum Phase: Equatable {
        case off
        case waiting(dueAt: Date)
        case due
        case checkingIn
    }

    private(set) var intervalSeconds: Int
    private(set) var phase: Phase = .off

    init(intervalSeconds: Int = ReminderSchedule.demoIntervalSeconds) {
        self.intervalSeconds = ReminderSchedule.clamp(intervalSeconds)
    }

    static func clamp(_ seconds: Int) -> Int {
        min(maximumIntervalSeconds, max(minimumIntervalSeconds, seconds))
    }

    func remainingSeconds(now: Date) -> Int {
        guard case let .waiting(dueAt) = phase else { return 0 }
        return max(0, Int(ceil(dueAt.timeIntervalSince(now))))
    }

    mutating func enable(now: Date) {
        if phase == .off { restart(now: now) }
    }

    mutating func disable() { phase = .off }

    mutating func setInterval(_ seconds: Int, now: Date) {
        intervalSeconds = ReminderSchedule.clamp(seconds)
        switch phase {
        case .waiting, .due: restart(now: now)
        case .off, .checkingIn: break
        }
    }

    /// "Not now": wait a full interval from the dismissal.
    mutating func dismiss(now: Date) {
        switch phase {
        case .waiting, .due: restart(now: now)
        case .off, .checkingIn: break
        }
    }

    /// The consent screen or a check-in is open: no reminders meanwhile.
    mutating func beginCheckIn() {
        if phase != .off { phase = .checkingIn }
    }

    /// Completed or cancelled: the next interval starts now.
    mutating func endCheckIn(now: Date) {
        if phase == .checkingIn { restart(now: now) }
    }

    /// Returns true exactly once per cycle, when the reminder becomes due.
    mutating func tick(now: Date) -> Bool {
        guard case let .waiting(dueAt) = phase, now >= dueAt else { return false }
        phase = .due
        return true
    }

    /// When the next reminder is due, for scheduling an optional local notification.
    var dueDate: Date? {
        if case let .waiting(dueAt) = phase { return dueAt }
        return nil
    }

    private mutating func restart(now: Date) {
        phase = .waiting(dueAt: now.addingTimeInterval(TimeInterval(intervalSeconds)))
    }
}

/// mm:ss (or h:mm:ss) for countdowns.
func formatCountdown(_ totalSeconds: Int) -> String {
    let s = max(0, totalSeconds)
    let h = s / 3600, m = (s % 3600) / 60, r = s % 60
    return h > 0
        ? String(format: "%d:%02d:%02d", h, m, r)
        : String(format: "%02d:%02d", m, r)
}
