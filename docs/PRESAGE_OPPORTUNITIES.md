# Presage SmartSpectra opportunities for SiteGuard

Research branch `feature/presage-research`, 2026-10-10. Scope: what more the
Presage SmartSpectra SDK could give SiteGuard's **worker recovery visibility**
without breaking the rules in `docs/PROJECT_SPEC.md` and `AGENTS.md`.

**Status of this document.** It is a plan and a set of proposals. It changes
no canonical interface. Every schema change below is a **proposal only**.
`docs/PRESAGE_CONTRACT.md`, `packages/contracts` and `apps/*` were not edited.
No real camera session has been observed with a valid API key, so every
statement about live SDK output comes from vendor docs or type declarations,
not from SiteGuard measurements. The exceptions are the facts marked
**Observed (local run)**, which came from running the installed native SDK in
this sandbox with a deliberately fake key (see §6).

## Sources and citation keys

| Key             | Source                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[gen:N]`       | `integrations/presage-bridge/node_modules/@smartspectra/node-sdk/js/messages/generated.d.ts`, line N (package `@smartspectra/node-sdk` 3.4.0, pinned)      |
| `[idx:N]`       | `.../@smartspectra/node-sdk/js/index.d.ts`, line N                                                                                                         |
| `[const:N]`     | `.../@smartspectra/node-sdk/js/constants.js`, line N (metric bundles)                                                                                      |
| `[ijs:N]`       | `.../@smartspectra/node-sdk/js/index.js`, line N                                                                                                           |
| `[sdkreadme:N]` | `.../@smartspectra/node-sdk/README.md`, line N                                                                                                             |
| `[dt]`          | https://smartspectra.presagetech.com/docs/data-types.md                                                                                                    |
| `[nm]`          | https://smartspectra.presagetech.com/docs/nodejs/metrics.md                                                                                                |
| `[napi]`        | https://smartspectra.presagetech.com/docs/nodejs/api-reference.md                                                                                          |
| `[node]`        | https://smartspectra.presagetech.com/docs/nodejs.md                                                                                                        |
| `[nmig]`        | https://smartspectra.presagetech.com/docs/nodejs/migration-guide.md (v3.4.0 section)                                                                       |
| `[nci]`         | https://smartspectra.presagetech.com/docs/nodejs/headless-testing-in-ci.md                                                                                 |
| `[mq]`          | https://smartspectra.presagetech.com/docs/measurement-quality.md ("Getting a Good Measurement")                                                            |
| `[mc]`          | https://smartspectra.presagetech.com/docs/model-cards-and-limitations.md                                                                                   |
| `[tp]`          | https://smartspectra.presagetech.com/docs/telemetry-and-privacy.md                                                                                         |
| `[mc-hrv]`      | https://vandv.presagetech.com/hrv_model_card.html (linked from `[gen:1601]`)                                                                               |
| `[mc-br]`       | https://vandv.presagetech.com/breathing_model_card.html (linked from `[gen:957]`)                                                                          |
| `[mc-ap]`       | https://vandv.presagetech.com/arterial_pressure_model_card.html (linked from `[gen:1583]`)                                                                 |
| `[obs]`         | **Observed (local run)**: `npm run inspect:metrics` against the real native runtime on linux-x64 with a fake key and no network access to Presage (see §6) |

The docs were read through a summarising fetch tool, because direct `curl` to
`smartspectra.presagetech.com` is blocked by this sandbox's egress policy.
Field names below come from the `.d.ts` files. Treat doc wording as
paraphrase unless it appears in quotation marks.

## Executive summary

1. **The biggest real-Presage problem is timing, not missing metrics.** The
   vendor says breathing confidence stays at 0 until its 30 s window fills,
   pulse uses a 12 s window, and HRV confidence stays at 0 until 60 s `[mc]`
   `[mq]`. SiteGuard's "initial window" is the first 15 s after session start
   (`apps/api/src/domain/analytics.ts:28-30`). So with real Presage, the
   breathing initial window will almost never hold any `valid` readings, and
   pulse rarely will. The result is `insufficient_data` every time. This is
   inferred from the docs, not yet observed. Fixing it (recommendation R1)
   matters more than any new metric.
2. **HRV (`cardio.hrv[].rmssd`, `.sdnn`, `.meanNn`) is the only extra metric
   worth adding** for recovery visibility. Use it as a worker-only,
   personal-baseline feature for the recovery-trend work on
   `feature/ml-recovery` (R3). It needs about 60 s of data per value, and its
   vendor error (RMSSD MAE about 10 ms at an 80 % return rate `[mc-hrv]`) is
   large compared with typical session-to-session changes.
3. **The "Strict" variants are not a drop-in validity upgrade.** The native
   runtime refuses to start a session that mixes strict and standard metrics:
   _"strict and standard metrics cannot be requested in the same session. Use
   a separate session and API key for each service."_ `[obs]`. `Strict` also
   has no `stable` or `confidence` field `[gen:721-728]`, and the public docs
   don't describe it. Keep the vendor `stable` flag as SiteGuard's validity
   source (R6: do not adopt).
4. Map `validationStatus` codes to SiteGuard-owned guidance and add
   warm-up messaging (R2). This is cheap, needs no contract change, and makes
   the most difference to demo quality.

## 1. Metric catalogue (SDK 3.4.0)

Every numeric series is a repeated list of samples. `MeasurementWithConfidence`
is `{value, stable, confidence (0-100), timestamp}` `[gen:234-247]`.
`Measurement` is `{value, stable, timestamp}` `[gen:10-20]`. `DetectionStatus`
is `{detected, stable, timestamp}` `[gen:122-132]`. Timestamps are _"Absolute
... in microseconds, since Linux epoch"_ `[gen:18]` `[dt]`. The one exception
is `Strict.timestamp`, which is _"End of the completed measurement window, in
microseconds on the session input timeline"_ `[gen:727]`, so it is not epoch
time.

The payload root is `Metrics {breathing, micromotion, eda, face, cardio}`
`[gen:1734-1750]`. The `Pulse` message (`rate`, `trace`,
`pulseRespirationQuotient`, `pulseRateStrict`) `[gen:827-843]` exists in the
schema but no `Metrics` field references it. Treat it as unreachable from
`decodeMetrics`.

Bundles: `cardioMetrics` = 15, 16, 17. `breathingMetrics` = 0-7 (the default).
`faceMetrics` = 11-14. `micromotionMetrics` = 8, 9. `edaMetrics` = 10
`[const:105-140]`. The Strict codes 18 and 19 are in **no** bundle
`[idx:113-114]` `[const:105-140]`.

Legend for the "Fits SiteGuard?" column:

- **Yes**: compatible with the no-diagnosis rule and worker-only physiology.
- **Data-quality only**: may drive guidance or validity, never shown as physiology.
- **No**: conflicts with the rules, or has no documented semantics.

### Cardio (`decoded.cardio`, `ICardio` `[gen:1577-1611]`)

| Field (MetricType)                                     | Type                                                                                      | Vendor meaning                                                                                                                                                                                                                                 | Stability / confidence                                                                                                                                                                                                           | Fits SiteGuard?                                                                                                                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pulseRate` (`PULSE_RATE` 15)                          | `MeasurementWithConfidence[]` `[gen:1586]`                                                | 12-second average pulse rate in BPM `[mc]`. Operating range 40-110 BPM `[mc]`; the model card states 40-180 `[mc-ap]`                                                                                                                          | `stable` ⇔ confidence ≥ 40, the _"minimum accepted accuracy standard for heart rate (+/-3 bpm)"_ `[gen:1579-1583]` `[dt]`. At confidence ≥ 97 (80 % return): MAE 0.36 BPM `[mc-ap]`                                              | **Yes**, already used (`heartRateBpm`)                                                                                                                                                                                    |
| `pulseRateStrict` (`PULSE_RATE_STRICT` 18)             | single `Strict {value, timestamp}` `[gen:1610]`, `[gen:721-728]`                          | _"Strict pulse-rate measurement. Populated only when PULSE_RATE_STRICT is requested and a value is available."_ `[gen:1606-1609]`. Not described on any public doc page `[nm]` `[napi]` `[dt]`                                                 | **None.** No `stable` or `confidence`. The timestamp is on the session input timeline. Cannot share a session with standard metrics `[obs]`                                                                                      | **No** (see R6)                                                                                                                                                                                                           |
| `arterialPressureTrace` (`ARTERIAL_PRESSURE_TRACE` 16) | `MeasurementWithConfidence[]` `[gen:1595]`                                                | _"uncalibrated, unitless"_ `[gen:1588]`. _"Represents waveform shape only"_, _"Not a blood pressure measurement"_ `[mc]`                                                                                                                       | Same threshold as pulse (≥ 40) `[gen:1589-1592]`                                                                                                                                                                                 | **No.** Workers and supervisors would read it as blood pressure. That is a clinical implication with no recovery value                                                                                                    |
| `hrv` (`HRV` 17)                                       | `Hrv[]` = `{rmssd, meanNn, sdnn, baevsky, timestamp, confidence, stable}` `[gen:580-606]` | RMSSD = _"root mean square of successive differences between normal heartbeats"_ `[gen:582]`. SDNN, mean NN `[gen:585-588]`. Computed over 60 s windows `[mc]`, _"once per 60 seconds"_ `[mc-hrv]`. Accuracy is quoted in ms `[dt]` `[mc-hrv]` | `stable` ⇔ confidence ≥ 50 (_"+/-5 ms"_) `[gen:1597-1601]` `[dt]`. Confidence stays 0 until the 60 s window fills `[mc]`. At confidence ≥ 79 (80 % return): RMSSD MAE 10.22 ms, SDNN MAE 5.30 ms, mean-NN MAE 3.11 ms `[mc-hrv]` | **Yes for `rmssd`, `sdnn`, `meanNn`**, as worker-only personal-trend features (R3). **No for `baevsky`**, the _"Baevsky's Stress Index"_ `[gen:590-595]`: a "stress" number is exactly the kind of score the spec forbids |

