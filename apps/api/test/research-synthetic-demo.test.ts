import { createHash } from "node:crypto";
import { resolve } from "node:path";
import * as fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Summary } from "@siteguard/contracts";
import { fixtureId } from "@siteguard/mock-data";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { evaluateRestSupport } from "../src/research/rest-support.js";
import {
  createResearchDemoEvaluator,
  DEMO_ARTIFACT_PATH,
} from "../src/research/synthetic-demo.js";
import { login, populatedSession } from "./helpers.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  open: vi.fn(),
}));

function model() {
  return {
    schema_version: "siteguard-rest-request-csv-v1",
    model_version: "siteguard-rest-request-logistic-v1",
    dataset_sha256: "a".repeat(64),
    dataset_kind: "synthetic_demo",
    experimental: true,
    runtime_ready: false,
    confidence: null,
    status: "trained_research_only",
    target: "self-reported request for additional rest",
    feature_names: [
      "pulse_initial_bpm",
      "pulse_delta_bpm",
      "breathing_initial_brpm",
      "breathing_delta_brpm",
      "pulse_difference_from_history_bpm",
      "breathing_difference_from_history_brpm",
      "history_count",
      "duration_seconds",
    ],
    normalization: {
      means: [90, -10, 15, -2, 0, 0, 3, 60],
      scales: [10, 5, 5, 1, 5, 1, 2, 30],
    },
    weights: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    intercept: -1,
  };
}

function summary(): Summary {
  return {
    sessionId: fixtureId(9000),
    source: "mock",
    context: { workload: "moderate", temperatureC: 24 },
    durationSeconds: 90,
    pulse: {
      status: "available",
      initialMedian: 100,
      finalMedian: 95,
      delta: -5,
      initialCount: 15,
      finalCount: 15,
    },
    breathing: {
      status: "available",
      initialMedian: 20,
      finalMedian: 19,
      delta: -1,
      initialCount: 15,
      finalCount: 15,
    },
    pulseComparison: {
      status: "available",
      count: 3,
      historicalMedianDelta: -10,
    },
    breathingComparison: {
      status: "available",
      count: 5,
      historicalMedianDelta: -2,
    },
    limitations: [],
  };
}

function artifactFile(payload = JSON.stringify(model()), size?: number) {
  const bytes = Buffer.from(payload);
  const close = vi.fn().mockResolvedValue(undefined);
  const read = vi.fn(
    async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => ({
      bytesRead: bytes.copy(buffer, offset, position, position + length),
      buffer,
    }),
  );
  vi.mocked(fs.open).mockResolvedValue({
    stat: vi
      .fn()
      .mockResolvedValue({ isFile: () => true, size: size ?? bytes.length }),
    read,
    close,
  } as unknown as Awaited<ReturnType<typeof fs.open>>);
  return { read, close, bytes };
}

