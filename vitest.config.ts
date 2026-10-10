import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["apps/api/test/**/*.test.ts", "packages/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 15000,
  },
});