### Breathing (`decoded.breathing`, `IBreathing` `[gen:951-997]`)

| Field (MetricType)                                    | Type                                      | Vendor meaning                                                                                                                                         | Stability / confidence                                                                                                                                   | Fits SiteGuard?                                                                                 |
| ----------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `rate` (`BREATHING_RATE` 2)                           | `MeasurementWithConfidence[]` `[gen:960]` | 30-second average breaths/min, range 5-40 `[mc]` (4-40 in `[mc-br]`). The model needs _"approximately 45 seconds of uninterrupted data"_ `[mc-br]`     | `stable` ⇔ confidence ≥ 45, _"+/-1 br/min"_ `[gen:953-958]`. Confidence 0 until 30 s `[mc]`. At confidence ≥ 79 (80 % return): MAE 0.38 br/min `[mc-br]` | **Yes**, already used (`respiratoryRateBrpm`)                                                   |
| `breathingRateStrict` (`BREATHING_RATE_STRICT` 19)    | single `Strict` `[gen:996]`               | _"Populated only when BREATHING_RATE_STRICT is requested and a value is available"_ `[gen:990-995]`. Undocumented publicly                             | None (see `pulseRateStrict`)                                                                                                                             | **No** (R6)                                                                                     |
| `upperTrace` (`CHEST_BREATHING` 0)                    | `Measurement[]` `[gen:967]`               | Chest movement trace `[gen:962-966]`. Arbitrary amplitude units `[mc]`                                                                                 | No confidence of its own. `stable` is inherited from the breathing-rate verdict `[gen:963-965]`                                                          | Not needed. A raw waveform adds no understandable record and invites over-reading               |
| `lowerTrace` (`ABDOMEN_BREATHING` 1)                  | `Measurement[]` `[gen:974]`               | Abdominal trace. Needs the waistline visible `[mq]` `[mc]`                                                                                             | Inherited, as for `upperTrace` `[gen:970-972]`                                                                                                           | Not needed                                                                                      |
| `amplitude` (`BREATHING_AMPLITUDE` 3)                 | `Measurement[]` `[gen:977]`               | _"Breathing amplitude measurements"_ `[gen:976]`. No unit or definition in `[dt]`, `[nm]` or `[mc]`                                                    | `stable` only                                                                                                                                            | **No** until the semantics are documented. Use `inspect:metrics` to see whether it is populated |
| `apnea` (`APNEA` 4)                                   | `DetectionStatus[]` `[gen:980]`           | _"Apnea (breathing cessation) detection status"_ `[gen:979]`. The breathing model card says it has no alarms and **is not an apnea monitor** `[mc-br]` | `stable` only                                                                                                                                            | **No.** "Apnea" is a clinical term, and the vendor disclaims monitoring use                     |
| `respiratoryLineLength` (`RESPIRATORY_LINE_LENGTH` 5) | `Measurement[]` `[gen:983]`               | _"for breathing pattern analysis"_ `[gen:982]`. Otherwise undocumented                                                                                 | `stable` only                                                                                                                                            | **No** (undocumented)                                                                           |
| `baseline` (`BASELINE` 6)                             | `Measurement[]` `[gen:986]`               | _"Baseline breathing measurements"_ `[gen:985]`. Undocumented                                                                                          | `stable` only                                                                                                                                            | **No** (undocumented)                                                                           |
| `inhaleExhaleRatio` (`INHALE_EXHALE_RATIO` 7)         | `Measurement[]` `[gen:989]`               | _"Inhale to exhale duration ratio"_ `[gen:988]`. No accuracy statement in `[mc]` or `[mc-br]`                                                          | `stable` only                                                                                                                                            | **No** for now. No validation evidence, and it is easy to over-interpret                        |

