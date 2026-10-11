import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

afterEach(() => vi.unstubAllEnvs());

describe("explicit synthetic research demo configuration", () => {
  it.each([
    [undefined, undefined, false],
    [undefined, "true", false],
    ["true", undefined, false],
    ["true", "false", false],
    ["true", "1", false],
    ["false", "true", false],
    ["true", "true", true],
  ] as const)(
    "DEMO_MODE=%s and RESEARCH_DEMO_ENABLED=%s gives %s",
    (demo, research, expected) => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("DEMO_MODE", demo);
      vi.stubEnv("RESEARCH_DEMO_ENABLED", research);
      expect(loadConfig().researchDemoEnabled).toBe(expected);
    },
  );

  it("blocks production even with both environment flags or config overrides", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("RESEARCH_DEMO_ENABLED", "true");
    expect(loadConfig().researchDemoEnabled).toBe(false);
    expect(
      loadConfig({ demoMode: true, researchDemoEnabled: true })
        .researchDemoEnabled,
    ).toBe(false);
  });

  it("blocks an opt-in overridden into non-demo mode", () => {
    expect(
      loadConfig({ demoMode: false, researchDemoEnabled: true })
        .researchDemoEnabled,
    ).toBe(false);
  });

  it("keeps the Presage theory-demo override opt-in and non-production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("RESEARCH_DEMO_ENABLED", "true");
    vi.stubEnv("RESEARCH_DEMO_ALLOW_PRESAGE", "true");
    expect(loadConfig().researchDemoAllowPresage).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(loadConfig().researchDemoAllowPresage).toBe(false);
  });
});
