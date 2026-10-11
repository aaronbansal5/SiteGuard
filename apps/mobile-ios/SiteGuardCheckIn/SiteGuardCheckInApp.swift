import SwiftUI
import UIKit
import UserNotifications

final class SiteGuardAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list])
    }
}

@main
struct SiteGuardCheckInApp: App {
    @UIApplicationDelegateAdaptor(SiteGuardAppDelegate.self) private var appDelegate
    @State private var model = CheckInModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
    }
}