### Face, EDA, micromotion

| Field (MetricType)                                                              | Type                                                                                  | Vendor meaning                                                                                                                          | Stability                      | Fits SiteGuard?                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `face.talking` (`TALKING` 13)                                                   | `DetectionStatus[]` `[gen:1259]`                                                      | Binary talking detection `[mc]`. Talking _"invalidates breathing rate"_ `[mc-br]`                                                       | `stable`                       | **Data-quality only** (R4). A transient boolean for "please stay quiet" guidance. Never stored or shown as a trait        |
| `face.blinking` (`BLINKING` 12)                                                 | `DetectionStatus[]` `[gen:1256]`                                                      | Binary blink detection `[mc]`                                                                                                           | `stable`                       | **No.** Blink rate is a common fatigue proxy, and the spec forbids fatigue scoring                                        |
| `face.landmarks` (`FACE_LANDMARKS` 11)                                          | `Landmarks[]` = `{value: Point2dFloat[], stable, reset, timestamp}` `[gen:1135-1148]` | 478 facial landmark coordinates `[mc]`                                                                                                  | `stable`, `reset`              | **No.** This is biometric face geometry. It conflicts with "No facial identification" and adds no recovery value          |
| `face.expression` (`EXPRESSIONS` 14)                                            | `Expression[]` = `{stable, timestamp, scores: ExpressionScore[]}` `[gen:468-478]`     | Probabilities for anger, contempt, disgust, fear, happiness, sadness, surprise and neutral `[mc]` `[gen:352]`                           | `stable`, per-score confidence | **No.** Emotion inference about workers is a surveillance risk and is out of scope                                        |
| `eda.trace` (`EDA_TRACE` 10)                                                    | `Measurement[]` `[gen:1480]`                                                          | "EDA Proxy" skin-conductance trace related to autonomic activity `[gen:1482-1485]`. First result needs _"over 35 seconds"_ `[gen:1742]` | `stable` only                  | **No.** It is a proxy with no accuracy statement in `[mc]`, and arousal or stress readings drift toward forbidden scoring |
| `micromotion.glutes` / `.knees` (`GLUTES_MICROMOTION` 8, `KNEES_MICROMOTION` 9) | `Measurement[]` `[gen:1371-1378]`                                                     | _"Micro-motion measurements"_ by region `[gen:1373-1376]`. Not covered by `[mc]` or `[nm]`                                              | `stable` only                  | **No** (undocumented; needs a lower-body view)                                                                            |

