// Presage needs roughly 25 fps for physiology inference. The native iPhone
// SmartSpectra SDK owns its capture cadence independently; do not apply this
// value to iOS.
export const BROWSER_CAMERA_FPS = 25;
export const BROWSER_CAMERA_FRAME_INTERVAL_MS = 1000 / BROWSER_CAMERA_FPS;
// The Presage bridge accepts JPEG frames up to 960 pixels on either edge.
// Preserve as much facial detail as it can process instead of needlessly
// reducing browser frames to 640 pixels before contactless pulse inference.
export const BROWSER_CAMERA_MAX_DIMENSION = 960;
export const BROWSER_CAMERA_IDEAL_WIDTH = 1280;
export const BROWSER_CAMERA_IDEAL_HEIGHT = 720;
