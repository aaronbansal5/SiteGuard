# Local research training scaffold

`scripts/research/train.py` is an offline, Python-standard-library logistic regression baseline for studying **self-reported requests for additional rest**. Python 3.10+ is required. It reads an explicitly supplied local CSV, validates every row, holds out entire participants, and optionally writes a research model and evaluation report. It performs no downloads, label generation, database access, Gemini calls, or application integration. API keys are not training inputs.

The target is the worker's observed response to “Do you want additional rest now?” after completing a check-in, collected before showing any model guidance. A `0` means they answered no; it does not establish that they need no rest or are ready for work. This scaffold does not estimate medical fatigue. All artifacts carry “Experimental research estimate — not medical advice or work clearance,” `runtime_ready: false`, and `confidence: null` because scores are uncalibrated.

## Data collection and CSV schema

Supply only consented, real, labeled records with documented research-use permission. Use pseudonymous IDs; retain consent records and the identity mapping separately under appropriate access controls. Do not include names, emails, footage, API keys, or free text. Research consent must cover use of measurements, prior check-ins, and the response label; a camera checkbox alone does not establish permission for this research use.

Each row represents one completed Presage session. All fields below are required; header order is flexible, duplicate or extra columns are rejected, and empty values are rejected. Numbers must be finite; numeric magnitudes are capped at 1,000,000 as a computational guard, not a medical threshold. IDs allow 1–80 ASCII letters, numbers, underscores, or hyphens.

| Field                             | Meaning / validation                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `participant_id`                  | Stable pseudonymous participant token; all sessions for this participant stay in one split.                         |
| `session_id`                      | Unique pseudonymous session token; duplicates are rejected.                                                         |
| `consent_record_id`               | Token referencing a separately retained research consent record.                                                    |
| `consent_granted`                 | Exactly `true`; revoked or absent consent is rejected.                                                              |
| `data_kind`                       | Exactly `real`; synthetic or demo rows are rejected.                                                                |
| `measurement_source`              | Exactly `presage`; mock readings are rejected.                                                                      |
| `label_source`                    | Exactly `self_report`; no model-derived or inferred labels.                                                         |
| `collected_at`                    | Session completion timestamp, ISO 8601 with timezone.                                                               |
| `label_collected_at`              | Response timestamp with timezone, at or after session completion.                                                   |
| `pulse_initial_bpm`               | Positive median of the valid initial pulse window.                                                                  |
| `pulse_final_bpm`                 | Positive median of the valid final pulse window.                                                                    |
| `breathing_initial_brpm`          | Positive median of the valid initial breathing window.                                                              |
| `breathing_final_brpm`            | Positive median of the valid final breathing window.                                                                |
| `pulse_historical_delta_bpm`      | Median pulse change from eligible prior real check-ins, in BPM.                                                     |
| `breathing_historical_delta_brpm` | Median breathing change from eligible prior real check-ins, in breaths/minute.                                      |
| `history_count`                   | Integer 3–1,000,000; number of prior eligible sessions with both metrics available.                                 |
| `duration_seconds`                | Session duration, at least 45 seconds to support separate windows.                                                  |
| `requested_additional_rest`       | Observed self-report: exactly `1` (yes) or `0` (no). Never infer a missing response from absence of a rest request. |

The exporter must apply the application's valid-reading/window rules and use only **earlier** history from the same worker, source, and eligible context. Do not include outcomes, future sessions, label-derived summaries, or readings from other participants in features. Historical counts and medians cannot be independently audited from this aggregate CSV. Likewise, `true` and `real` are declarations: the script cannot authenticate consent, provenance, or whether labels came from genuine observations. Verify these against collection records before use; do not relabel synthetic fixtures as real data.

No dataset is bundled. Keep private datasets and outputs in the already Git-ignored `.data/research/` directory. The script neither exports app data nor creates a dataset for you.

## Sandbox-only synthetic demo

For a UI or pipeline rehearsal only, generate and train the explicitly synthetic demo artifact:

