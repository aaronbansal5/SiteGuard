// Browser-camera transport cadence. The native iPhone SmartSpectra SDK owns
// its capture cadence independently; do not apply this value to iOS.
export const BROWSER_CAMERA_FPS = 15;
export const BROWSER_CAMERA_FRAME_INTERVAL_MS = 1000 / BROWSER_CAMERA_FPS;