`enableAccumulatedOutput` adds one accumulated `Metrics` packet at the end of
each session, through the `'accumulatedMetrics'` event `[idx:128-129]`
`[idx:323]` `[napi]`. Its contents are not documented further. It might give
the full HRV series at stop (see R3). Verify that with the inspector before
relying on it.

## 2. Ranked recommendations

Effort: S < ½ day, M ≈ 1-2 days, L > 2 days. "Contract" means
`docs/PRESAGE_CONTRACT.md` together with `packages/contracts` (Developer 1).
"Bridge" means `integrations/presage-bridge` (Developer 2).

### R1. Warm-up-aware analysis windows and a 90 s real-Presage session

- **Value: highest.** As written, real Presage sessions will usually return
  `insufficient_data` for breathing, and often for pulse. The initial window
  is `[start, start+15 s)` (`analytics.ts:28-30`), but breathing is not
  `stable` before about 30 s `[mc]` and the model wants about 45 s of
  uninterrupted data `[mc-br]`. Positioning time comes on top of that. This is
  inferred from vendor docs and needs confirming on hardware with
  `inspect:metrics` (look at the "first stable t+" lines).
- **Proposed spec change** (Developer 1 owns `PROJECT_SPEC.md`, so this is a
  proposal, not an edit). This rule is still a data-sufficiency rule, not a
  clinical threshold:
  ```diff
  -Metric-independent: quality=valid and non-null. Initial first 15 seconds; final last 15 seconds. Duration >=45 seconds; ...
  +Metric-independent: quality=valid and non-null. Initial window: the 15 seconds starting at that metric's first valid
  +reading (vendor warm-up differs per metric); final last 15 seconds. Duration >=45 seconds measured from that first
  +valid reading; ... Real Presage check-ins default to 90 seconds; mock remains 60 seconds.
  ```
  The `analytics.ts` change: replace `start` with the first `valid` reading's
  timestamp for that metric when computing `initial` and the duration test.
  The final window is unchanged.
- **Contract change:** none. **Bridge change:** none, apart from the warm-up
  message in R2.
- **Privacy impact:** none. **Effort:** S for code and tests (Developer 1),
  plus updating `docs/DEMO.md` (Developer 4).

### R2. Map `validationStatus` codes to SiteGuard guidance and announce warm-up

- **Value: high for the demo.** Today the bridge forwards the vendor `hint`
  string verbatim as the `positioning` message
  (`src/adapters/presage-sdk.ts`, `validationStatus` handler). A fixed
  SiteGuard-owned message per code (table in §3) gives consistent, translatable
  and testable guidance. After `kOk`, the bridge can also send a one-off
  `measuring` message: "Hold still and stay quiet. Pulse needs about 15 s and
  breathing about 30-45 s before readings count."
- **Contract change:** none. `status.message` is already `string|null`.
- **Bridge change:** add a code → message table in `presage-sdk.ts`, keep the
  vendor hint as the fallback for unknown codes, and add tests for each code.
  Keep forwarding only changes (this is already done; the vendor docs also
  recommend debouncing `[mq]`).
- **Privacy impact:** none. **Effort:** S.

### R3. HRV (RMSSD, SDNN, mean NN) as a worker-only personal recovery-trend feature

- **Value: medium-high for `feature/ml-recovery`.** It is the only additional
  vendor metric that is both validated with an ECG reference (118 subjects,
  418 videos, Biopac MP160 3-lead ECG `[mc-hrv]`) and plausibly related to
  recovery during rest. Use it only as a **within-worker** trend against that
  worker's own prior sessions (same source, workload and temperature band
  rules as the existing comparisons). Never use population thresholds, never
  produce a "recovery score", and never feed it into scheduling.
