// Live Gemini verification for the server-side explanation adapter.
// Usage: npm run verify:gemini   (reads GEMINI_API_KEY / GEMINI_MODEL from .env or the environment)
// Sends only fictional synthetic facts. Never prints the API key. Exits 1 unless origin === "gemini".
import { tsImport } from "tsx/esm/api";

// Local verification only: avoid hosted-mode secret requirements unrelated to Gemini.
process.env.HOSTED = "false";

const { loadConfig } = await tsImport(
  "../apps/api/src/config.ts",
  import.meta.url,
);
const { Explainer, sessionFacts } = await tsImport(
  "../apps/api/src/insights/explain.ts",
  import.meta.url,
);

const config = loadConfig();
const key = config.geminiKey;
const redact = (text) =>
  key ? String(text).split(key).join("[redacted]") : String(text);

// Fictional synthetic session summary; only the fields sessionFacts reads.
const summary = {
  source: "mock",
  pulse: {
    status: "available",
    initialMedian: 96,
    finalMedian: 88,
    delta: -8,
    initialCount: 10,
    finalCount: 10,
  },
  breathing: {
    status: "available",
    initialMedian: 18,
    finalMedian: 16,
    delta: -2,
    initialCount: 10,
    finalCount: 10,
  },
  pulseComparison: { status: "available", count: 4, historicalMedianDelta: -6 },
  breathingComparison: {
    status: "insufficient_data",
    count: 1,
    historicalMedianDelta: null,
  },
};
const limitations = [
  "Synthetic fictional measurements; not a diagnosis or medical clearance.",
];

console.log(`GEMINI_API_KEY: ${key ? "set (value hidden)" : "NOT SET"}`);
console.log(`GEMINI_MODEL:   ${config.geminiModel ?? "NOT SET"}`);

const explainer = new Explainer(config);
const started = Date.now();
const result = await explainer.explain(sessionFacts(summary), limitations);
const elapsed = Date.now() - started;

console.log(`origin:         ${result.origin}`);
console.log(
  `model used:     ${result.origin === "gemini" ? config.geminiModel : "(none, deterministic fallback)"}`,
);
console.log(`latency:        ${elapsed} ms`);
console.log("observations:");
for (const o of result.observations) console.log(`  - ${redact(o)}`);
if (result.origin !== "gemini") {
  console.error(
    `FAIL: deterministic fallback used. Reason: ${redact(explainer.lastFallbackReason ?? "unknown")}`,
  );
  process.exit(1);
}
console.log(
  "PASS: live Gemini explanation accepted by the server-side adapter.",
);
