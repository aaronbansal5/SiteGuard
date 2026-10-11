import { afterEach, expect, it, vi } from "vitest";
import { PresageSource } from "../src/measurement/presage";
import type { Config } from "../src/config";

afterEach(() => vi.unstubAllGlobals());
it.each([
  [409, "CAMERA_BUSY", "Another check-in holds the camera"],
  [503, "START_FAILED", "Presage could not start camera processing"],
  [503, "SDK_UNAVAILABLE", "Presage SDK is unavailable"],
])(
  "preserves actionable startup failure for HTTP %s / %s",
  async (status, code, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            protocolVersion: 1,
            source: "presage",
            status: "ready",
            reason: null,
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ code, message: "vendor-private-detail" }, { status }),
        ),
    );
    const source = new PresageSource({
      bridgeUrl: "http://127.0.0.1:4311",
      bridgeToken: "fixture",
      hosted: false,
    } as Config);
    await expect(source.start("test-session")).rejects.toThrow(message);
  },
);
