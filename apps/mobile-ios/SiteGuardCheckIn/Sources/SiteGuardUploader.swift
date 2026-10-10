// Network layer to the SiteGuard API.
//
// TODO(docs/MOBILE_APP.md "Proposed phone ingestion contract"): NOT IMPLEMENTED.
// The SiteGuard API ingests real (source=presage) readings only through the
// local Presage bridge, and rejects source=presage in hosted mode. That rule
// is intentionally unchanged. Until the API ships per-device pairing tokens
// over TLS with fixed-source sessions and per-session consent, this app
// uploads nothing: readings stay in memory for the current check-in only and
// are discarded when the worker leaves the result screen.
import Foundation

/// Session start request proposed for the phone path (mirrors POST /api/sessions
/// plus the device-specific fields in docs/MOBILE_APP.md).
struct DeviceSessionStart: Encodable {
    var breakId: String
    var source = "presage"
    var consentVersion = "v1"
    var shareWithSupervisor: Bool
    var context: Context
    struct Context: Encodable {
        var workload: String?
        var temperatureC: Double?
    }
}

enum UploadError: LocalizedError, Equatable {
    case notPaired
    var errorDescription: String? {
        switch self {
        case .notPaired:
            return "This app is not connected to SiteGuard yet. Nothing was uploaded."
        }
    }
}

protocol SiteGuardUploader {
    var isPaired: Bool { get }
    func startSession(_ request: DeviceSessionStart) async throws -> String
    func upload(sessionId: String, readings: [ReadingEnvelope]) async throws
    func complete(sessionId: String) async throws
}

/// The only uploader in this scaffold. Every call fails closed.
struct UnpairedUploader: SiteGuardUploader {
    let isPaired = false
    func startSession(_ request: DeviceSessionStart) async throws -> String {
        throw UploadError.notPaired
    }
    func upload(sessionId: String, readings: [ReadingEnvelope]) async throws {
        throw UploadError.notPaired
    }
    func complete(sessionId: String) async throws { throw UploadError.notPaired }
}