- **Caveats the model must respect:**
  - One value per 60 s window, with confidence 0 until 60 s `[mc]`
    `[mc-hrv]`. A 90 s session gives roughly one usable value. A
    within-session delta needs two non-overlapping windows, so 150-180 s.
  - RMSSD MAE is about 10 ms at an 80 % return rate, and 14.28 ms with no
    confidence filter `[mc-hrv]`. Small session-to-session changes are inside
    the error, so aggregate across sessions (medians) and report "not enough
    data" freely.
  - Subgroup gaps: Fitzpatrick VI had a 41.9 % return rate and RMSSD MAE
    21.26 ms, and female subjects had higher error (12.20 vs 8.35 ms)
    `[mc-hrv]`. Missing HRV must never count against a worker. The
    `insufficient_data` path has to stay neutral.
  - Motion-sensitive, needs 60 s of uninterrupted facial view and 25+ fps
    `[mc-hrv]`.
  - The model card puts diagnosis, arrhythmia detection and monitoring out of
    scope. The use is _"non-diagnostic"_ `[mc-hrv]`.
- **Proposed contract diff (PROPOSAL ONLY).** Today `VitalReadingSchema` and
  `BridgeEventSchema` are `strictObject` and discriminated unions
  (`packages/contracts/src/models.ts:9-15`, `measurement.ts:3-25`). Adding a
  field or event type would break a v1 consumer, so HRV is opt-in under
  protocol v2:

  `docs/PRESAGE_CONTRACT.md`

  ```diff
  -# Presage bridge contract v1
  +# Presage bridge contract v2 (v1 behaviour unchanged unless a session opts in)
  @@ Reading
  +## HRV observation (v2, opt-in)
  +`{timestamp: ISO8601 UTC, windowSeconds: 60, rmssdMs: number|null, sdnnMs: number|null, meanNnMs: number|null,
  +  quality: valid|invalid|unknown, source: presage}`.
  +Emitted only for sessions started with `metrics:["hrv"]`. quality comes only from the SDK Hrv `stable` flag
  +(vendor: confidence >= 50, +/-5 ms standard); missing -> unknown. Values finite and positive when present.
  +Baevsky stress index and any other HRV-derived index are never forwarded. HRV is worker-only: never in supervisor
  +views, never in scheduling, never mixed into pulse/breathing analytics, never compared across sources.
  @@ Transport
  -GET /v1/health → {protocolVersion:1,source:"presage",status:"ready"|"unavailable",reason:string|null}
  -POST /v1/sessions {appSessionId:UUID} → 201 {bridgeSessionId:string}
  +GET /v1/health → {protocolVersion:1|2,source:"presage",status:"ready"|"unavailable",reason:string|null,
  +                  capabilities?:("hrv")[]}   (capabilities present only when protocolVersion is 2)
  +POST /v1/sessions {appSessionId:UUID, metrics?:("hrv")[]} → 201 {bridgeSessionId:string}
  +  (metrics omitted = v1 behaviour; requesting an unadvertised capability → 400 UNSUPPORTED_METRIC)
  -Data: {type:"reading",reading:VitalReading}, {type:"status",...}, {type:"error",...}.
  +Data: {type:"reading",reading:VitalReading}, {type:"hrv",hrv:HrvObservation} (opted-in sessions only),
  +      {type:"status",...}, {type:"error",...}.
  ```

  `packages/contracts/src/models.ts` and `measurement.ts`

  ```diff
  +export const HrvObservationSchema = z.strictObject({
  +  timestamp: ISO,
  +  windowSeconds: z.literal(60),
  +  rmssdMs: z.number().finite().positive().nullable(),
  +  sdnnMs: z.number().finite().positive().nullable(),
  +  meanNnMs: z.number().finite().positive().nullable(),
  +  quality: z.enum(["valid", "invalid", "unknown"]),
  +  source: SourceSchema, // mock HRV must be labelled synthetic like other mock data
  +});
   export const BridgeHealthSchema = z.strictObject({
  -  protocolVersion: z.literal(1),
  +  protocolVersion: z.union([z.literal(1), z.literal(2)]),
     source: z.literal("presage"),
     status: z.enum(["ready", "unavailable"]),
     reason: z.string().nullable(),
  +  capabilities: z.array(z.enum(["hrv"])).optional(),
   });
   export const BridgeEventSchema = z.discriminatedUnion("type", [
     z.strictObject({ type: z.literal("reading"), reading: VitalReadingSchema }),
  +  z.strictObject({ type: z.literal("hrv"), hrv: HrvObservationSchema }),
     ...
  ```

  The API also needs an `hrv_observations` table (or column set) keyed by
  session and sequence. Its exposure would be limited to worker-scoped
  endpoints. The design belongs to Developer 1 and the ML branch.

- **Bridge change:**
  - `requestedMetrics` adds `MetricType.HRV` only for opted-in sessions. HRV is
    in the same `cardioMetrics` bundle as pulse `[const:116-120]`, so it is a
    standard metric and allowed in the same session (inferred from `[obs]`,
    which rejected only strict/standard mixing).
  - `AdapterSample` gains `hrv: {rmssd, sdnn, meanNn, status} | null`, with
    status from `Hrv.stable` only.
  - De-duplicate on `Hrv.timestamp`.
  - `normalize.ts` emits a `type:"hrv"` event.
  - `src/contract.ts` mirrors the change. Health advertises `capabilities`.
  - Add a synthetic HRV fixture (labelled) and tests against the new Zod
    schemas.
  - Optionally enable `enableAccumulatedOutput` to capture the final window
    at stop, after verifying its contents on hardware.
