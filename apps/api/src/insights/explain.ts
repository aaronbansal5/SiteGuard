import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type {
  Summary,
  Explanation,
  RestRecommendation,
} from "@siteguard/contracts";
import type { Config } from "../config.js";
export function sessionFacts(s: Summary) {
  const facts: Record<string, string[]> = {};
  for (const key of ["pulse", "breathing"] as const) {
    const m = s[key],
      label = key === "pulse" ? "Pulse" : "Breathing rate",
      unit = key === "pulse" ? "bpm" : "breaths/min";
    facts[key] =
      m.status === "available"
        ? [
            `${label} changed by ${m.delta} ${unit} between the initial and final observation windows.`,
          ]
        : [
            `${label} has insufficient valid observations for a change calculation.`,
          ];
    const c = key === "pulse" ? s.pulseComparison : s.breathingComparison;
    facts[key + "_history"] =
      c.status === "available"
        ? [
            `The median change across ${c.count} comparable prior ${s.source === "mock" ? "synthetic" : "Presage"} sessions was ${c.historicalMedianDelta} ${unit}.`,
          ]
        : [
            `There are insufficient comparable prior observations for ${label.toLowerCase()}.`,
          ];
  }
  facts.rest_guidance = [
    "Use the before-and-after observations and comparable history as descriptive context only. If you feel unwell, take additional rest or contact a supervisor; these measurements do not determine fitness for work.",
  ];
  return facts;
}
const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;
/** Server-computed facts for a committed coverage change. */
export function scheduleFacts(after: {
  assignmentCount: number;
  gapCount: number;
  protectedBreakCount: number;
}) {
  return {
    coverage: [
      `The committed proposal contains ${count(after.assignmentCount, "assignment interval", "assignment intervals")} and ${count(after.gapCount, "coverage gap", "coverage gaps")}.`,
    ],
    breaks: [
      `${count(after.protectedBreakCount, "protected break was", "protected breaks were")} preserved.`,
    ],
  };
}
const selectionSchema = z.strictObject({
  selections: z
    .array(
      z.strictObject({
        factId: z.string(),
        variant: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(12),
});
export function renderSelection(raw: unknown, facts: Record<string, string[]>) {
  const parsed = selectionSchema.parse(raw);
  const ids = new Set<string>();
  return parsed.selections.map((s) => {
    if (
      ids.has(s.factId) ||
      !Object.hasOwn(facts, s.factId) ||
      facts[s.factId][s.variant] === undefined
    )
      throw new Error("Unsupported fact");
    ids.add(s.factId);
    return facts[s.factId][s.variant];
  });
}
// Keep the fallback responsive while allowing normal hosted-model latency.
// Gemini rejects request deadlines below 10 s.
export const GEMINI_TIMEOUT_MS = 12000;
export const REST_RECOMMENDATION_MIN_MINUTES = 5;
export const REST_RECOMMENDATION_MAX_MINUTES = 30;
export const REST_RECOMMENDATION_MODEL_VERSION = "rest-recommendation-v2";
const recommendationSchema = z.strictObject({
  suggestedMinutes: z.number().int(),
  rationale: z.array(z.string()).min(1).max(4),
});
const recommendationLimitations = [
  "This is a non-diagnostic suggestion, not medical advice or work clearance.",
  "It does not know symptoms, sensor error, workload causes, or clinical history.",
  "A worker may ignore or change it; only the worker requests rest and a supervisor approves and schedules it.",
];
const observedChange = (
  label: string,
  unit: string,
  m: Summary["pulse"],
  c: Summary["pulseComparison"],
) =>
  m.status === "available"
    ? `${label} went from ${m.initialMedian} to ${m.finalMedian} ${unit} during this check-in (change ${m.delta}).` +
      (c.status === "available"
        ? ` Across ${c.count} comparable earlier check-ins the usual change was ${c.historicalMedianDelta} ${unit}.`
        : " There are not enough comparable earlier check-ins for a personal comparison.")
    : `${label} had too few valid observations in this check-in to describe a change.`;
export function recommendationFacts(summary: Summary) {
  return {
    pulse: [
      observedChange("Pulse", "bpm", summary.pulse, summary.pulseComparison),
    ],
    breathing: [
      observedChange(
        "Breathing rate",
        "breaths/min",
        summary.breathing,
        summary.breathingComparison,
      ),
    ],
    measurement: [
      `The check-in lasted ${Math.round(summary.durationSeconds)} seconds, with ${summary.pulse.initialCount + summary.pulse.finalCount} valid pulse and ${summary.breathing.initialCount + summary.breathing.finalCount} valid breathing observations in the opening and closing windows.`,
    ],
    signal:
      summary.pulse.status === "available" &&
      summary.breathing.status === "available"
        ? [
            "Both pulse and breathing windows produced descriptive observations.",
          ]
        : [
            "One or more measurement windows had insufficient valid observations.",
          ],
    context: [
      summary.context.workload
        ? `Recorded workload context: ${summary.context.workload}.`
        : "Workload context was not recorded.",
      summary.context.temperatureC === null
        ? "Temperature context was not recorded."
        : "Temperature context was recorded.",
    ],
  };
}
export class RestRecommender {
  constructor(
    private config: Config,
    private generate?: (facts: Record<string, string[]>) => Promise<unknown>,
  ) {}
  async recommend(
    summary: Summary,
    sessionId: string,
    workerId: string,
  ): Promise<RestRecommendation> {
    const facts = recommendationFacts(summary);
    let origin: RestRecommendation["origin"] = "deterministic";
    let suggestedMinutes =
      summary.pulse.status === "available" &&
      summary.breathing.status === "available"
        ? 15
        : 10;
    let rationale = [
      facts.pulse[0],
      facts.breathing[0],
      facts.measurement[0],
    ];
    if ((this.config.geminiKey && this.config.geminiModel) || this.generate) {
      try {
        const task = this.generate ? this.generate(facts) : this.call(facts);
        const raw = await Promise.race([
          task,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), GEMINI_TIMEOUT_MS),
          ),
        ]);
        const parsed = recommendationSchema.parse(raw);
        if (
          parsed.suggestedMinutes >= REST_RECOMMENDATION_MIN_MINUTES &&
          parsed.suggestedMinutes <= REST_RECOMMENDATION_MAX_MINUTES
        ) {
          suggestedMinutes = parsed.suggestedMinutes;
          rationale = parsed.rationale;
          origin = "gemini";
        }
      } catch {
        // Deterministic bounded fallback is the expected degraded mode.
      }
    }
    return {
      id: randomUUID(),
      sessionId,
      workerId,
      suggestedMinutes,
      rationale,
      limitations: recommendationLimitations,
      origin,
      modelVersion: REST_RECOMMENDATION_MODEL_VERSION,
      createdAt: new Date().toISOString(),
    };
  }
  private async call(facts: Record<string, string[]>) {
    const ai = new GoogleGenAI({ apiKey: this.config.geminiKey });
    const response = await ai.models.generateContent({
      model: this.config.geminiModel!,
      contents: JSON.stringify({
        instruction:
          "Suggest how many minutes of additional rest this worker might ask for, based only on the provided observations from the check-in they just completed and their comparable earlier check-ins. Give up to four short, plain-language reasons that cite those facts. Return a bounded, non-diagnostic suggestion only. Do not diagnose, claim clearance, schedule or approve rest. Use only provided facts.",
        facts,
      }),
      config: {
        httpOptions: {
          timeout: GEMINI_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
        abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            suggestedMinutes: { type: "integer", minimum: 5, maximum: 30 },
            rationale: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 4,
            },
          },
          required: ["suggestedMinutes", "rationale"],
          additionalProperties: false,
        },
      },
    });
    return JSON.parse(response.text || "null");
  }
}
export class Explainer {
  private cache = new Map<string, Explanation>();
  /** Why the most recent explain() call used the deterministic fallback; never contains the API key. */
  lastFallbackReason: string | undefined;
  /** Origin of the most recent explain() result, for the integrations panel. */
  lastOrigin: "gemini" | "deterministic" | undefined;
  lastAt: string | undefined;
  constructor(
    private config: Config,
    private generate?: (facts: Record<string, string[]>) => Promise<unknown>,
  ) {}
  async explain(
    facts: Record<string, string[]>,
    limitations: string[],
  ): Promise<Explanation> {
    const result = await this.explainInner(facts, limitations);
    this.lastOrigin = result.origin;
    this.lastAt = new Date().toISOString();
    return result;
  }
  private async explainInner(
    facts: Record<string, string[]>,
    limitations: string[],
  ): Promise<Explanation> {
    const fallback: Explanation = {
      origin: "deterministic",
      observations: Object.values(facts).map((v) => v[0]),
      limitations,
    };
    this.lastFallbackReason = undefined;
    if (
      (!this.config.geminiKey || !this.config.geminiModel) &&
      !this.generate
    ) {
      this.lastFallbackReason = "GEMINI_API_KEY or GEMINI_MODEL is not set";
      return fallback;
    }
    const key = createHash("sha256")
      .update(JSON.stringify({ facts, limitations }))
      .digest("hex");
    const cached = this.cache.get(key);
    if (cached) return cached;
    try {
      const task = this.generate ? this.generate(facts) : this.call(facts);
      let timer: ReturnType<typeof setTimeout>;
      const raw = await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Timeout")),
            GEMINI_TIMEOUT_MS,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      const observations = renderSelection(raw, facts);
      // Every server fact must be presented; Gemini may only reorder/rephrase via approved variants.
      if (observations.length !== Object.keys(facts).length)
        throw new Error("Incomplete fact selection");
      const result: Explanation = {
        origin: "gemini",
        observations,
        limitations,
      };
      if (this.cache.size >= 100) this.cache.clear();
      this.cache.set(key, result);
      return result;
    } catch (e) {
      this.lastFallbackReason = this.redact(
        e instanceof Error ? e.message : String(e),
      ).slice(0, 500);
      return fallback;
    }
  }
  private redact(message: string) {
    const key = this.config.geminiKey;
    return key ? message.split(key).join("[redacted]") : message;
  }
  private async call(facts: Record<string, string[]>) {
    const ai = new GoogleGenAI({ apiKey: this.config.geminiKey });
    const response = await ai.models.generateContent({
      model: this.config.geminiModel!,
      contents: JSON.stringify({
        instruction:
          "Select and order relevant fact IDs and wording variants. Return every provided fact once. Do not add medical or safety judgments. No extra narrative.",
        facts,
      }),
      config: {
        httpOptions: {
          timeout: GEMINI_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
        abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            selections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  factId: { type: "string" },
                  variant: { type: "integer" },
                },
                required: ["factId", "variant"],
                additionalProperties: false,
              },
            },
          },
          required: ["selections"],
          additionalProperties: false,
        },
      },
    });
    return JSON.parse(response.text || "null");
  }
}
