import Foundation
struct Identity: Codable { let role: String; let workerId: String? }
struct AuthConfig: Decodable { let mode: String; let loginAvailable: Bool; let siteId: String }
struct IdentityResponse: Decodable { let identity: Identity? }
struct Worker: Decodable, Identifiable { let id: String; let displayName: String }
struct WorkersResponse: Decodable { let workers: [Worker] }
struct ProtectedBreak: Decodable, Identifiable { let id: String; let startsAt: String; let endsAt: String; let kind: String }
struct BreaksResponse: Decodable { let breaks: [ProtectedBreak] }
struct Context: Codable { let workload: String?; let temperatureC: Double? }
struct Session: Decodable, Identifiable { let id: String; let source: String; let status: String; let startedAt: String; let context: Context; let summary: Summary? }
struct SessionResponse: Decodable { let session: Session }
struct HistoryResponse: Decodable { let sessions: [Session] }
struct Metric: Decodable { let status: String; let initialMedian: Double?; let finalMedian: Double?; let delta: Double?; let initialCount: Int; let finalCount: Int }
struct Summary: Decodable { let sessionId: String; let source: String; let durationSeconds: Double; let pulse: Metric; let breathing: Metric; let limitations: [String] }
struct SummaryResponse: Decodable { let summary: Summary }
struct Reading: Decodable { let timestamp: String; let heartRateBpm: Double?; let respiratoryRateBrpm: Double?; let quality: String; let source: String }
struct ReadingEnvelope: Decodable, Identifiable { let sequence: Int; let reading: Reading; var id: Int { sequence } }
struct ReadingsResponse: Decodable { let readings: [ReadingEnvelope] }
struct EmptyResponse: Decodable {}
struct ExchangeResponse: Decodable { let token: String; let expiresAt: String }
struct APIError: Decodable { struct Detail: Decodable { let message: String }; let error: Detail }
func parseDate(_ string: String) -> Date? { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f.date(from: string) ?? ISO8601DateFormatter().date(from: string) }
func displayValue(_ value: Double?) -> String { value.map { String(format: "%.1f", $0) } ?? "Unavailable" }
