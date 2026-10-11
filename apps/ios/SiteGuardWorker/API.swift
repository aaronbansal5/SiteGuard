import Foundation
import Security
import CryptoKit
struct APIClient {
    var baseURL: URL
    var token: String?
    func request<T: Decodable>(_ path: String, body: [String: Any]? = nil, method: String? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent("api" + path))
        request.httpMethod = method ?? (body == nil ? "GET" : "POST")
        request.timeoutInterval = 15
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw ClientError.message("The service returned an invalid response.") }
        guard (200...299).contains(response.statusCode) else {
            let message = (try? JSONDecoder().decode(APIError.self, from: data))?.error.message ?? "Request could not be confirmed (\(response.statusCode))."
            if response.statusCode == 401 { throw ClientError.expired }
            throw ClientError.message(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
enum ClientError: LocalizedError { case message(String), expired; var errorDescription: String? { switch self { case .message(let s): return s; case .expired: return "Your session expired. Sign in again." } } }
enum SecureToken {
    static let service = "com.siteguard.worker.session"
    static func read() -> String? { var result: CFTypeRef?; let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:"bearer", kSecReturnData as String:true, kSecMatchLimit as String:kSecMatchLimitOne]; guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }; return String(data:data,encoding:.utf8) }
    static func save(_ token: String) throws { clear(); let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:"bearer", kSecValueData as String:Data(token.utf8), kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]; guard SecItemAdd(query as CFDictionary,nil) == errSecSuccess else { throw ClientError.message("Unable to securely store the session.") } }
    static func clear() { SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service] as CFDictionary) }
}
func pkceVerifier() -> String { var bytes = [UInt8](repeating:0,count:32); _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes); return Data(bytes).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
func pkceChallenge(_ verifier: String) -> String { Data(SHA256.hash(data:Data(verifier.utf8))).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
