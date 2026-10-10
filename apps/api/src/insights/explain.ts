import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { Summary, Explanation } from "@siteguard/contracts";
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
  return facts;
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
export class Explainer {
  private cache = new Map<string, Explanation>();
  constructor(
    private config: Config,
    private generate?: (facts: Record<string, string[]>) => Promise<unknown>,
  ) {}
  async explain(
    facts: Record<string, string[]>,
    limitations: string[],
  ): Promise<Explanation> {
    const fallback: Explanation = {
      origin: "deterministic",
      observations: Object.values(facts).map((v) => v[0]),
      limitations,
    };
    if ((!this.config.geminiKey || !this.config.geminiModel) && !this.generate)
      return fallback;
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
          timer = setTimeout(() => reject(new Error("Timeout")), 5000);
        }),
      ]).finally(() => clearTimeout(timer));
      const result: Explanation = {
        origin: "gemini",
        observations: renderSelection(raw, facts),
        limitations,
      };
      if (this.cache.size >= 100) this.cache.clear();
      this.cache.set(key, result);
      return result;
    } catch {
      return fallback;
    }
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
        httpOptions: { timeout: 5000, retryOptions: { attempts: 1 } },
        abortSignal: AbortSignal.timeout(5000),
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
