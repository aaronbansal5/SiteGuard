import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { Summary } from "@siteguard/contracts";
import type { Config } from "../config.js";
import { evaluateRestSupport, type RestSupportResult } from "./rest-support.js";

// Fixed local artifact; never accept a path, URL or model from a request.
export const DEMO_ARTIFACT_PATH =
  ".data/research/artifacts/demo-full-run-001/model.json";
const MAX_ARTIFACT_BYTES = 64 * 1024;
const TARGET = "self-reported request for additional rest" as const;
const finite = z.number().finite();
const vector = z.array(finite).length(8);
const artifactSchema = z.object({
  schema_version: z.literal("siteguard-rest-request-csv-v1"),
  model_version: z.literal("siteguard-rest-request-logistic-v1"),
  dataset_kind: z.literal("synthetic_demo"),
  dataset_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  experimental: z.literal(true),
  runtime_ready: z.literal(false),
  confidence: z.null(),
  status: z.literal("trained_research_only"),
  target: z.literal(TARGET),
  feature_names: z.tuple([
    z.literal("pulse_initial_bpm"),
    z.literal("pulse_delta_bpm"),
    z.literal("breathing_initial_brpm"),
    z.literal("breathing_delta_brpm"),
    z.literal("pulse_difference_from_history_bpm"),
    z.literal("breathing_difference_from_history_brpm"),
    z.literal("history_count"),
    z.literal("duration_seconds"),
  ]),
  normalization: z.object({
    means: vector,
    scales: z.array(finite.positive()).length(8),
  }),
  weights: vector,
  intercept: finite,
});
type Artifact = z.infer<typeof artifactSchema>;
type LoadedArtifact = { model: Artifact; sha256: string };

function enabled(c: Config): boolean {
  return (
    c.demoMode && c.researchDemoEnabled && process.env.NODE_ENV !== "production"
  );
}

async function loadArtifact(): Promise<LoadedArtifact | null> {
  try {
    const file = await open(resolve(DEMO_ARTIFACT_PATH), "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) return null;
      // Bound reads even if the local artifact changes after stat().
      const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_ARTIFACT_BYTES) return null;
      const payload = buffer.subarray(0, length);
      const parsed = artifactSchema.safeParse(
        JSON.parse(payload.toString("utf8")),
      );
      if (!parsed.success) return null;
      return {
        model: parsed.data,
        sha256: createHash("sha256").update(payload).digest("hex"),
      };
    } finally {
      await file.close();
    }
  } catch {
    // Missing/corrupt/unsupported artifacts cannot become inference results.
    return null;
  }
}

/** Per-app, lazy cache. Authorization/completion checks run before this caller. */
export function createResearchDemoEvaluator(c: Config) {
  let artifact: Promise<LoadedArtifact | null> | undefined;
  return async (summary: Summary): Promise<RestSupportResult> => {
    const base = evaluateRestSupport(summary);
    if (!enabled(c)) return base;
    if (base.evidence.source !== "mock" || base.evidence.synthetic !== true)
      return {
        ...base,
        demoModel: {
          status: "measurement_source_blocked",
          score: null,
          target: TARGET,
        },
      };

    const loaded = await (artifact ??= loadArtifact());
    if (!loaded)
      return {
        ...base,
        signal: "insufficient_evidence",
        demoModel: { status: "unavailable", score: null, target: TARGET },
        uncertainty: {
          level: "unquantified",
          reasons: [
            "The synthetic demo artifact is unavailable or failed its provenance/parameter guards. No model prediction was made.",
            ...base.uncertainty.reasons,
          ],
        },
      };

    const { model, sha256 } = loaded;
    const result: RestSupportResult = {
      ...base,
      signal: "insufficient_evidence",
      syntheticDemo: true,
      modelVersion: model.model_version,
      modelProvenance: {
        kind: "synthetic_demo",
        runtime_ready: model.runtime_ready,
        dataset_sha256: model.dataset_sha256,
        artifact_sha256: sha256,
      },
      demoModel: {
        status: "insufficient_evidence",
        score: null,
        target: TARGET,
      },
      disclaimer:
        "Synthetic demo model — trained on fabricated records; not validated. " +
        "Experimental research estimate — not medical advice or work clearance. " +
        "The worker chooses whether to request rest; scheduled breaks remain protected.",
      uncertainty: {
        level: "unquantified",
        reasons: [
          "Synthetic training and measurements only. The logistic output is uncalibrated and is not confidence or evidence of fatigue/rest needs.",
          "Independent evaluation on real labeled data is unavailable; runtime_ready remains false.",
          "Summary medians omit sensor error, within-window variation, symptoms and causal factors.",
          ...base.evidence.issues,
        ],
      },
    };
    const { pulse, breathing, durationSeconds, issues } = base.evidence;
    if (
      !pulse ||
      !breathing ||
      durationSeconds === null ||
      issues.some((issue) => !issue.startsWith("Workload/environment context"))
    )
      return result;

    // Feature order and scaling match scripts/research/train.py. Each metric
    // can have a different history count, so use the smaller eligible count.
    const features = [
      pulse.initial,
      pulse.delta,
      breathing.initial,
      breathing.delta,
      pulse.differenceFromHistory!,
      breathing.differenceFromHistory!,
      Math.min(pulse.priorCount, breathing.priorCount),
      durationSeconds,
    ];
    const terms = features.map(
      (value, index) =>
        ((value - model.normalization.means[index]) /
          model.normalization.scales[index]) *
        model.weights[index],
    );
    const logit = terms.reduce((total, term) => total + term, model.intercept);
    if (!terms.every(Number.isFinite) || !Number.isFinite(logit)) {
      result.uncertainty.reasons.push(
        "Model arithmetic exceeded finite bounds; no prediction was made.",
      );
      return result;
    }
    // Stable sigmoid; 0.5 is a demo classifier threshold, not a medical rule.
    const exp = Math.exp(logit >= 0 ? -logit : logit);
    const score = logit >= 0 ? 1 / (1 + exp) : exp / (1 + exp);
    result.signal =
      score >= 0.5 ? "consider_additional_rest" : "no_additional_signal";
    result.demoModel = { status: "inferred", score, target: TARGET };
    return result;
  };
}
