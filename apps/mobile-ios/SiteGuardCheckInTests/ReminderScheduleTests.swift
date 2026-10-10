import XCTest

@testable import SiteGuardCheckIn

final class ReminderScheduleTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_791_644_400)

    func testDemoDefaultIsSixtySecondsAndDueExactlyOnce() {
        var r = ReminderSchedule()
        XCTAssertEqual(r.intervalSeconds, 60)
        XCTAssertEqual(r.phase, .off)
        XCTAssertFalse(r.tick(now: t0.addingTimeInterval(600)))
        r.enable(now: t0)
        XCTAssertEqual(r.remainingSeconds(now: t0), 60)
        XCTAssertEqual(r.remainingSeconds(now: t0.addingTimeInterval(30)), 30)
        XCTAssertFalse(r.tick(now: t0.addingTimeInterval(59)))
        XCTAssertTrue(r.tick(now: t0.addingTimeInterval(60)))
        XCTAssertEqual(r.phase, .due)
        XCTAssertFalse(r.tick(now: t0.addingTimeInterval(600)))
    }

    func testDismissRestartsFullInterval() {
        var r = ReminderSchedule()
        r.enable(now: t0)
        _ = r.tick(now: t0.addingTimeInterval(60))
        r.dismiss(now: t0.addingTimeInterval(75))
        XCTAssertEqual(r.remainingSeconds(now: t0.addingTimeInterval(75)), 60)
        XCTAssertFalse(r.tick(now: t0.addingTimeInterval(134)))
        XCTAssertTrue(r.tick(now: t0.addingTimeInterval(135)))
    }

    func testCheckInPausesAndRestartsOnEnd() {
        var r = ReminderSchedule()
        r.enable(now: t0)
        r.beginCheckIn()
        XCTAssertEqual(r.phase, .checkingIn)
        XCTAssertNil(r.dueDate)
        XCTAssertFalse(r.tick(now: t0.addingTimeInterval(1000)))
        r.endCheckIn(now: t0.addingTimeInterval(1000))
        XCTAssertEqual(r.remainingSeconds(now: t0.addingTimeInterval(1000)), 60)
    }

    func testIntervalClampAndOff() {
        var r = ReminderSchedule(intervalSeconds: 5)
        XCTAssertEqual(r.intervalSeconds, ReminderSchedule.minimumIntervalSeconds)
        r.enable(now: t0)
        r.setInterval(90, now: t0.addingTimeInterval(10))
        XCTAssertEqual(r.remainingSeconds(now: t0.addingTimeInterval(10)), 90)
        r.setInterval(1_000_000, now: t0)
        XCTAssertEqual(r.intervalSeconds, ReminderSchedule.maximumIntervalSeconds)
        r.disable()
        r.beginCheckIn()
        r.endCheckIn(now: t0)
        XCTAssertEqual(r.phase, .off)
    }

    func testCountdownFormat() {
        XCTAssertEqual(formatCountdown(60), "01:00")
        XCTAssertEqual(formatCountdown(-1), "00:00")
        XCTAssertEqual(formatCountdown(3725), "1:02:05")
    }

    func testPositioningGuidance() {
        XCTAssertNil(PositioningGuidance.message(forCode: 0))
        XCTAssertEqual(PositioningGuidance.message(forCode: 12), "Hold still for a moment")
        XCTAssertEqual(PositioningGuidance.message(forCode: 99), PositioningGuidance.generic)
    }
}