- **Privacy impact: moderate.** HRV is more sensitive than pulse rate (it is
  widely read as a stress or health signal). Keep it local-only like the
  other real measurements, behind the existing worker consent, out of
  supervisor views (the spec already omits physiological history there), and
  out of Gemini prompts unless the worker explicitly shares. The vendor
  telemetry already excludes HRV values `[tp]`, and the bridge disables
  telemetry anyway.
- **Effort:** M for the bridge and L for the contract, API, storage and UI.
  The ML work is separate.

### R4. Talking detection as a breathing-validity hint (optional)

- **Value: medium.** Talking invalidates breathing `[mc-br]` and workers on a
  break will talk. A transient "Talking detected: breathing readings pause
  until you're quiet" status message explains invalid stretches.
- **Contract change:** none (`status.message`). Do not add a field.
- **Bridge change:**
  - Request `MetricType.TALKING` (13).
  - Read `face.talking.at(-1).detected` when `stable` `[gen:1259]`
    `[gen:122-132]`.
  - Emit a status message on change only.
  - Never forward or store the boolean itself.
  - Test with a fake module.
- **Privacy impact: low-moderate.** It enables the SDK's face-analysis group
  (face landmarks are processed on-device either way for face finding, but
  requesting face metrics should still be disclosed). It needs a consent-copy
  update.
- **Effort:** S-M. **Unverified:** whether requesting `TALKING` changes credit
  usage or entitlement. Check on hardware with `inspect:metrics --all`.

### R5. Forward vendor `confidence` as metadata (low priority)

- **Value: low-medium.** It could weight ML features, or explain why a plausible
  number is `invalid`. The vendor's own threshold (`stable`) remains the only
  validity source, so numbers never change validity (an existing invariant).
- **Contract diff (PROPOSAL):** on v2 only, add
  `confidence: z.number().min(0).max(100).nullable()` to `VitalReading` and to
  `HrvObservation`. The source is `MeasurementWithConfidence.confidence`
  `[gen:242-243]` and `Hrv.confidence` `[gen:601-602]`.
- **Bridge change:** pass it through in `MetricObservation`.
- **Privacy:** negligible. **Effort:** S (bridge) + S (contracts).
- **Risk:** a confidence number on screen invites "accuracy %" readings. Keep
  it out of the UI.

### R6. Do not adopt `pulseRateStrict` / `breathingRateStrict` (for now)

- **Why not:**
  1. The native runtime rejects mixed sessions, with the message _"strict and
     standard metrics cannot be requested in the same session. Use a separate
     session and API key for each service."_ (`kConfigurationFailed`,
     non-retryable) `[obs]`. Strict is a separate service, and SiteGuard's
     one-camera rule means a check-in could not have both.
  2. `Strict` has only `{value, timestamp}`, with no `stable` or
     `confidence` `[gen:721-728]`, so there is no per-sample validity to map.
     The bridge would have to report `unknown`, and the app excludes
     `unknown` from analytics.
  3. Its timestamp is on the session input timeline, not epoch `[gen:727]`.
  4. It is in no bundle `[const:105-140]` and absent from the public docs
     (`[nm]`, `[napi]`, `[dt]`, `[nmig]` checked).
- **If revisited:** get vendor documentation of the window and validity
  semantics plus a second key, then evaluate with `inspect:metrics --strict`.
- **Effort if adopted:** L.

### Not recommended

`arterialPressureTrace`, `baevsky`, `apnea`, `blinking`, `expression`,
`landmarks`, `eda.trace`, micromotion, and the undocumented breathing extras.
The reasons are in the §1 tables. In short, each one is a clinical-sounding
quantity, a fatigue, stress or emotion proxy, biometric face data, or has no
vendor semantics.

## 3. Data-quality guidance for demos

Vendor setup guidance `[mq]`, `[mc]`, model cards:

| Area               | Guidance                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera             | **Mount the laptop or camera on a table or stand.** It must be stationary for breathing; handheld is acceptable only for pulse, HRV and the waveform `[mq]` `[mc-br]`. Sustain about 25 fps, 30 preferred `[mq]`. The model cards ask for exposure, gain and white balance to be locked `[mc-ap]` `[mc-hrv]`                                                                     |
| Lighting           | Even, diffuse, frontal or slightly off-axis light. No strong backlight, no half-shadowed face, no flicker, and no TV or monitor as the main light. Low light drops the frame rate `[mq]`. Validation "Window" lighting had the lowest HRV return rate (68 %) `[mc-hrv]`                                                                                                          |
| Distance/frame     | Exactly one face, centred and forward-facing. **Upper chest visible** for breathing (waistline too for `lowerTrace`) `[mq]`. Breathing validation distances averaged about 36-39 in (about 0.9-1 m) `[mc-br]`, so a laptop webcam usually needs the worker sitting back                                                                                                          |
| Behaviour          | Sit still, **don't talk**, no chewing gum. Plain, lighter clothing; dark solid shirts in low light and tight stripes hurt tracking `[mq]` `[mc-br]`                                                                                                                                                                                                                              |
| SiteGuard-specific | Workers coming straight off exertion may exceed the documented pulse operating range of 40-110 BPM `[mc]` (the model card says 40-180 `[mc-ap]`). Readings above 110 are outside what the metrics page documents, so describe them, never interpret them. Hard-hat brims and safety glasses are **not covered by vendor docs**; test them with `inspect:metrics` before the demo |

