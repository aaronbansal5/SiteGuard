# Research rest-support implementation review

Reviewed the shared working tree based on `main` at `9825925`, including uncommitted research, route, test, and UI changes. Concurrent edits were observed; findings below use the final files read during this review. This is a local static source review, not clinical validation or a live integration certification. No credentials, environment files, database contents, network calls, camera sessions, downloads, or external services were accessed. Only this document was changed by the reviewer. Tests were inspected but not executed; checklist boxes are pending checks, not reported passes.

## Current behavior and boundaries

`apps/api/src/research/rest-support.ts` implements a deterministic, untrained descriptive rule, version `rest-support-descriptive-v1`. It uses initial/final pulse and breathing medians and historical median changes. It returns three possible signals, `confidence: null`, unquantified uncertainty, structured evidence, and an explicit experimental disclaimer. It does not contain a downloaded model, training process, validated fatigue label, calibrated probability, or medically established rest threshold.

`GET /api/sessions/:id/rest-support` uses `ownSession()` and requires completion (`apps/api/src/routes.ts:345`). Supervisors are rejected even when a session is shared; other workers are rejected. The response contains derived physiological measurements but no worker/session IDs, names, symptom notes, or footage. The GET handler computes a result without updating breaks or requests. The UI renders the card only for the owning worker (`apps/web/src/pages/SessionSummary.tsx`, `ResearchRestSupportCard`).

These are useful safeguards, not evidence of authenticated real-world identity, clinical validity, or an end-to-end demo pass.

## Findings

Priority definitions: P1 requires resolution or an explicit demo restriction before demonstrating the affected path; P2 requires wording or correctness follow-up and accurate presentation.

### R1 — P1: Demo identity selection can expose another worker's private research data

Evidence: `apps/api/src/routes.ts:164` exposes the roster in demo mode; `:168` issues a worker cookie for a submitted existing worker ID without checking ownership credentials. `apps/api/src/auth.ts:4` validates the signed cookie and expiry, not the person's identity. Research authorization checks the resulting role/worker ID correctly, but anyone able to use demo login can select the owner of a real session.

Impact: “Private to you” and owner-only checks do not establish privacy between people when real Presage sessions coexist with open demo-role selection. Session-summary links/history make discovering records possible after selecting that worker. This is a deployment boundary, not a missing supervisor-role check in the research route.

Recommendation: demonstrate publicly with fictional synthetic records only. Restrict any voluntary real-camera experiment to a controlled local instance; do not expose that instance to other demo participants. Require real identity verification before deploying with personal physiological history. A future production-auth review is separate from this document.

### R2 — P1: Prior workload/environment context is silently presented as current

Evidence: `apps/web/src/pages/CheckIn.tsx:105` submits both context fields as null. `apps/api/src/routes.ts:227` copies context from the latest completed same-worker/source session when both are omitted, with no age bound or provenance marker. `apps/api/src/domain/analytics.ts:92` uses those values to establish historical comparability. The summary displays workload and temperature as session context, without identifying them as inherited.

Example: a previous heavy-workload/26 °C session can cause today's unknown context to be treated as heavy/26 °C. The research rule sees populated fields and cannot warn that the current environment was never recorded.

Impact: an apparently evidence-backed rest prompt can be built on an unverified context match. Camera observations do not establish workload or ambient temperature. Removing questions does not justify treating old values as new measurements.

Recommendation: preserve unknown context, or explicitly represent inherited context with origin/time and restrict claims of comparability. Keep context questions optional. For a demo using the current code, describe copied values as fixture/prior-session context, never as camera-measured temperature or verified current conditions.

### R3 — P1: Camera capture can outlive navigation or an upload failure

Evidence: `apps/web/src/pages/Measurement.tsx:106` awaits `getUserMedia`; if cleanup ran while permission was pending, `:115` returns when `stopped` is true without stopping the newly acquired stream. Cleanup at `:125` could already have run while `media` was undefined. Separately, upload failures call `fail()` (`:95`), which marks the camera inactive but does not stop tracks; the `finally` block at `:99` keeps scheduling capture while the component remains mounted.

Impact: late permission approval after leaving the page can leave an acquired camera stream alive. A failed upload can hide the active-capture state while repeated frame capture/upload attempts continue. This conflicts with the check-in promise that a worker can stop at any time and weakens the live indicator's accuracy.

