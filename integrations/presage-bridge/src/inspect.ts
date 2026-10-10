/**
 * OPT-IN DEBUG TOOL: `npm run inspect:metrics`.
 *
 * Runs the real SmartSpectra SDK on a video file (`useFile`) or the default
 * camera and reports, per metrics packet, WHICH payload fields are populated
 * (sample count, how many samples are `stable`, latest `confidence` where the
 * type has one). It never prints or stores physiological values, frames, or
 * footage. It is not used by the bridge server or the app.
 *
 * Field list mirrors @smartspectra/node-sdk 3.4.0
 * js/messages/generated.d.ts (ICardio, IBreathing, IFace, IEda, IMicroMotion).
 * Strict fields are single `IStrict {value, timestamp}` objects, not arrays.
 */

export type FieldKind =
  | "withConfidence" // MeasurementWithConfidence[] / Hrv[]: stable + confidence
  | "measurement" // Measurement[] / DetectionStatus[] / Landmarks[] / Expression[]: stable only
  | "strict"; // Strict: {value, timestamp}, no stable/confidence

export interface FieldSpec {
  group: "cardio" | "breathing" | "face" | "eda" | "micromotion";
  field: string;
  kind: FieldKind;
}

export const FIELDS: readonly FieldSpec[] = [
  { group: "cardio", field: "pulseRate", kind: "withConfidence" },
  { group: "cardio", field: "arterialPressureTrace", kind: "withConfidence" },
  { group: "cardio", field: "hrv", kind: "withConfidence" },
  { group: "cardio", field: "pulseRateStrict", kind: "strict" },
  { group: "breathing", field: "rate", kind: "withConfidence" },
  { group: "breathing", field: "upperTrace", kind: "measurement" },
  { group: "breathing", field: "lowerTrace", kind: "measurement" },
  { group: "breathing", field: "amplitude", kind: "measurement" },
  { group: "breathing", field: "apnea", kind: "measurement" },
  { group: "breathing", field: "respiratoryLineLength", kind: "measurement" },
  { group: "breathing", field: "baseline", kind: "measurement" },
  { group: "breathing", field: "inhaleExhaleRatio", kind: "measurement" },
  { group: "breathing", field: "breathingRateStrict", kind: "strict" },
  { group: "face", field: "blinking", kind: "measurement" },
  { group: "face", field: "talking", kind: "measurement" },
  { group: "face", field: "landmarks", kind: "measurement" },
  { group: "face", field: "expression", kind: "measurement" },
  { group: "eda", field: "trace", kind: "measurement" },
  { group: "micromotion", field: "glutes", kind: "measurement" },
  { group: "micromotion", field: "knees", kind: "measurement" },
];

/** Presence summary for one field in one packet. Contains no metric values. */
export interface FieldPresence {
  path: string;
  samples: number;
  stable: number | null; // count of samples with stable === true; null for strict
  latestConfidence: number | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Describe which fields of a decoded Metrics packet are populated. Values are never copied. */
export function describePacket(decoded: unknown): FieldPresence[] {
  if (!isObj(decoded)) return [];
  const out: FieldPresence[] = [];
  for (const spec of FIELDS) {
    const group = decoded[spec.group];
    if (!isObj(group)) continue;
    const raw = group[spec.field];
    const path = `${spec.group}.${spec.field}`;
    if (spec.kind === "strict") {
      if (isObj(raw) && typeof raw.value === "number")
        out.push({ path, samples: 1, stable: null, latestConfidence: null });
      continue;
    }
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const stable = raw.filter((s) => isObj(s) && s.stable === true).length;
    const last: unknown = raw[raw.length - 1];
    const conf =
      spec.kind === "withConfidence" &&
      isObj(last) &&
      typeof last.confidence === "number"
        ? last.confidence
        : null;
    out.push({ path, samples: raw.length, stable, latestConfidence: conf });
  }
  return out;
}

export function formatPacket(
  index: number,
  elapsedS: number,
  fields: FieldPresence[],
): string {
  const parts = fields.map((f) => {
    const s = f.stable === null ? "" : ` stable=${f.stable}`;
    const c =
      f.latestConfidence === null
        ? ""
        : ` conf=${Math.round(f.latestConfidence)}`;
    return `${f.path}[n=${f.samples}${s}${c}]`;
  });
  return `packet #${index} t+${elapsedS.toFixed(1)}s ${parts.length ? parts.join(" ") : "(no metric fields)"}`;
}

interface FieldStats {
  packets: number;
  firstSeenS: number;
  firstStableS: number | null;
}

/** Accumulates per-field presence across a run (counts and offsets only). */
export class PresenceTracker {
  readonly stats = new Map<string, FieldStats>();
  packets = 0;

