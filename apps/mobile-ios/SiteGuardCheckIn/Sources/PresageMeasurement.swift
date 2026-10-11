// The only file that touches the SmartSpectra Swift SDK.
//
// Every SDK symbol used here is taken from the official docs (fetched
// 2026-10-10); physical-iOS arm64 build passed with Xcode 27.
//   - SmartSpectraSDK.shared, start() async throws, stop() async throws,
//     metrics, imageOutput, processingStatus (.running), error
//     (SmartSpectraError: code, message, retryable), validationStatus
//     (ValidationStatus: code, hint)          -> docs/swift/api-reference.md
//   - config.apiKey, config.requestedMetrics, config.enableTelemetry,
//     config.imageOutputEnabled, useCamera(.front)
//                                             -> docs/swift/api-reference.md
//   - SmartSpectraConfig.breathingMetrics + [.pulseRate];
//     metrics.cardio.pulseRate.last / metrics.breathing.rate.last
//                                             -> docs/swift/metrics.md
//   - sample .value (Float) and .timestamp (Int64 microseconds)
//                                             -> docs/swift/use-case-examples.md
//                                                (Metrics Data Export) and
//                                                docs/data-types.md
//   - sample .confidence is read by the official sample
//                                             -> docs/swift/option-1-api-key.md
//   - sample .stable (bool, "stable/reliable") -> docs/data-types.md
//                                                (MeasurementWithConfidence)
//   - SmartSpectraSDK.shared is observable; outside SwiftUI use
//     withObservationTracking               -> docs/swift/headless-mode.md
// SDK metric payloads contain samples since the previous update; observing
// every payload prevents a one-second poll from dropping intervening samples.
import AVFoundation
import Observation
import SmartSpectra
import UIKit

@MainActor
final class PresageMeasurement {
    private let sdk = SmartSpectraSDK.shared
    private var observationId = 0

    /// Configure before every start. When PresageService-Info.plist is
    /// bundled, OAuth takes precedence and the API key is ignored
    /// (docs/swift/option-2-oauth.md), so the key is only set when present.
    func configure(apiKey: String?) throws {
        sdk.config.apiKey = apiKey ?? ""
        // Pulse and breathing only: no face, expression, EDA or HRV metrics.
        sdk.config.requestedMetrics = SmartSpectraConfig.breathingMetrics + [.pulseRate]
        // Telemetry defaults to true; SiteGuard turns it off (as the bridge does).
        sdk.config.enableTelemetry = false
        // Live preview for positioning only. Frames are never stored or sent.
        sdk.config.imageOutputEnabled = true
        // SmartSpectra owns the native iPhone capture cadence. The browser
        // camera uses its own 15 FPS transport cadence; do not apply that web
        // setting here because no documented SDK frame-rate control exists.
        try sdk.useCamera(.front)
    }

    func start() async throws { try await sdk.start() }
    func stop() async throws {
        stopObservingMetrics()
        defer { sdk.config.apiKey = "" }
        try await sdk.stop()
    }

    var preview: UIImage? { sdk.imageOutput }
    var isRunning: Bool { sdk.processingStatus == .running }

    /// All samples in the current SDK update, reduced to documented fields.
    func currentSamples() -> (pulse: [MetricSample], breathing: [MetricSample]) {
        guard let metrics = sdk.metrics else { return ([], []) }
        let pulse = metrics.cardio.pulseRate.map {
            MetricSample(value: Double($0.value), stable: $0.stable, timestampMicros: Int64($0.timestamp))
        }
        let breathing = metrics.breathing.rate.map {
            MetricSample(value: Double($0.value), stable: $0.stable, timestampMicros: Int64($0.timestamp))
        }
        return (pulse, breathing)
    }

    /// Re-arm one-shot Observation tracking after each SDK metrics change.
    func observeMetrics(_ receive: @escaping @MainActor ([MetricSample], [MetricSample]) -> Void) {
        observationId &+= 1
        observeMetrics(id: observationId, receive: receive)
    }

    func stopObservingMetrics() { observationId &+= 1 }

    private func observeMetrics(
        id: Int,
        receive: @escaping @MainActor ([MetricSample], [MetricSample]) -> Void
    ) {
        guard id == observationId else { return }
        let metrics = withObservationTracking {
            sdk.metrics
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                self?.observeMetrics(id: id, receive: receive)
            }
        }
        guard id == observationId, let metrics else { return }
        let pulse = metrics.cardio.pulseRate.map {
            MetricSample(value: Double($0.value), stable: $0.stable, timestampMicros: Int64($0.timestamp))
        }
        let breathing = metrics.breathing.rate.map {
            MetricSample(value: Double($0.value), stable: $0.stable, timestampMicros: Int64($0.timestamp))
        }
        receive(pulse, breathing)
    }

    /// SiteGuard guidance for the current validation code (nil when ok).
    var guidance: String? {
        guard let status = sdk.validationStatus else { return nil }
        return PositioningGuidance.message(forCode: Int(status.code.rawValue))
    }

    /// Worker-facing error text; never claims anything about the worker.
    var errorDescription: (message: String, retryable: Bool)? {
        guard let error = sdk.error else { return nil }
        let message: String
        switch error.code {
        case .authenticationFailed:
            message = "Presage could not verify this app's key. No measurement was taken."
        case .creditExhausted:
            message = "The Presage measurement allowance is used up. No measurement was taken."
        case .networkError:
            message = "Presage needs an internet connection to verify the app. Check your connection."
        case .inputUnavailable:
            message = "The camera is unavailable. Check camera permission in Settings."
        default:
            message = "The measurement stopped (\(error.message))."
        }
        return (message, error.retryable)
    }
}