Recommendation: stop newly acquired tracks on the late-permission branch; explicitly define whether errors stop capture or retry, and show the actual capture state throughout. Before a live-camera demo, manually exercise both cases and confirm the hardware/browser camera indicator goes off when expected. This review did not operate the camera or verify media retention outside this path.

### R4 — P2: “No additional rest-support signal” can imply no additional rest is needed

Evidence: `apps/api/src/research/rest-support.ts`, `evaluateRestSupport()`, emits `no_additional_signal` when both measured deltas are negative and no greater than the historical medians. `apps/web/src/pages/SessionSummary.tsx:196` labels it “No additional rest-support signal.” The adjacent sentence says it does not determine rest needs/readiness, and the full disclaimer is now rendered; these reduce, but do not remove, interpretation risk.

Impact: in a rest-decision card, absence of a signal can read as permission to skip rest. The calculation omits symptoms, sensor-error estimates, within-window variation, and causal factors. A tiny difference around the historical median can change the category; no clinically validated decision boundary or calibrated confidence exists.

Recommendation: use descriptive labels for the observations and keep worker choice beside every result. Example wording:

| Result                     | Suggested wording                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `consider_additional_rest` | Both changes were less negative than the historical medians. You may request additional rest based on how you feel.           |
| `no_additional_signal`     | Both changes decreased at least as much as the historical medians. This comparison does not establish how much rest you need. |
| `insufficient_evidence`    | These observations do not support a consistent comparison. You can still request rest or assistance.                          |

Do not present any state as “recovered,” “safe to work,” “fit to return,” “no break needed,” or a medically optimal rest duration. Do not add a green clearance badge or gate assistance on the result.

### R5 — P2: One reason describes a decrease even when both rates increased

Evidence: in `evaluateRestSupport()`, the `consider_additional_rest` branch checks negative historical deltas and positive differences from history, but does not require current deltas to be negative. It appends “Both measured changes decreased less than their historical median changes.”

Example: current pulse change +2 against historical −10 and breathing change +1 against historical −2 meets the branch; both current measurements increased, rather than decreased.

Recommendation: state “Both changes were more positive than their historical median changes,” or render the signed numerical comparison explicitly. Include increasing, unchanged, and decreasing examples when checking the explanation; a rest prompt must not misdescribe its evidence.

### R6 — P2: “Uncertainty is higher” suggests a quantified comparison that does not exist

Evidence: `extractRestSupportFeatures()` records “Workload/environment context was not recorded; uncertainty is higher.” `evaluateRestSupport()` filters that issue out of the blocking conditions by string prefix, while the output declares `uncertainty.level: "unquantified"` and `confidence: null`. Normal analytics still withholds historical comparisons for missing context, so those cases ordinarily abstain because history is unavailable.

Impact: the model cannot quantify an increase in uncertainty. The softened context gate and canonical missing-context history rule also express different assumptions; a hand-constructed Summary with available comparisons and null context can receive a directional signal without verified comparability.

Recommendation: say “Workload/environment context was not recorded; comparability cannot be established.” Define context eligibility in a typed contract rather than using prose prefixes to control abstention. Keep predictive confidence unavailable until labeled validation supports a meaningful interpretation.

### R7 — P1: Gemini receives derived physiological facts, and does not yet explain the private research result

Evidence: `apps/api/src/routes.ts`, session branch of `/api/insights/explain`, calls `sessionFacts(summary)` only. `apps/api/src/insights/explain.ts:15` includes the numerical pulse/breathing deltas, and `:24` includes historical median deltas and counts. `:160` sends these fact strings to the provider. IDs, names, symptom notes, frame data, and raw reading series are not included in that request. Nevertheless, derived physiological facts remain sensitive; removing names does not establish anonymity.

The research endpoint calls no provider. Its private signal, structured evidence, disclaimer, and uncertainty are not part of the current Gemini request. Existing shared-session explanations are available to supervisors through `access()`. The inspected research API test explicitly expects shared explanations to omit research result fields.

Impact: presenting “Gemini explains the research estimate” overstates the implemented path. Extending the existing shared explanation route without a worker-only boundary could leak a result that the research route intentionally protects. Consent copy describes recording and optional supervisor sharing, but does not explicitly describe sending derived physiological facts to Gemini.

