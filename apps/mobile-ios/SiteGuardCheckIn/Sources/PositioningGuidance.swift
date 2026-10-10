// Fixed SiteGuard positioning guidance per SmartSpectra ValidationCode raw
// value. The Swift API reference lists `ValidationCode` cases from `ok = 0`
// through `faceNotForward = 17`; the per-code meanings and messages mirror the
// Presage bridge table (integrations/presage-bridge/src/adapters/presage-sdk.ts
// VALIDATION_GUIDANCE, codes from the Node SDK 3.4.0 declarations). The vendor
// hint text is not shown, so guidance stays consistent and non-clinical.
enum PositioningGuidance {
    static let okCode = 0
    static let generic = "Adjust position so your face is centered"
    static let warmUp = "Measuring. Readings become reliable after about 30 to 45 seconds."

    static let byCode: [Int: String] = [
        1: "Sit facing the camera so your face is visible",
        2: "Only one person should be in view",
        3: "Adjust position so your face is centered",
        4: "Adjust your distance from the camera",
        5: "Move somewhere brighter",
        6: "Avoid bright light behind you",
        7: "Sit back so your upper chest is visible",
        10: "Camera is adjusting, one moment",
        11: "Add light or close other apps",
        12: "Hold still for a moment",
        13: "Move back from the camera",
        14: "Move closer to the camera",
        15: "Move down a little",
        16: "Move up a little",
        17: "Face the camera directly",
    ]

    /// Guidance for a validation code; nil means "input is good" (ok).
    static func message(forCode code: Int) -> String? {
        code == okCode ? nil : (byCode[code] ?? generic)
    }
}
