import SwiftUI

@main
struct SiteGuardCheckInApp: App {
    @State private var model = CheckInModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
    }
}
