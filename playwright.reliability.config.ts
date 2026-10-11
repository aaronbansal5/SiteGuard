import { defineConfig, devices } from "@playwright/test";

// Browser API fixtures only: no writes to the demo DB or real camera access.
export default defineConfig({
  testDir: "tests/integration",
  testMatch: "checkin-reliability.spec.ts",
  timeout: 20000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -w @siteguard/web -- --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
  },
});
