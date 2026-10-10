import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  Explainer,
  GEMINI_TIMEOUT_MS,
  renderSelection,
  scheduleFacts,
} from "../src/insights/explain.js";
const facts = {
  pulse: ["Pulse changed by -8 bpm."],
  limits: ["Insufficient history."],
};
describe("fact-only explanations", () => {
  it("pluralizes schedule facts", () => {
    expect(
      scheduleFacts({
        assignmentCount: 1,
        gapCount: 1,
        protectedBreakCount: 1,
      }),
    ).toEqual({
      coverage: [
        "The committed proposal contains 1 assignment interval and 1 coverage gap.",
      ],
      breaks: ["1 protected break was preserved."],
    });
    expect(
      scheduleFacts({
        assignmentCount: 20,
        gapCount: 0,
        protectedBreakCount: 6,
      }),
    ).toEqual({
      coverage: [
        "The committed proposal contains 20 assignment intervals and 0 coverage gaps.",
      ],
      breaks: ["6 protected breaks were preserved."],
    });
  });
  it("has deterministic no-key fallback", async () => {
    expect(
      (
        await new Explainer(
          loadConfig({ geminiKey: undefined, geminiModel: undefined }),
        ).explain(facts, ["No clearance."])
      ).origin,
    ).toBe("deterministic");
  });
  it("renders only approved server sentences", () =>
    expect(
      renderSelection({ selections: [{ factId: "pulse", variant: 0 }] }, facts),
    ).toEqual(["Pulse changed by -8 bpm."]));
  it.each([
    { selections: [{ factId: "diagnosis", variant: 0 }] },
    { selections: [{ factId: "pulse", variant: 4 }] },
    { selections: [], diagnosis: "safe" },
  ])("rejects unsupported response", (raw) =>
    expect(() => renderSelection(raw, facts)).toThrow(),
  );
  it("falls back on service error", async () => {
    const e = new Explainer(loadConfig(), async () => {
      throw new Error("Unavailable");
    });
    expect((await e.explain(facts, [])).origin).toBe("deterministic");
  });
  it("caches accepted responses", async () => {
    const generate = vi.fn(async () => ({
      selections: [
        { factId: "pulse", variant: 0 },
        { factId: "limits", variant: 0 },
      ],
    }));
    const e = new Explainer(loadConfig(), generate);
    expect((await e.explain(facts, [])).origin).toBe("gemini");
    await e.explain(facts, []);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("times out without blocking the app", async () => {
    vi.useFakeTimers();
    try {
      const e = new Explainer(loadConfig(), () => new Promise(() => {}));
      const result = e.explain(facts, []);
      await vi.advanceTimersByTimeAsync(GEMINI_TIMEOUT_MS + 1);
      expect((await result).origin).toBe("deterministic");
    } finally {
      vi.useRealTimers();
    }
  });
});
