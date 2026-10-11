// Local HTTPS upload of normalized readings only. URLSession uses the normal
// iOS trust store; no certificate bypass and no camera frames.
import Foundation
import Security

struct DeviceWorker: Decodable, Identifiable, Equatable {
    let id: String
    let displayName: String
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct DeviceCheckIn: Encodable {
    var id: String
    var startedAt: String
    var endedAt: String
    var consentVersion = "v1"
    var shareWithSupervisor: Bool
    var context: Context
    var readings: [ReadingEnvelope]
    struct Context: Encodable {
        var workload: String?
        var temperatureC: Double?
        enum CodingKeys: String, CodingKey { case workload, temperatureC }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            if let workload { try c.encode(workload, forKey: .workload) }
            else { try c.encodeNil(forKey: .workload) }
            if let temperatureC { try c.encode(temperatureC, forKey: .temperatureC) }
            else { try c.encodeNil(forKey: .temperatureC) }
        }
    }
}

private struct APIUploadFailure: Decodable {
    struct Detail: Decodable { let code: String; let message: String }
    let error: Detail
}

enum UploadError: LocalizedError {
    case notConfigured, notPaired, wrongWorker, rejected(Int, String), invalidResponse
    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Set a trusted SiteGuard HTTPS URL in this build before pairing."
        case .notPaired: return "This phone is not paired with SiteGuard. Nothing was uploaded."
        case .wrongWorker: return "That code belongs to a different worker. Select the same name on the web and phone, then get a new code."
        case .rejected(let status, let reason):
            return "SiteGuard rejected the upload (HTTP \(status)): \(reason) Nothing was confirmed."
        case .invalidResponse: return "SiteGuard returned an invalid response. Nothing was confirmed."
        }
    }
}

protocol SiteGuardUploader {
    var isPaired: Bool { get }
    var pairedWorkerId: String? { get }
    func configure(origin: URL) throws
    func workers() async throws -> [DeviceWorker]
    /// `expectedWorkerId` is nil when the server's worker list requires sign-in;
    /// the one-time code (issued to the signed-in worker) then identifies the worker.
    func pair(code: String, expectedWorkerId: String?) async throws -> PairedWorker
    func upload(_ checkIn: DeviceCheckIn) async throws -> String
}

struct PairedWorker: Equatable {
    let id: String
    let displayName: String?
}

final class LocalHTTPSUploader: SiteGuardUploader {
    private(set) var origin: URL?
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
    private let account = "local-demo-device-token"
    private let service = "com.siteguard.adaptivebreak.device"
    init(origin: URL?) { self.origin = origin?.scheme == "https" ? origin : nil }
    func configure(origin: URL) throws {
        guard origin.scheme == "https", origin.host != nil,
              origin.user == nil, origin.password == nil,
              origin.path.isEmpty || origin.path == "/",
              origin.query == nil, origin.fragment == nil else { throw UploadError.notConfigured }
        self.origin = origin
    }

    private var storedPairing: (workerId: String, token: String)? {
        guard let origin else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let stored = String(data: data, encoding: .utf8) else { return nil }
        let parts = stored.split(separator: "|", maxSplits: 2).map(String.init)
        guard parts.count == 3, parts[0] == origin.absoluteString else { return nil }
        return (parts[1], parts[2])
    }
    private var token: String? { storedPairing?.token }
    var pairedWorkerId: String? { storedPairing?.workerId }
    var isPaired: Bool { token != nil }

    private func request<T: Encodable>(path: String, body: T, bearer: String? = nil) async throws -> Data {
        guard let origin else { throw UploadError.notConfigured }
        var request = URLRequest(url: origin.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw UploadError.invalidResponse }
        if response.statusCode == 401 && bearer != nil { throw UploadError.notPaired }
        guard response.statusCode == 201 else {
            let detail = try? JSONDecoder().decode(APIUploadFailure.self, from: data).error
            // The API provides fixed public errors. Never echo an arbitrary HTML
            // proxy response or request body into the worker's result screen.
            let reason = detail.map { "\($0.code) — \($0.message)." } ?? "Check the desktop connection."
            throw UploadError.rejected(response.statusCode, reason)
        }
        return data
    }

    func workers() async throws -> [DeviceWorker] {
        struct Reply: Decodable { let workers: [DeviceWorker] }
        guard let origin else { throw UploadError.notConfigured }
        var request = URLRequest(url: origin.appending(path: "api/workers"))
        request.timeoutInterval = 15
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw UploadError.invalidResponse }
        // Account-mode servers keep the roster private; pairing then relies on the code alone.
        if response.statusCode == 401 { return [] }
        guard response.statusCode == 200 else { throw UploadError.invalidResponse }
        return try JSONDecoder().decode(Reply.self, from: data).workers
    }

    func pair(code: String, expectedWorkerId: String?) async throws -> PairedWorker {
        struct Body: Encodable { let code: String }
        struct Reply: Decodable { let deviceToken: String; let workerId: String; let displayName: String? }
        let data = try await request(path: "api/devices/pair", body: Body(code: code.uppercased()))
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        if let expectedWorkerId, reply.workerId != expectedWorkerId { throw UploadError.wrongWorker }
        guard let origin, reply.deviceToken.count == 43 else { throw UploadError.invalidResponse }
        let value = Data("\(origin.absoluteString)|\(reply.workerId)|\(reply.deviceToken)".utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = value
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw UploadError.invalidResponse }
        return PairedWorker(id: reply.workerId, displayName: reply.displayName)
    }

    func upload(_ checkIn: DeviceCheckIn) async throws -> String {
        guard let token else { throw UploadError.notPaired }
        struct Reply: Decodable { let session: Session }
        struct Session: Decodable { let id: String }
        let data = try await request(path: "api/device/check-ins", body: checkIn, bearer: token)
        return try JSONDecoder().decode(Reply.self, from: data).session.id
    }
}
