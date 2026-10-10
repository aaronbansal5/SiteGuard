// Fixture-based tests for the real Gemini call path (SDK -> fetch). No network, no real key.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { Explainer, GEMINI_TIMEOUT_MS } from "../src/insights/explain.js";

const KEY = "fixture-gemini-key-not-real";
const MODEL = "fixture-model";
const facts = {
  pulse: ["Pulse changed by -8 bpm between windows."],
  breathing: ["Breathing rate has insufficient valid observations."],
};
const deterministic = Object.values(facts).map((v) => v[0]);

function geminiResponse(text: string, status = 200) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text }] },
          finishReason: "STOP",
        },
      ],
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}
function errorResponse(status: number) {
  return new Response(
    JSON.stringify({
      error: { code: status, message: "fixture", status: "X" },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}
function stubFetch(
  impl: (url: string, init: RequestInit) => Promise<Response>,
) {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input instanceof Request ? input.url : input), init ?? {}),
  );
  vi.stubGlobal("fetch", f);
  return f;
}
const explainer = (overrides = {}) =>
  new Explainer(
    loadConfig({ geminiKey: KEY, geminiModel: MODEL, ...overrides }),
  );
const good = JSON.stringify({
  selections: [
    { factId: "breathing", variant: 0 },
    { factId: "pulse", variant: 0 },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Gemini REST adapter (mocked fetch)", () => {
  it("sends a v1beta generateContent request with the key only in x-goog-api-key", async () => {
    const f = stubFetch(async () => geminiResponse(good));
    const e = explainer();
    const result = await e.explain(facts, ["No clearance."]);
    expect(result).toEqual({
      origin: "gemini",
      observations: [facts.breathing[0], facts.pulse[0]],
      limitations: ["No clearance."],
    });
    expect(e.lastFallbackReason).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    );
    expect(String(url)).not.toContain(KEY);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("x-goog-api-key")).toBe(KEY);
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.required).toEqual([
      "selections",
    ]);
    expect(body.contents[0].parts[0].text).toContain(facts.pulse[0]);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it.each([
    ["missing key", { geminiKey: undefined }],
    ["missing model", { geminiModel: undefined }],
  ])("%s returns deterministic without calling fetch", async (_, o) => {
    const f = stubFetch(async () => geminiResponse(good));
    const e = explainer(o);
    const result = await e.explain(facts, []);
    expect(result).toEqual({
      origin: "deterministic",
      observations: deterministic,
      limitations: [],
    });
    expect(f).not.toHaveBeenCalled();
    expect(e.lastFallbackReason).toMatch(/not set/);
  });

  it("treats blank environment values as unset", async () => {
    vi.stubEnv("GEMINI_API_KEY", "   ");
    vi.stubEnv("GEMINI_MODEL", "");
    try {
      const c = loadConfig();
      expect(c.geminiKey).toBeUndefined();
      expect(c.geminiModel).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([400, 403, 404, 429, 500, 503])(
    "HTTP %i falls back deterministically with one attempt and no key in the reason",
    async (status) => {
      const f = stubFetch(async () => errorResponse(status));
      const e = explainer();
      const result = await e.explain(facts, []);
      expect(result.origin).toBe("deterministic");
      expect(result.observations).toEqual(deterministic);
      expect(f).toHaveBeenCalledTimes(1);
      expect(e.lastFallbackReason).toBeTruthy();
      expect(e.lastFallbackReason).not.toContain(KEY);
    },
  );

  it("network failure falls back deterministically", async () => {
    stubFetch(async () => {
      throw new TypeError(`fetch failed for ${KEY}`);
    });
    const e = explainer();
    expect((await e.explain(facts, [])).origin).toBe("deterministic");
    expect(e.lastFallbackReason).not.toContain(KEY);
  });

  it.each([
    ["non-JSON text", "The worker looks fine."],
    ["empty text", ""],
    [
      "extra narrative field",
      JSON.stringify({
        selections: [
          { factId: "pulse", variant: 0 },
          { factId: "breathing", variant: 0 },
        ],
        note: "safe to work",
      }),
    ],
    [
      "unknown fact",
      JSON.stringify({
        selections: [
          { factId: "diagnosis", variant: 0 },
          { factId: "pulse", variant: 0 },
        ],
      }),
    ],
    [
      "out-of-range variant",
      JSON.stringify({
        selections: [
          { factId: "pulse", variant: 3 },
          { factId: "breathing", variant: 0 },
        ],
      }),
    ],
    [
      "duplicate fact",
      JSON.stringify({
        selections: [
          { factId: "pulse", variant: 0 },
          { factId: "pulse", variant: 0 },
        ],
      }),
    ],
    [
      "omitted fact",
      JSON.stringify({ selections: [{ factId: "pulse", variant: 0 }] }),
    ],
  ])("bad output (%s) falls back deterministically", async (_, text) => {
    stubFetch(async () => geminiResponse(text));
    const result = await explainer().explain(facts, []);
    expect(result).toEqual({
      origin: "deterministic",
      observations: deterministic,
      limitations: [],
    });
  });

  it("response with no candidates falls back deterministically", async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect((await explainer().explain(facts, [])).origin).toBe("deterministic");
  });

  it("hung request times out to the deterministic explanation", async () => {
    vi.useFakeTimers();
    stubFetch(() => new Promise<Response>(() => {}));
    const e = explainer();
    const pending = e.explain(facts, []);
    await vi.advanceTimersByTimeAsync(GEMINI_TIMEOUT_MS + 1);
    const result = await pending;
    expect(result.origin).toBe("deterministic");
    expect(e.lastFallbackReason).toMatch(/timeout|abort/i);
  });

  it("does not cache fallbacks, so a later success is used", async () => {
    let fail = true;
    stubFetch(async () => (fail ? errorResponse(503) : geminiResponse(good)));
    const e = explainer();
    expect((await e.explain(facts, [])).origin).toBe("deterministic");
    fail = false;
    expect((await e.explain(facts, [])).origin).toBe("gemini");
  });
});
