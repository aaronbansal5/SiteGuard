# Personal recovery model (experimental, worker-only)

Two small, per-worker statistical features that describe a worker's check-ins **compared with their own past sessions**. They are shown only to that worker, labeled "Experimental · compares only with your own past sessions · not medical advice", and never sent to supervisors, Gemini, scheduling or approvals.

Implementation: `apps/api/src/domain/personal-math.ts` (statistics), `apps/api/src/domain/personal.ts` (models and loading), constants in `PERSONAL_MODEL` (`packages/contracts/src/personal.ts`), UI in `apps/web/src/components/PersonalInsights.tsx`. No new dependencies; all math is implemented in the repository and unit tested (`apps/api/test/personal-math.test.ts`).

## What it is not

- Not a diagnosis, fatigue/risk/safety/recovery score, medical clearance or fitness-for-work signal.
- Not a statement about medically optimal rest or any clinical threshold. Every threshold below is a data-sufficiency or display rule chosen for this demo, not clinically validated.
- Not a population model: nothing is learned across workers.
- Not used by scheduling, approvals, coverage planning, the supervisor overview, session sharing or explanations.

## Features (per session)

Reuses the existing summary rules in `docs/PROJECT_SPEC.md` (Analytics): only `quality=valid`, non-null readings; initial window = 15 s from that metric's first valid reading (equal to the first 15 s for mock), final window = last 15 s; duration ≥ 45 s from the first valid reading; ≥ 5 readings spanning ≥ 5 s per window; medians; `delta = final − initial`.

- `pulse` = pulse delta (bpm), or unavailable.
- `breathing` = breathing-rate delta (brpm), or unavailable.

A more negative delta means the reading came down further during the break ("settled more").

## Eligible history

Same worker, **same source** (mock and presage are never mixed), `status=completed`, ended at or before the current session started, started within the last 90 days. Most recent first; at most 40 sessions are read. Unlike the contextual comparison in the session summary, workload and temperature band are not matched (see Limitations).

## Feature 1 — personal recovery baseline and trend

**Robust baseline.** For each metric, take that metric's values from up to the 20 most recent eligible prior sessions where it is available.

| Constant              | Value                           | Meaning                                                                |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `baselineMinSessions` | 5                               | Fewer prior values → `insufficient_data` (`not_enough_prior_sessions`) |
| `baselineMaxSessions` | 20                              | Most recent prior values used                                          |
| `baselineMaxAgeDays`  | 90                              | Older sessions ignored                                                 |
| `madConsistency`      | 1.4826                          | Scales MAD to a standard-deviation-like spread                         |
| `minScale`            | pulse 1 bpm, breathing 0.5 brpm | Floor on the robust scale                                              |
| `zThreshold`          | 2                               | Display threshold                                                      |

`median`, `MAD = median(|x − median|)`, `scale = max(1.4826·MAD, minScale)`, `z = (current − median) / scale`.

- `|z| ≤ 2` → `within_usual` ("within your usual range")
- `z < −2` → `settled_more` ("your pulse settled more than your usual")
- `z > 2` → `settled_less` ("your pulse settled less than your usual")

If the current session's metric is unavailable: `insufficient_data` (`current_session_unavailable`). The floor stops near-identical histories (MAD ≈ 0) from turning tiny differences into large z values.

**Trend.** Theil–Sen slope (median of pairwise slopes) of the metric over the most recent `trendWindow = 8` sessions with that metric available, oldest first, x = session order (including the current session on the summary page). Needs `trendMinSessions = 5`, otherwise `insufficient_data` (`not_enough_sessions`). Direction: if `|slope × (n − 1)| < max(1.4826·MAD(values), minScale)` → `steady` ("settling by about the same amount"); negative → `settling_more`; positive → `settling_less`. Shown as "Your recent sessions show …".

## Feature 2 — voluntary tiredness self-report and personal estimate

**Self-report.** After a check-in is completed the worker may answer "How tired do you feel?" on 1–5 (optional, changeable, removable). Stored in `self_reports` (one per session, `origin: "worker"`). Seeded demo ratings have `origin: "synthetic"` and are labeled in the UI.

**Model.** Per-worker ridge regression from `[pulse delta, breathing delta]` to the worker's own ratings, trained on eligible prior sessions that have both features and a rating (most recent 40; the current session's own rating is never used to estimate itself).

| Constant                | Value | Meaning                                                           |
| ----------------------- | ----- | ----------------------------------------------------------------- |
| `selfReportMinSessions` | 8     | Fewer labeled sessions → `not_enough_labeled_sessions`            |
| `selfReportMaxSessions` | 40    | Most recent labeled sessions used                                 |
| `ridgeLambda`           | 1     | Penalty on standardized features; intercept unpenalized           |
| `maeBound`              | 0.75  | Maximum leave-one-out MAE (rating points) for showing an estimate |

Closed form on standardized features `Z` (population mean/SD of the training rows; zero-spread features get scale 1 and therefore coefficient 0): `β = (ZᵀZ + λI)⁻¹ Zᵀ(y − ȳ)`, intercept `ȳ`, solved by Gaussian elimination with partial pivoting. Predictions are clamped to [1, 5].

**Honesty gates**, in order:

1. Fewer than 8 labeled sessions → `not_enough_labeled_sessions`.
2. Current session lacks either feature → `current_session_unavailable`.
3. All ratings identical → `ratings_do_not_vary`.
4. Leave-one-out MAE (refit without each labeled session) must be `≤ 0.75` **and** strictly lower than the leave-one-out MAE of simply predicting the worker's own average rating; otherwise `estimate_not_reliable` (the MAE is still reported).

When available, the UI shows "Experimental estimate of how you might rate your tiredness: about 3.4 — likely between 3 and 4", with "typical error ±MAE (leave-one-out)" and how many of the worker's own rated sessions it learned from. It never shows a label such as "high", "risk" or "fatigued".

## Privacy and visibility

- Endpoints (`docs/API_CONTRACT.md`) call `worker()`; any supervisor identity gets 403, **even for sessions the worker shared**. Another worker gets 403.
- Not included in `Summary`, `Session`, history rows, `/supervisor/overview`, `/rest-requests`, schedule endpoints, or `/insights/explain` facts (so never sent to Gemini). Tests assert supervisor responses contain none of these fields (`apps/api/test/personal-api.test.ts`, `tests/integration/personal-insights.spec.ts`).
- Self-reports are the worker's data; `demo:reset` deletes them with the rest of the synthetic demo data.

## Demo data

The seed keeps the original four heavy/26 °C synthetic sessions per worker (so the contextual summary comparison still uses four) and adds eight older moderate/18 °C synthetic sessions per worker with deterministically varied settling speed, plus synthetic self-reports derived from a made-up relationship. With these, both features return `available` for the most recent seeded session of each of the six demo workers and for a new 60-second mock check-in by W-01 (checked in tests); all of it is labeled synthetic. A real Presage history starts empty and shows `insufficient_data` until enough Presage sessions exist.

## Limitations

- Small samples: 5–20 sessions give rough baselines; a single unusual day shifts the median little but can change classification near the threshold.
- Context is not matched: different workloads/temperatures are pooled in the baseline, so a "settled less than usual" may reflect a harder task rather than anything about the person.
- Deltas depend on break length and measurement quality; the existing window/quality rules reduce but do not remove this.
- Self-reports are subjective and may drift; the regression has two features and can only find a linear relationship. Leave-one-out MAE on ≤ 40 points is itself noisy.
- Synthetic demo ratings were generated from the synthetic deltas, so the demo estimate looks better than real data would.
