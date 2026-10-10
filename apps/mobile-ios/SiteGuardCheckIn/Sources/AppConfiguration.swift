// Build-time configuration read from Info.plist. Values come from
// Config/Secrets.xcconfig (untracked) through $(VARIABLE) substitution; no
// secret is written in source. See apps/mobile-ios/README.md.
import Foundation

struct AppConfiguration {
    /// SmartSpectra API key for local development builds only. A key in
    /// Info.plist still ships inside the app bundle, so builds given to anyone
    /// else must use OAuth (PresageService-Info.plist) instead.
    let smartSpectraAPIKey: String?
    /// True when the Presage OAuth config file is bundled
    /// (docs/swift/option-2-oauth.md: PresageService-Info.plist).
    let usesOAuth: Bool
    /// Reminder interval; 60 s demo default, configurable in the app.
    let reminderIntervalSeconds: Int
    let demoMode: Bool
    /// Optional SiteGuard web origin for the in-app support link (/mobile).
    let siteGuardWebURL: URL?
    /// Data-sufficiency guide for real Presage (packages/contracts
    /// RECOMMENDED_CHECK_IN_SECONDS.presage), not a clinical rest time.
    let recommendedCheckInSeconds = 90

    var hasPresageCredentials: Bool { usesOAuth || smartSpectraAPIKey != nil }

    static func load(bundle: Bundle = .main) -> AppConfiguration {
        func string(_ key: String) -> String? {
            guard let raw = bundle.object(forInfoDictionaryKey: key) as? String else { return nil }
            let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            // An unset build setting leaves "" or the literal "$(NAME)".
            return value.isEmpty || value.hasPrefix("$(") ? nil : value
        }
        let demo = string("SITEGUARD_DEMO_MODE").map { $0.lowercased() != "false" } ?? true
        let interval = string("SITEGUARD_CHECKIN_INTERVAL_SECONDS").flatMap(Int.init)
        let web = string("SITEGUARD_WEB_URL").flatMap(URL.init(string:))
        return AppConfiguration(
            smartSpectraAPIKey: string("SMARTSPECTRA_API_KEY"),
            usesOAuth: bundle.url(forResource: "PresageService-Info", withExtension: "plist") != nil,
            reminderIntervalSeconds: ReminderSchedule.clamp(
                interval ?? ReminderSchedule.demoIntervalSeconds),
            demoMode: demo,
            // Opened in Safari as a link only; no data is sent by this app.
            siteGuardWebURL: ["https", "http"].contains(web?.scheme ?? "") ? web : nil
        )
    }
}
