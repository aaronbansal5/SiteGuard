import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/integration",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173/api/health",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      SQLITE_PATH: ".data/e2e.sqlite",
      DATABASE_URL: "",
      SITEGUARD_ALLOW_SQLITE: "true",
      COOKIE_SECRET: "e2e-cookie-secret-at-least-thirty-two-characters",
      MEASUREMENT_TOKEN: "e2e-internal-token",
      DEMO_MODE: "true",
      HOSTED: "false",
      GEMINI_API_KEY: "",
      GEMINI_MODEL: "",
      PRESAGE_BRIDGE_TOKEN: "",
    },
  },
});
