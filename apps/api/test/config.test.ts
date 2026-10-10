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