```bash
python3 scripts/research/generate_demo.py
python3 scripts/research/train.py \
  --dataset .data/research/synthetic_demo.csv \
  --allow-synthetic-demo \
  --output .data/research/artifacts/demo-run-001
```

This writes `data_kind=synthetic`, `label_source=synthetic_demo`, `runtime_ready=false`, and `confidence=null`. The artifact must never be loaded into the application or described as evidence from real participants. The very high demo metrics are expected from the constructed sandbox pattern and are not scientific validation.

## Validate without training

From the SiteGuard repository root:

```bash
python3 scripts/research/train.py \
  --dataset .data/research/consented_sessions.csv \
  --seed 20261011 \
  --validation-fraction 0.2 \
  --dry-run
```

A successful dry run prints aggregate row/participant/class counts, the split configuration, dataset SHA-256, and `status: validated_only`. It trains nothing and writes nothing, even when `--output` is supplied. Invalid or absent data returns exit code **2** and produces no model. Omitting `--dataset` also fails; there is no automatic fixture, database, or synthetic fallback.

At least 20 labeled sessions from 10 distinct participants are required. Both train and validation partitions must contain both observed classes. These minimums exercise the scaffold; they do not establish statistical adequacy, generalization, or scientific validation.

Participants are ranked by SHA-256 of `seed:participant_id`; the first `ceil(participants × validation_fraction)` participants (at least two) enter validation. The allowed fraction is 0.1–0.4. Remaining participants enter training. Sessions are sorted by session ID so CSV row order does not affect fitting or splitting. A single-class split fails closed. Choose the seed and fraction before evaluation; do not try multiple seeds to obtain a favorable score. Stable IDs are essential; renaming participants changes the split.

## Train a research baseline

After obtaining and validating the real dataset:

```bash
python3 scripts/research/train.py \
  --dataset .data/research/consented_sessions.csv \
  --seed 20261011 \
  --validation-fraction 0.2 \
  --epochs 500 \
  --learning-rate 0.05 \
  --l2 0.01 \
  --output .data/research/artifacts/run-001
```

The output directory must be new; existing artifacts are never overwritten. Validation and numerical serialization finish before output creation. Failed artifact writes clean up the files created by that attempt. Nothing is loaded into SiteGuard's application runtime.

The eight ordered features are initial pulse, pulse change (`final - initial`), initial breathing, breathing change, pulse change minus its historical median change, breathing change minus its historical median change, history count, and duration. Means and population standard deviations are fitted **only on training rows**; constant features use scale 1. The model fits a regularized logistic baseline with zero initialization and deterministic full-batch gradient descent. No cross-validation tuning, calibration, or deployment occurs.

Two JSON files are produced:

- `model.json`: ordered feature names, training-only normalization, coefficients, intercept, and report metadata.
- `report.json`: schema/model versions, raw CSV SHA-256, Python version, hyperparameters, split counts, validation log loss, Brier score, accuracy at 0.5, and a constant-probability baseline using training label prevalence. No participant IDs, per-session predictions, or raw rows are written.

With unchanged CSV bytes, parameters, script, and Python environment, results are reproducible. Reordering rows preserves coefficients but changes the raw-file SHA-256. Keep the Git commit alongside the report to identify the script revision; floating-point results may differ across environments. Artifacts are still sensitive research outputs and should stay access-controlled and out of Git.

These scores measure agreement with self-report on this participant holdout. They are not confidence estimates or evidence that rest is unnecessary. A later research protocol should define an independent test cohort, uncertainty intervals, calibration, subgroup/measurement-quality checks, and comparison with appropriate baselines before any proposed runtime integration. Do not tune on this validation split and then call it an independent test. Withdrawn consent requires excluding affected records and rebuilding derived artifacts under the approved retention procedure.

## Scaffold tests

```bash
python3 -m unittest discover -s scripts/research -p 'test_*.py' -v
```

Tests use isolated parser and in-memory algorithm fixtures, never downloadable data or a research training dataset. They check schema failures, missing-data refusal with no artifacts, deterministic participant splitting, train-only normalization, optimizer reproducibility, and numerically stable evaluation. No successful training on a real dataset is claimed until one is provided.