Recommendation: describe today's Gemini feature as selection/order of approved observation facts. Explain provider transfer before using real personal measurements with it. If research explanation is added, authorize the owner separately, allowlist the minimal approved facts, preserve every uncertainty/disclaimer fact, and keep research results out of supervisor/shared-summary routes. Continue displaying truthful provider/fallback origin. No provider availability or key/model validity was checked in this review.

### R8 — P2: Adjacent tiredness UI overstates the statistical range

Evidence: `apps/web/src/components/PersonalInsights.tsx:164` says “likely between” the lower and upper estimates, while `:169` calls leave-one-out mean absolute error “typical error ±…”. `apps/api/src/domain/personal.ts:183` constructs the range by rounding/clamping prediction ± MAE. This is a separate per-worker ridge regression, not the new descriptive rest-support rule.

Impact: prediction ± average absolute error is not a calibrated prediction interval with demonstrated coverage. On the same page as rest support, a numerical tiredness estimate can be mistaken for an objective fatigue assessment. Synthetic demo labels derived from the same synthetic measurements cannot validate real-world performance.

Recommendation: label the range as an illustrative span based on historical validation error; avoid “likely” or a probability claim without calibration. Say it estimates the worker's own rating, with the experimental and synthetic labels visible. Never equate it with physiological fatigue, work readiness, or rest entitlement.

### R9 — P2: Research validation rejects legitimate rounded analytics outputs

Evidence: `apps/api/src/domain/analytics.ts:54` rounds delta to two decimals, leaving medians unrounded. `apps/api/src/research/rest-support.ts:69` requires `final − initial` to equal delta within approximately 1e−9.

Example: initial 100.123 and final 95.456 yield a canonical rounded delta of −4.67; the unrounded difference is −4.667. The research extractor rejects this as inconsistent. This is a conservative false abstention, not clearance, but it undermines a live fractional-reading demo and mislabels valid evidence.

Recommendation: align the consistency check with the canonical rounding rule; test fractional medians alongside integer fixtures. An unavailable estimate must remain an explicit unavailable state rather than being replaced with a reassuring signal.

### R10 — P2: The new offline trainer validates declarations, not data provenance or medical targets

Evidence: `scripts/research/train.py` appeared in the shared tree during review. It fits a separate logistic baseline for an observed self-reported rest request, uses participant-separated validation and train-only scaling, rejects synthetic/source-mismatched rows, and writes aggregate reports and coefficients without exporting row IDs. It explicitly sets `runtime_ready: false`, null confidence, and uncalibrated uncertainty. It is not wired to the app's descriptive rule, and no training run/artifact was verified here.

Limitations: checking `consent_granted=true`, `data_kind=real`, and pseudonymous-token syntax cannot verify genuine consent, lawful dataset access, or that a token is not a person's actual name. The CSV supplies historical features but lacks the contributing history timestamps/identities, so the trainer cannot prove these features exclude future or validation-participant information. There is one validation partition, no independent test set or calibration procedure. A label of no rest request can reflect reporting preferences or workplace pressure rather than absence of a need for rest.

Recommendation: retain provenance/consent records separately and restrict access to source CSVs and trained artifacts. Independently audit feature construction before training and freeze an external test/calibration plan before claiming generalization. Describe the target as observed request behavior, never actual rest need, fatigue, or clearance. The minimum row/participant counts are computational gates, not proof of scientific adequacy; accuracy on the single validation split does not establish clinical validity. Do not present this script as an already trained model running in the UI.

## Safeguards observed and integration status

- The model's confidence stays null, and the latest UI accepts only null confidence and an allowlisted signal. It displays “Not available” and says predictive confidence has not been validated with labeled data.
- The latest UI now validates nested uncertainty/evidence, checks response source against session source, displays numerical evidence, and renders the full disclaimer. An earlier response-shape mismatch observed during this review was corrected by concurrent edits; it is not a current open finding. A browser pass is still needed.
- The research handler is worker-only even with sharing enabled. No research-result persistence, network inference, scheduler mutation, or request approval was found in that handler.
- Canonical analytics filters quality per metric and matches same worker/source/context; synthetic and Presage history remain separate. A real source without adequate eligible history should abstain.
- Help actions remain outside research inference and available independently of the signal. The new research card explicitly preserves scheduled breaks and worker choice.
- `apps/api/test/research-rest-support.test.ts` and `research-rest-support-api.test.ts` contain fixtures for invalid/insufficient input, owner access, supervisor rejection, synthetic labeling, no external inference, no schedule mutations, and shared-response exclusions. Presence of tests is not a passing test result; no tests were run here.
- The UI currently imports research types from the API source, and the canonical API document does not yet specify the new route/result. A shared, runtime-validated contract and documentation update would reduce further drift; neither was changed in this review.