function evaluator(overrides: Partial<Config> = {}) {
  return createResearchDemoEvaluator(
    loadConfig({ demoMode: true, researchDemoEnabled: true, ...overrides }),
  );
}

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.mocked(fs.open).mockReset();
  artifactFile();
});
afterEach(async () => {
  for (const ctx of apps.splice(0)) await ctx.app.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("synthetic artifact inference guards", () => {
  it.each([{ demoMode: false }, { researchDemoEnabled: false }])(
    "does not read or infer when disabled: %j",
    async (config) => {
      const s = summary();
      expect(await evaluator(config)(s)).toEqual(evaluateRestSupport(s));
      expect(fs.open).not.toHaveBeenCalled();
    },
  );

  it("blocks production at call time, including an already cached model", async () => {
    const run = evaluator();
    expect((await run(summary())).syntheticDemo).toBe(true);
    vi.mocked(fs.open).mockClear();
    vi.stubEnv("NODE_ENV", "production");
    expect(await run(summary())).toEqual(evaluateRestSupport(summary()));
    expect(await evaluator()(summary())).toEqual(
      evaluateRestSupport(summary()),
    );
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("never reads the synthetic artifact for real measurements", async () => {
    const s = { ...summary(), source: "presage" as const };
    const result = await evaluator()(s);
    expect(result.syntheticDemo).toBe(false);
    expect(result.evidence.synthetic).toBe(false);
    expect(result.demoModel).toMatchObject({
      status: "measurement_source_blocked",
      score: null,
    });
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("matches training feature order, normalization and sigmoid, with explicit provenance", async () => {
    const { close, bytes } = artifactFile();
    const run = evaluator();
    const s = summary();
    const before = structuredClone(s);
    const [result, second] = await Promise.all([run(s), run(s)]);
    expect(result).toMatchObject({
      signal: "consider_additional_rest",
      syntheticDemo: true,
      confidence: null,
      experimental: true,
      modelVersion: "siteguard-rest-request-logistic-v1",
      modelProvenance: {
        kind: "synthetic_demo",
        runtime_ready: false,
        dataset_sha256: "a".repeat(64),
        artifact_sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      demoModel: {
        status: "inferred",
        target: "self-reported request for additional rest",
      },
    });
    expect(result.demoModel!.score).toBeCloseTo(1 / (1 + Math.exp(-1.9)), 12);
    expect(result.disclaimer).toContain(
      "trained on fabricated records; not validated",
    );
    expect(result.uncertainty.reasons.join(" ")).toContain(
      "runtime_ready remains false",
    );
    expect(second).toEqual(result);
    expect(s).toEqual(before);
    expect(fs.open).toHaveBeenCalledExactlyOnceWith(
      resolve(DEMO_ARTIFACT_PATH),
      "r",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses the trained output rather than the descriptive rule's signal", async () => {
    artifactFile(JSON.stringify({ ...model(), intercept: -10 }));
    expect(evaluateRestSupport(summary()).signal).toBe(
      "consider_additional_rest",
    );
    const result = await evaluator()(summary());
    expect(result.signal).toBe("no_additional_signal");
    expect(result.demoModel!.score).toBeLessThan(0.5);
    expect(result.confidence).toBeNull();
  });

  it.each(["history", "windows", "duration", "malformed"])(
    "abstains for unsupported %s evidence",
    async (kind) => {
      const s = summary();
      if (kind === "history") s.pulseComparison.count = 2;
      if (kind === "windows") s.breathing.finalCount = 4;
      if (kind === "duration") s.durationSeconds = 44;
      const result = await evaluator()(
        kind === "malformed" ? ({} as Summary) : s,
      );
      expect(result.signal).toBe("insufficient_evidence");
      expect(result.demoModel!.score).toBeNull();
      expect(result.confidence).toBeNull();
      if (kind === "malformed") expect(fs.open).not.toHaveBeenCalled();
    },
  );

  it.each([
    { dataset_kind: "real_research" },
    { runtime_ready: true },
    { runtime_ready: undefined },
    { confidence: 0.9 },
    { experimental: false },
    { dataset_sha256: "unknown" },
    { model_version: "unknown" },
    { status: "validated_only" },
    { target: "fatigue" },
    { feature_names: [...model().feature_names].reverse() },
    { weights: [1] },
    { weights: [1, 2, 3, 4, 5, 6, 7, null] },
    { normalization: { means: [1], scales: model().normalization.scales } },
    {
      normalization: {
        means: model().normalization.means,
        scales: [0, 1, 1, 1, 1, 1, 1, 1],
      },
    },
    { intercept: "1" },
  ])("rejects unsupported provenance or parameters %j", async (change) => {
    const { close } = artifactFile(JSON.stringify({ ...model(), ...change }));
    const result = await evaluator()(summary());
    expect(result).toMatchObject({
      signal: "insufficient_evidence",
      syntheticDemo: false,
      confidence: null,
      demoModel: { status: "unavailable", score: null },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(result.modelProvenance.kind).toBe("descriptive_rule");
  });

  it("handles missing/corrupt files without leaking local errors", async () => {
    vi.mocked(fs.open).mockRejectedValue(
      new Error("SECRET /private/local/model.json"),
    );
    const missing = await evaluator()(summary());
    expect(missing.demoModel!.status).toBe("unavailable");
    expect(JSON.stringify(missing)).not.toContain("SECRET");
    const { close } = artifactFile("{broken json");
    expect((await evaluator()(summary())).demoModel!.status).toBe(
      "unavailable",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("bounds file size before and during reads", async () => {
    const large = artifactFile("{}", 65537);
    expect((await evaluator()(summary())).demoModel!.status).toBe(
      "unavailable",
    );
    expect(large.read).not.toHaveBeenCalled();
    expect(large.close).toHaveBeenCalledOnce();
    const growing = artifactFile(" ".repeat(65537), 10);
    expect((await evaluator()(summary())).demoModel!.status).toBe(
      "unavailable",
    );
    expect(growing.close).toHaveBeenCalledOnce();
  });

  it("abstains when valid finite parameters overflow inference arithmetic", async () => {
    artifactFile(
      JSON.stringify({
        ...model(),
        normalization: {
          ...model().normalization,
          scales: Array(8).fill(Number.MIN_VALUE),
        },
      }),
    );
    const result = await evaluator()(summary());
    expect(result.demoModel).toMatchObject({
      status: "insufficient_evidence",
      score: null,
    });
    expect(result.uncertainty.reasons.join(" ")).toContain("finite bounds");
  });
});

async function apiSetup(overrides: Partial<Config> = {}) {
  const ctx = await createApp({
    sqlitePath: ":memory:",
    databaseUrl: undefined,
    allowSqlite: true,
    cookieSecret: "test-secret-at-least-thirty-two-characters",
    measurementToken: "internal-test-token",
    bridgeToken: undefined,
    webDist: "/nonexistent/siteguard-web",
    geminiKey: undefined,
    geminiModel: undefined,
    demoMode: true,
    researchDemoEnabled: true,
    ...overrides,
  });
  apps.push(ctx);
  const active = await populatedSession(ctx.repo, true);
  const session = {
    ...active,
    status: "completed" as const,
    endedAt: new Date(Date.parse(active.startedAt) + 60000).toISOString(),
  };
  await ctx.repo.put("sessions", session);
  return { ...ctx, session, url: `/api/sessions/${session.id}/rest-support` };
}

describe("synthetic research route", () => {
  it("returns an explicitly synthetic demo result without external inference or rest mutations", async () => {
    const { app, repo, session, url } = await apiSetup();
    const cookie = await login(app);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network"));
    const breaks = await repo.list("breaks");
    const requests = await repo.list("rest_requests");
    const res = await app.inject({ url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      syntheticDemo: true,
      confidence: null,
      modelProvenance: { kind: "synthetic_demo", runtime_ready: false },
      demoModel: { status: "inferred" },
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).not.toContain(session.workerId);
    expect(res.body).not.toContain(session.id);
    expect(fetch).not.toHaveBeenCalled();
    expect(await repo.list("breaks")).toEqual(breaks);
    expect(await repo.list("rest_requests")).toEqual(requests);
    expect(await repo.get("sessions", session.id)).toEqual(session);
  });

  it("keeps the default route descriptive and reads no artifact without the flag", async () => {
    const { app, url } = await apiSetup({ researchDemoEnabled: false });
    const cookie = await login(app);
    const res = await app.inject({ url, headers: { cookie } });
    expect(res.json()).toMatchObject({
      syntheticDemo: false,
      modelProvenance: { kind: "descriptive_rule", runtime_ready: false },
    });
    expect(res.json()).not.toHaveProperty("demoModel");
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("never loads the artifact through the route in production even with both flags", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { app, url } = await apiSetup();
    const cookie = await login(app);
    const res = await app.inject({ url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      syntheticDemo: false,
      modelProvenance: { kind: "descriptive_rule", runtime_ready: false },
    });
    expect(res.json()).not.toHaveProperty("demoModel");
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("leaves real session evidence labeled real and blocks synthetic inference", async () => {
    const { app, repo, session, url } = await apiSetup();
    await repo.put("sessions", { ...session, source: "presage" });
    const cookie = await login(app);
    const res = await app.inject({ url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      syntheticDemo: false,
      evidence: { source: "presage", synthetic: false },
      demoModel: { status: "measurement_source_blocked", score: null },
    });
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("authorizes the owner and requires completion before reading any artifact", async () => {
    const { app, repo, session, url } = await apiSetup();
    const other = await login(app, "worker", fixtureId(2));
    const supervisor = await login(app, "supervisor");
    for (const [headers, status] of [
      [{}, 401],
      [{ cookie: other }, 403],
      [{ cookie: supervisor }, 403],
    ] as const) {
      expect((await app.inject({ url, headers })).statusCode).toBe(status);
    }
    const cookie = await login(app);
    await repo.put("sessions", { ...session, status: "active", endedAt: null });
    expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(
      409,
    );
    expect(fs.open).not.toHaveBeenCalled();
  });

  it("fails closed through the route on a runtime-ready artifact", async () => {
    artifactFile(JSON.stringify({ ...model(), runtime_ready: true }));
    const { app, url } = await apiSetup();
    const cookie = await login(app);
    const res = await app.inject({ url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      syntheticDemo: false,
      signal: "insufficient_evidence",
      demoModel: { status: "unavailable", score: null },
    });
  });
});
