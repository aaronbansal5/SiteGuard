import XCTest

@testable import SiteGuardCheckIn

final class ReadingMapperTests: XCTestCase {
    private struct FixtureSample: Decodable {
        let value: Double
        let stable: Bool?
        let timestampMicros: Int64
        var sample: MetricSample { MetricSample(value: value, stable: stable, timestampMicros: timestampMicros) }
    }
    private struct FixtureCase: Decodable {
        let name: String
        let pulse: FixtureSample?
        let breathing: FixtureSample?
        let expected: [VitalReading]
    }
    private struct Fixture: Decodable { let cases: [FixtureCase] }

    /// Same file the TypeScript test checks against the contract schema and
    /// the Presage bridge (packages/contracts/src/mobile-ios-fixture.test.ts).
    private func fixture() throws -> Fixture {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/mapped-readings.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    func testSharedFixture() throws {
        let cases = try fixture().cases
        XCTAssertGreaterThan(cases.count, 5)
        for c in cases {
            XCTAssertEqual(
                ReadingMapper.normalize(pulse: c.pulse?.sample, breathing: c.breathing?.sample),
                c.expected, c.name)
        }
    }

    func testValidityComesOnlyFromStable() {
        XCTAssertEqual(ReadingMapper.quality(stable: true), .valid)
        XCTAssertEqual(ReadingMapper.quality(stable: false), .invalid)
        XCTAssertEqual(ReadingMapper.quality(stable: nil), .unknown)
        // A plausible number never upgrades validity.
        let s = MetricSample(value: 70, stable: false, timestampMicros: 1)
        XCTAssertEqual(ReadingMapper.quality(of: s), .invalid)
        // A missing or non-finite number never stays valid.
        for v in [nil, 0, -5, Double.nan, Double.infinity] as [Double?] {
            XCTAssertEqual(
                ReadingMapper.quality(of: MetricSample(value: v, stable: true, timestampMicros: 1)),
                .unknown)
        }
    }

    func testEncodesExplicitNullsAndPresageSource() throws {
        let reading = VitalReading(
            timestamp: "2026-10-10T15:00:01.000Z", heartRateBpm: 90, respiratoryRateBrpm: nil,
            quality: .valid)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(reading)) as! [String: Any]
        XCTAssertEqual(Set(object.keys), ["timestamp", "heartRateBpm", "respiratoryRateBrpm", "quality", "source"])
        XCTAssertTrue(object["respiratoryRateBrpm"] is NSNull)
        XCTAssertEqual(object["source"] as? String, "presage")
    }

    func testCollectorForwardsOnlyNewSamplesWithIncreasingSequence() {
        var c = ReadingCollector()
        let p1 = MetricSample(value: 90, stable: true, timestampMicros: 1_000_000)
        let b1 = MetricSample(value: 18, stable: true, timestampMicros: 1_000_000)
        XCTAssertEqual(c.ingest(pulse: p1, breathing: b1).map(\.sequence), [0])
        // Same samples polled again: nothing new.
        XCTAssertTrue(c.ingest(pulse: p1, breathing: b1).isEmpty)
        // Only pulse advanced.
        let p2 = MetricSample(value: 89, stable: false, timestampMicros: 2_000_000)
        let added = c.ingest(pulse: p2, breathing: b1)
        XCTAssertEqual(added.map(\.sequence), [1])
        XCTAssertNil(added[0].reading.respiratoryRateBrpm)
        XCTAssertEqual(added[0].reading.quality, .invalid)
        // Zero timestamps are ignored.
        XCTAssertTrue(c.ingest(pulse: MetricSample(value: 80, stable: true, timestampMicros: 0), breathing: nil).isEmpty)
        XCTAssertEqual(c.validPulseCount, 1)
        XCTAssertEqual(c.validBreathingCount, 1)
    }
}
