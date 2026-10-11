// Keep local developer credentials and deployment settings from changing the
// behavior of isolated tests. Individual tests set the environment values
// they need explicitly.
for (const key of [
  "AUTH_MODE",
  "AUTH_ADDITIONAL_ORIGINS",
  "HOSTED",
  "DATABASE_URL",
  "SQLITE_PATH",
  "DEMO_MODE",
  "CHECK_IN_TEST_MODE",
  "COOKIE_SECRET",
  "MEASUREMENT_TOKEN",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "PRESAGE_BRIDGE_URL",
  "PRESAGE_BRIDGE_TOKEN",
  "FALL_DETECTION_TOKEN",
  "CLIENT_IP_HEADER",
]) {
  delete process.env[key];
}