## Demo checklist

All items below are pending acceptance checks. External/provider checks must be performed separately by the demo owner; this review makes no network calls.

- [ ] Use fictional synthetic records in any public/shared demo. Keep voluntary real-camera experiments on a restricted local instance while demo login remains selectable.
- [ ] Rebuild the exact checkout used for the demo and open a completed owning-worker summary; verify the research card renders the actual endpoint response rather than its unavailable fallback.
- [ ] Show all three states with clearly labeled synthetic fixtures: a descriptive rest prompt, the historical-comparison/no-additional-signal state, and insufficient evidence. Keep evidence, uncertainty, null confidence, version, and disclaimer visible.
- [ ] Include positive current deltas against negative historical deltas. Verify wording accurately describes increases and does not say both readings decreased.
- [ ] Exercise fractional medians and their rounded deltas. Verify any false abstention is resolved or disclosed rather than replaced with an invented prediction.
- [ ] Show no history, fewer than three eligible priors, missing context, one unavailable metric, mixed directions, and a short/poor-quality session. None may imply safety, danger, or clearance from missing data.
- [ ] Verify same-worker/source history boundaries. Do not show synthetic history as a real Presage baseline. Identify inherited context explicitly; do not claim current temperature/workload was measured by the camera.
- [ ] Check owner access, another-worker rejection, supervisor rejection with sharing both on and off, unauthenticated rejection, and active-session rejection. Inspect denied bodies for absence of research evidence.
- [ ] Verify shared summaries, shared explanations, supervisor views, schedules, and request records do not include the private research result or self-report prediction.
- [ ] Leave “Request additional rest” and symptom/assistance actions available for every signal and on loading/error. Confirm no model action creates approval, suppresses a request, shortens a protected break, or resolves assistance.
- [ ] In a separately authorized camera check: deny permission; navigate away before approving permission; stop the session; navigate away during capture; cause a frame-upload failure. Confirm capture/indicator state matches reality and camera tracks stop when intended. Do not record faces or export frame-bearing debug artifacts.
- [ ] Before a real-data provider demo, explain that Gemini receives derived numerical physiological facts. Inspect a local stub/captured fixture request for absence of IDs, names, symptom notes, raw series, footage, and secrets; do not export personal payloads.
- [ ] Present Gemini as observation-fact selection until a separately authorized owner-only research explanation path exists. Show provider/fallback origin accurately; a configured key or cached result alone is not proof of a fresh live response.
- [ ] Exercise provider unavailability using an offline stub. Deterministic facts, research evidence, and help actions must remain usable; never fabricate a Gemini response.
- [ ] Present the personal tiredness estimate as an experimental guess of the worker's own rating, separate from research rest support. Do not claim a calibrated confidence interval or clinical validation from the synthetic demo.
- [ ] If showing the offline trainer, identify its separate request-behavior target and `runtime_ready: false`. Do not display personal CSV rows, claim an unexecuted training run, or call validation accuracy a rest-need probability. Check consent provenance and historical-feature timing separately before using real training data.
- [ ] Keep environment files, bearer tokens, database credentials, provider keys, personal histories, and camera imagery off the projector and out of logs/screenshots shared with judges.

Suggested presenter wording: “This experimental rule compares pulse and breathing changes with the worker's own eligible history. It shows the evidence and unquantified uncertainty. The worker can request rest or assistance independently, and protected breaks remain intact. Gemini currently selects approved observation facts; this descriptive rule has no validated predictive accuracy.”

Current review disposition: suitable for presenting the architecture and clearly labeled synthetic behavior after local acceptance checks; not evidence that a live camera/provider demo has passed, or that personal-data deployment, fatigue prediction, or work-clearance claims are supported. Resolve or explicitly restrict the P1 paths before demonstrating them.