**Session length.** The vendor gives no total length, only warm-up windows:
pulse 12 s, breathing 30 s, HRV 60 s, _"do not show or act on readings before
their window has elapsed"_ `[mq]`. The breathing model wants about 45 s
uninterrupted `[mc-br]`. The headless CI page suggests 30-60 s clips `[nci]`.
Recommendations:

- **Pulse + breathing, R1 applied:** 90 s. That covers about 10 s
  positioning, about 30-45 s breathing warm-up, a 15 s initial window, a gap,
  and a 15 s final window.
- **Pulse + breathing without R1:** expect breathing `insufficient_data`
  whatever the length, because the initial window falls inside warm-up.
- **With HRV (R3):** at least 90 s for one HRV value, and 150-180 s for an
  initial/final HRV pair.
- **Mock demo:** keep 60 s. It is synthetic and has no warm-up.

**`validationStatus` code → proposed SiteGuard guidance (R2).** Codes are from
`[idx:44-62]`, and meanings and advice are paraphrased from `[mq]`. The bridge
state is `positioning` for every code except `kOk`.

| Code (value)              | Vendor meaning                  | Proposed worker-facing message                             |
| ------------------------- | ------------------------------- | ---------------------------------------------------------- |
| `kOk` (0)                 | frame passes all checks         | (state `measuring`) "Hold still and stay quiet."           |
| `kNoFaceFound` (1)        | no face detected                | "We can't see a face. Sit facing the camera."              |
| `kMultipleFacesFound` (2) | more than one face              | "Only one person should be in view."                       |
| `kFaceNotCentered` (3)    | face off-centre horizontally    | "Move so your face is centred."                            |
| `kFaceSizeOutOfRange` (4) | deprecated, use 13/14           | "Adjust your distance from the camera."                    |
| `kTooDark` (5)            | under-exposed                   | "It's too dark. Add light or move somewhere brighter."     |
| `kTooBright` (6)          | over-exposed or backlit         | "Too bright. Avoid light behind you."                      |
| `kChestNotVisible` (7)    | chest not visible or too far    | "Sit back a little so your upper chest is visible."        |
| `kCameraTuning` (10)      | camera adjusting exposure/focus | "Camera is adjusting. One moment."                         |
| `kFrameRateTooLow` (11)   | frame rate too low              | "Camera is running slowly. Add light or close other apps." |
| `kExcessiveMotion` (12)   | too much motion                 | "Please hold still."                                       |
| `kFaceTooClose` (13)      | face too large                  | "Move back from the camera."                               |
| `kFaceTooFar` (14)        | face too small                  | "Move closer to the camera."                               |
| `kFaceTooHigh` (15)       | face too high in frame          | "Move down a little, or tilt the camera up."               |
| `kFaceTooLow` (16)        | face too low in frame           | "Move up a little, or tilt the camera down."               |
| `kFaceNotForward` (17)    | face turned or tilted           | "Face the camera directly."                                |
| other / unknown           | n/a                             | the vendor `hint` text (current behaviour)                 |

Treat `stable: false` after warm-up as "conditions currently degraded" `[mq]`.
The bridge already maps it to `invalid`.

## 4. Risks and limits

- **Not clinical.** The vendor states the metrics are _"for general wellness
  and informational purposes only"_, _"have not been cleared by the FDA"_, and
  _"may not be used for medical diagnosis or treatment"_ `[mc]`. The model
  cards add _"not intended for human life-critical decisions, diagnostics or
  prognostication"_ `[mc-hrv]` `[mc-ap]`. This matches SiteGuard's
  boundaries. Never present Presage output as clearance, fatigue or risk.
- **Accuracy is conditional.**
  - The headline numbers are at confidence ≥ 79 or ≥ 97, keeping about 80 %
    of samples. Unfiltered error is roughly double: pulse MAE 0.93 BPM,
    breathing MAE 0.70 br/min, RMSSD MAE 14.28 ms `[mc-ap]` `[mc-br]`
    `[mc-hrv]`.
  - Validation was in a lab: ring light, lamp or window lighting, and
    stationary subjects. The breathing set used a ring light for every video
    `[mc-br]`.
  - Large motion, gum and flicker _"may produce inaccurate measurements with
    high confidence"_ `[mc]`, so `stable` is not proof of correctness.
  - Return rates drop sharply for some groups: Fitzpatrick VI pulse 44.9 %,
    age 65+ 15.4 % (N = 61) `[mc-ap]`.
  - The SiteGuard implication: `insufficient_data` must stay neutral, and it
    is not evidence about the worker.