  add(elapsedS: number, fields: FieldPresence[]) {
    this.packets++;
    for (const f of fields) {
      const st = this.stats.get(f.path) ?? {
        packets: 0,
        firstSeenS: elapsedS,
        firstStableS: null,
      };
      st.packets++;
      const stableNow = f.stable === null ? true : f.stable > 0;
      if (st.firstStableS === null && stableNow) st.firstStableS = elapsedS;
      this.stats.set(f.path, st);
    }
  }

  summary(): string[] {
    const lines = [`summary: ${this.packets} metrics packets`];
    for (const spec of FIELDS) {
      const path = `${spec.group}.${spec.field}`;
      const st = this.stats.get(path);
      if (!st) {
        lines.push(`  ${path}: never populated`);
        continue;
      }
      const stable =
        spec.kind === "strict"
          ? "n/a (Strict has no stable flag)"
          : st.firstStableS === null
            ? "never stable"
            : `first stable t+${st.firstStableS.toFixed(1)}s`;
      lines.push(
        `  ${path}: ${st.packets} packets, first seen t+${st.firstSeenS.toFixed(1)}s, ${stable}`,
      );
    }
    return lines;
  }
}

/** Structural view of the vendor module used by the inspector. */
export interface InspectModule {
  SmartSpectraSDK: new (options: {
    apiKey?: string;
    requestedMetrics?: number[];
    enableTelemetry?: boolean;
  }) => InspectSdk;
  MetricType: Record<string, number>;
  ProcessingStatus: { kRunning: number; kIdle: number; kError: number };
  ValidationCode: Record<string, number>;
  SmartSpectraErrorCode: Record<string, number>;
  CameraSelection: { default: unknown };
  decodeMetrics(buf: Buffer): unknown;
}

interface InspectSdk {
  on(event: string, cb: (...args: never[]) => void): unknown;
  useCamera(selection: unknown): unknown;
  useFile(path: string, options?: { interframeDelayMs?: number }): unknown;
  start(): void;
  stopAsync(): Promise<void>;
  destroy(): Promise<void>;
}

export interface InspectOptions {
  /** Video file path; omit to use the default camera. */
  file?: string;
  /** Stop after this many seconds (camera default 90). */
  maxSeconds: number;
  /** Also request face, eda and micromotion groups (standard mode only). */
  all: boolean;
  /** Request ONLY the Strict codes; cannot be combined with standard metrics. */
  strict: boolean;
  /** Print every packet instead of only packets whose field set changed. */
  verbose: boolean;
  /**
   * File mode only: VideoFileOptions.interframeDelayMs. Defaults to 33 so a
   * ~30 fps clip plays at roughly real time and the t+ offsets approximate
   * content time. 0 = as fast as possible (offsets then mean nothing).
   */
  interframeDelayMs: number;
}

/**
 * Metric codes requested. Standard mode: cardio + breathing bundles (plus
 * face/eda/micromotion with `all`). Strict mode: ONLY PULSE_RATE_STRICT (18)
 * and BREATHING_RATE_STRICT (19). The 3.4.0 native runtime refuses to mix them
 * (observed: "strict and standard metrics cannot be requested in the same
 * session. Use a separate session and API key for each service.").
 */
export function requestedCodes(
  m: InspectModule,
  mode: { all: boolean; strict: boolean },
): number[] {
  const names = mode.strict
    ? ["PULSE_RATE_STRICT", "BREATHING_RATE_STRICT"]
    : [
        "PULSE_RATE",
        "ARTERIAL_PRESSURE_TRACE",
        "HRV",
        "CHEST_BREATHING",
        "ABDOMEN_BREATHING",
        "BREATHING_RATE",
        "BREATHING_AMPLITUDE",
        "APNEA",
        "RESPIRATORY_LINE_LENGTH",
        "BASELINE",
        "INHALE_EXHALE_RATIO",
      ];
  if (mode.all && !mode.strict)
    names.push(
      "FACE_LANDMARKS",
      "BLINKING",
      "TALKING",
      "EXPRESSIONS",
      "EDA_TRACE",
      "GLUTES_MICROMOTION",
      "KNEES_MICROMOTION",
    );
  return names
    .map((n) => m.MetricType[n])
    .filter((v): v is number => typeof v === "number");
}

export interface InspectDeps {
  env: NodeJS.ProcessEnv;
  load: () => Promise<InspectModule>;
  log: (line: string) => void;
  nowMs: () => number;
}

/** Returns a process exit code: 0 = ran and saw packets, 1 = run failed / no packets, 2 = usage. */
export async function runInspect(
  opts: InspectOptions,
  deps: InspectDeps,
): Promise<number> {
  const apiKey = deps.env.SMARTSPECTRA_API_KEY?.trim();
  if (!apiKey) {
    deps.log("SMARTSPECTRA_API_KEY is not set; this tool needs the real SDK.");
    return 2;
  }
  const m = await deps.load();
  const name = (table: Record<string, number>, code: number) =>
    Object.entries(table).find(([, v]) => v === code)?.[0] ?? `code_${code}`;
  const sdk = new m.SmartSpectraSDK({
    apiKey,
    requestedMetrics: requestedCodes(m, opts),
    enableTelemetry: false,
  });
  const t0 = deps.nowMs();
  const elapsed = () => (deps.nowMs() - t0) / 1000;
  const tracker = new PresenceTracker();
  let lastSig = "";
  let lastValidation = -1;
  let failed = false;
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  let running = false;

  sdk.on("processingStatus", ((s: number) => {
    if (s === m.ProcessingStatus.kRunning) running = true;
    else if (s === m.ProcessingStatus.kError) {
      failed = true;
      finish();
    } else if (running && s === m.ProcessingStatus.kIdle) finish();
  }) as never);
  sdk.on("validationStatus", ((code: number, _ts: number, hint: string) => {
    if (code === lastValidation) return;
    lastValidation = code;
    deps.log(
      `validation t+${elapsed().toFixed(1)}s ${name(m.ValidationCode, code)}${hint ? ` (${hint})` : ""}`,
    );
  }) as never);
  sdk.on("error", ((code: number, message: string, retryable: boolean) => {
    deps.log(
      `error ${name(m.SmartSpectraErrorCode, code)} retryable=${retryable}: ${message}`,
    );
    if (!retryable) {
      failed = true;
      finish();
    }
  }) as never);
  sdk.on("metrics", ((buf: Buffer) => {
    let decoded: unknown;
    try {
      decoded = m.decodeMetrics(buf);
    } catch {
      deps.log("decode failed for one packet");
      return;
    }
    if (Buffer.isBuffer(decoded)) {
      deps.log("decodeMetrics returned a raw Buffer (no Metrics class)");
      return;
    }
    const t = elapsed();
    const fields = describePacket(decoded);
    tracker.add(t, fields);
    const sig = fields.map((f) => f.path).join(",");
    if (opts.verbose || sig !== lastSig)
      deps.log(formatPacket(tracker.packets, t, fields));
    lastSig = sig;
  }) as never);

  const timer = setTimeout(finish, opts.maxSeconds * 1000);
  timer.unref?.();
  try {
    if (opts.file)
      sdk.useFile(opts.file, { interframeDelayMs: opts.interframeDelayMs });
    else sdk.useCamera(m.CameraSelection.default);
    deps.log(
      `inspect source=${opts.file ? "file" : "camera"} metrics=${opts.strict ? "strict-only" : opts.all ? "all-standard" : "cardio+breathing"} telemetry=off (values are never printed)`,
    );
    sdk.start();
    await done;
  } catch (e) {
    failed = true;
    deps.log(`start failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
    await sdk.stopAsync().catch(() => undefined);
    await sdk.destroy().catch(() => undefined);
  }
  for (const line of tracker.summary()) deps.log(line);
  return failed || tracker.packets === 0 ? 1 : 0;
}

export function parseInspectArgs(
  argv: readonly string[],
): InspectOptions | string {
  const opts: InspectOptions = {
    maxSeconds: 90,
    all: false,
    strict: false,
    verbose: false,
    interframeDelayMs: 33,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") {
      const v = argv[++i];
      if (!v) return "--file needs a path";
      opts.file = v;
    } else if (a === "--camera") opts.file = undefined;
    else if (a === "--max-seconds") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0)
        return "--max-seconds needs a positive number";
      opts.maxSeconds = n;
    } else if (a === "--interframe-ms") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0)
        return "--interframe-ms needs a non-negative integer";
      opts.interframeDelayMs = n;
    } else if (a === "--all") opts.all = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--verbose") opts.verbose = true;
    else return `unknown argument: ${a}`;
  }
  if (opts.strict && opts.all)
    return "--strict cannot be combined with --all (the SDK rejects mixed sessions)";
  return opts;
}
