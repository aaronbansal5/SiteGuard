import { defineConfig, devices } from "@playwright/test";

// Isolated local demo server; never reads the developer's database or API keys.
export default defineConfig({
  testDir: ".",
  timeout: 90000,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3187",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3187/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3187",
      DATABASE_URL: "",
      SQLITE_PATH: ".data/worker-web-e2e.sqlite",
      DEMO_MODE: "true",
      HOSTED: "false",
      GEMINI_API_KEY: "",
      GEMINI_MODEL: "",
      PRESAGE_BRIDGE_TOKEN: "",
      RESEARCH_DEMO_ENABLED: "false",
      COOKIE_SECRET: "worker-web-test-cookie-secret-at-least-32-characters",
    },
  },
});
