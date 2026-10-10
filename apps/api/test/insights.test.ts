import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { Explainer, renderSelection } from "../src/insights/explain.js";
const facts = {
  pulse: ["Pulse changed by -8 bpm."],
  limits: ["Insufficient history."],
};
describe("fact-only explanations", () => {
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
      await vi.advanceTimersByTimeAsync(5001);
      expect((await result).origin).toBe("deterministic");
    } finally {
      vi.useRealTimers();
    }
  });
});