- **Telemetry and network.**
  - Telemetry is on by default. It sends one aggregate summary per session
    and never frames, metric values, file paths or identifiers `[tp]`. The
    bridge and the inspector both pass `enableTelemetry: false`
    `[idx:137-138]`.
  - Even with telemetry off, the SDK needs the network for key and usage
    validation. There is _"No offline mode"_ `[nci]`, and usage entitlement
    is rechecked _"throughout a measurement"_ `[nmig]`.
  - **Observed (local run):** with telemetry off, the SDK also attempted
    `POST /device/pair` ("Device key provisioning ... Remote EMD model
    delivery") and a usage-verification call `[obs]`. The telemetry page does
    not describe device pairing `[tp]`, so ask Presage what `/device/pair`
    sends before claiming "no device identifiers leave the laptop".
- **Subscription and credits.**
  - Errors: `kCreditExhausted` means _"an explicit quota denial"_,
    `kAuthenticationFailed` means rejected credentials, and `kNetworkError`
    means _"entitlement cannot be refreshed in time"_ `[nmig]`.
  - Short measurements and the final partial interval before `stop()` count
    toward usage `[nmig]`. Every demo rehearsal and every `inspect:metrics`
    run spends quota.
  - Strict appears to need a separate key or service `[obs]`.
  - The hackathon key's limits are still unknown (existing TODO in the bridge
    README).
- **Platforms.** Supported: macOS Apple Silicon, Linux x64/arm64 with glibc ≥
  2.35, and Windows x64 `[node]` `[sdkreadme:48-55]`. There is no Intel Mac
  build. Node ≥ 20 is required, 24 recommended `[node]`. `npm install` pulls
  every platform's runtime, a few hundred MB `[node]`. On Windows,
  `CameraSelection.front/back` fail with `kInputUnavailable`
  `[sdkreadme:165-167]`; the bridge uses `default`. **Observed:** the linux-x64
  runtime loads and builds its graph in this sandbox `[obs]`.
- **Docs and package disagreements.** The CI page says the root
  `decodeMetrics` returns a raw Buffer unless `setMetricsClass()` is called
  `[nci]`. The installed 3.4.0 package registers the bundled class eagerly
  `[ijs:26-31]`, so the bridge's root-import usage is correct for the pinned
  version. Re-check on any upgrade. The pulse operating range is 40-110 on
  `[mc]` but 40-180 on `[mc-ap]`.

## 5. Suggested order

1. R1 (Developer 1, spec and analytics) and R2 (Developer 2, bridge). Both are
   small with no contract change, and they decide whether real-Presage
   summaries work at all.
2. On the demo Mac, with the key, run `inspect:metrics` on camera (and on a
   recorded clip) to confirm the warm-up and first-stable times, and whether
   HRV populates in a 90 s session.
3. R3 (HRV, v2 contract) only if step 2 shows usable HRV, and only with the ML
   branch agreeing to the worker-only and non-score constraints.
4. R4 and R5 are optional. Revisit R6 only with vendor documentation.

## 6. `npm run inspect:metrics` (implemented, opt-in debug tool)

Location: `integrations/presage-bridge/src/inspect.ts`,
`scripts/inspect-metrics.ts`, `test/inspect.test.ts`.

```sh
cd integrations/presage-bridge
SMARTSPECTRA_API_KEY=... npm run inspect:metrics -- --file clip.mp4      # useFile, ~real-time playback
SMARTSPECTRA_API_KEY=... npm run inspect:metrics -- --camera --max-seconds 120
SMARTSPECTRA_API_KEY=... npm run inspect:metrics -- --camera --all        # + face/eda/micromotion
SMARTSPECTRA_API_KEY=... npm run inspect:metrics -- --camera --strict     # strict-only session
```

What it does:

- Requests the cardio and breathing bundles, plus face, EDA and micromotion
  with `--all`, or only codes 18 and 19 with `--strict`.
- Prints validation-code changes and errors. For each packet whose field set
  changed (every packet with `--verbose`), it prints each populated field with
  its sample count, `stable` count and latest `confidence`.
- At the end it prints a summary: packets per field, the first-seen offset,
  and the first-stable offset.
- It **never prints or writes metric values, frames or footage**, and
  telemetry is off.
- Exit codes: 0 when packets were seen, 1 when the run failed or no packets
  arrived, 2 for usage errors or a missing key.
- File mode defaults to `interframeDelayMs: 33` `[idx:146]`, so offsets
  roughly track content time. Pass `--interframe-ms 0` for fastest playback.

**Not run against a real session.** There is no API key or camera here. With
a fake key and Presage network blocked by the sandbox proxy, the real native
runtime gave these results `[obs]`:

- Mixed strict and standard request: `kConfigurationFailed`
  (`retryable=false`), with the native log line quoted in R6. The inspector
  was then changed so `--strict` is a separate mode.
- Standard request on a missing file: device pairing and usage verification
  failed at the network level, then `kInputUnavailable` (`retryable=true`).
  Exit code 1.
- Strict-only request on a missing file: `kInputUnavailable`. Exit code 1.

These runs say nothing about metric output. They only show that the runtime
loads, validates the metric combination and reports input errors.
