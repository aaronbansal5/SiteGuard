import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
describe("bridge configuration boundary", () => {
  it.each([
    "https://127.0.0.1:4311",
    "http://example.com",
    "http://localhost:4311",
    "http://127.0.0.1:4311/proxy",
    "http://token@127.0.0.1:4311",
    "http://127.0.0.1:4311?token=secret",
  ])("rejects unsafe bridge origin %s", (bridgeUrl) => {
    expect(() => loadConfig({ bridgeUrl })).toThrow("loopback");
  });
  it("accepts literal IPv4 and IPv6 loopback origins", () => {
    expect(loadConfig({ bridgeUrl: "http://127.0.0.1:4311" }).bridgeUrl).toBe(
      "http://127.0.0.1:4311",
    );
    expect(loadConfig({ bridgeUrl: "http://[::1]:4311" }).bridgeUrl).toBe(
      "http://[::1]:4311",
    );
  });
});
describe("hosted secrets", () => {
  it("accepts secrets supplied through config overrides", () => {
    expect(() =>
      loadConfig({
        hosted: true,
        cookieSecret: "c".repeat(32),
        measurementToken: "m".repeat(16),
      }),
    ).not.toThrow();
  });
  it("still requires secrets in hosted mode", () => {
    const saved = [process.env.COOKIE_SECRET, process.env.MEASUREMENT_TOKEN];
    delete process.env.COOKIE_SECRET;
    delete process.env.MEASUREMENT_TOKEN;
    try {
      expect(() => loadConfig({ hosted: true })).toThrow(
        "Hosted mode requires",
      );
    } finally {
      if (saved[0] !== undefined) process.env.COOKIE_SECRET = saved[0];
      if (saved[1] !== undefined) process.env.MEASUREMENT_TOKEN = saved[1];
    }
  });
});
