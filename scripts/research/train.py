"""Offline research baseline; demo mode is explicitly synthetic and never runtime-ready."""

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys
from datetime import datetime


SCHEMA_VERSION = "siteguard-rest-request-csv-v1"
MODEL_VERSION = "siteguard-rest-request-logistic-v1"
FIELDS = (
    "participant_id", "session_id", "consent_record_id", "consent_granted",
    "data_kind", "measurement_source", "label_source", "collected_at",
    "label_collected_at", "pulse_initial_bpm", "pulse_final_bpm",
    "breathing_initial_brpm", "breathing_final_brpm",
    "pulse_historical_delta_bpm", "breathing_historical_delta_brpm",
    "history_count", "duration_seconds", "requested_additional_rest",
)
NUMERIC_FIELDS = (
    "pulse_initial_bpm", "pulse_final_bpm", "breathing_initial_brpm",
    "breathing_final_brpm", "pulse_historical_delta_bpm",
    "breathing_historical_delta_brpm", "duration_seconds",
)
FEATURES = (
    "pulse_initial_bpm", "pulse_delta_bpm", "breathing_initial_brpm",
    "breathing_delta_brpm", "pulse_difference_from_history_bpm",
    "breathing_difference_from_history_brpm", "history_count", "duration_seconds",
)
ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")


class DatasetError(ValueError):
    """Invalid or insufficient research data. No artifact may be produced."""


def timestamp(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None or result.utcoffset() is None:
            raise ValueError("timezone required")
        return result
    except ValueError as error:
        raise DatasetError("timestamps must be ISO 8601 with a timezone") from error


def validate_row(raw, line, allow_synthetic_demo=False):
    prefix = f"CSV record {line}: "
    if None in raw or any(raw.get(field) is None for field in FIELDS):
        raise DatasetError(prefix + "wrong number of columns")
    row = {key: value.strip() for key, value in raw.items()}
    if any(not row[field] for field in FIELDS):
        raise DatasetError(prefix + "all required fields must be nonempty")
    for field in ("participant_id", "session_id", "consent_record_id"):
        if not ID_PATTERN.fullmatch(row[field]):
            raise DatasetError(prefix + f"{field} must be a pseudonymous token")
    expected_fields = (
        ("consent_granted", "true"), ("data_kind", "real"),
        ("measurement_source", "presage"), ("label_source", "self_report"),
    )
    if allow_synthetic_demo:
        expected_fields = (("data_kind", "synthetic"),)
        if row["consent_granted"].lower() not in ("true", "false"):
            raise DatasetError(prefix + "synthetic demo consent_granted must be true or false")
        if row["measurement_source"] not in ("mock", "presage"):
            raise DatasetError(prefix + "synthetic demo measurement_source must be mock or presage")
        if row["label_source"] not in ("synthetic_demo", "self_report"):
            raise DatasetError(prefix + "synthetic demo label_source must be synthetic_demo or self_report")
    for field, expected in expected_fields:
        if row[field] != expected:
            raise DatasetError(prefix + f"{field} must be {expected}")
    try:
        collected = timestamp(row["collected_at"])
        labeled = timestamp(row["label_collected_at"])
    except DatasetError as error:
        raise DatasetError(prefix + str(error)) from error
    if labeled < collected:
        raise DatasetError(prefix + "label must be collected at or after session completion")
    if row["requested_additional_rest"] not in ("0", "1"):
        raise DatasetError(prefix + "requested_additional_rest requires an observed 0 or 1 label")
    row["requested_additional_rest"] = int(row["requested_additional_rest"])
    for field in NUMERIC_FIELDS:
        try:
            value = float(row[field])
        except ValueError as error:
            raise DatasetError(prefix + f"{field} must be numeric") from error
        # Computational guard only, not a clinical plausibility threshold.
        if not math.isfinite(value) or abs(value) > 1_000_000:
            raise DatasetError(prefix + f"{field} must be finite with magnitude <= 1000000")
        if field.endswith(("_bpm", "_brpm")) and "historical" not in field and value <= 0:
            raise DatasetError(prefix + f"{field} must be positive")
        row[field] = value
    if row["duration_seconds"] < 45:
        raise DatasetError(prefix + "duration_seconds must be >= 45 for separate windows")
    if not re.fullmatch(r"[0-9]+", row["history_count"]):
        raise DatasetError(prefix + "history_count must be an integer")
    row["history_count"] = int(row["history_count"])
    if not 3 <= row["history_count"] <= 1_000_000:
        raise DatasetError(prefix + "history_count must be between 3 and 1000000")
    return row


def load_dataset(path, allow_synthetic_demo=False):
    if not path.is_file():
        raise DatasetError("labeled dataset file is missing; no fallback is available")
    payload = path.read_bytes()
    try:
        reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig")), strict=True)
        if reader.fieldnames is None or len(reader.fieldnames) != len(FIELDS) or set(reader.fieldnames) != set(FIELDS):
            raise DatasetError("CSV header must contain every schema field exactly once, with no extras")
        rows = [validate_row(raw, index, allow_synthetic_demo) for index, raw in enumerate(reader, start=2)]
    except (UnicodeError, csv.Error) as error:
        raise DatasetError("dataset must be a valid UTF-8 CSV") from error
    if len(rows) < 20:
        raise DatasetError("at least 20 genuinely labeled sessions are required")
    if len({row["session_id"] for row in rows}) != len(rows):
        raise DatasetError("session_id must be unique; duplicate sessions are rejected")
    if len({row["participant_id"] for row in rows}) < 10:
        raise DatasetError("at least 10 distinct participants are required")
    if {row["requested_additional_rest"] for row in rows} != {0, 1}:
        raise DatasetError("dataset requires both observed label classes")
    return sorted(rows, key=lambda row: row["session_id"]), hashlib.sha256(payload).hexdigest()


def split_dataset(rows, seed, validation_fraction):
    participants = sorted(
        {row["participant_id"] for row in rows},
        key=lambda value: (hashlib.sha256(f"{seed}:{value}".encode()).hexdigest(), value),
    )
    count = max(2, math.ceil(len(participants) * validation_fraction))
    validation_ids = set(participants[:count])
    train = sorted((row for row in rows if row["participant_id"] not in validation_ids), key=lambda row: row["session_id"])
    validation = sorted((row for row in rows if row["participant_id"] in validation_ids), key=lambda row: row["session_id"])
    for name, partition in (("train", train), ("validation", validation)):
        if {row["requested_additional_rest"] for row in partition} != {0, 1}:
            raise DatasetError(f"{name} split lacks both classes; collect more data, do not search seeds for better results")
    return train, validation


def feature_vector(row):
    pulse_delta = row["pulse_final_bpm"] - row["pulse_initial_bpm"]
    breathing_delta = row["breathing_final_brpm"] - row["breathing_initial_brpm"]
    return [
        row["pulse_initial_bpm"], pulse_delta, row["breathing_initial_brpm"],
        breathing_delta, pulse_delta - row["pulse_historical_delta_bpm"],
        breathing_delta - row["breathing_historical_delta_brpm"],
        row["history_count"], row["duration_seconds"],
    ]


def fit_scaler(matrix):
    means = [math.fsum(column) / len(column) for column in zip(*matrix)]
    scales = [
        math.sqrt(math.fsum((row[index] - mean) ** 2 for row in matrix) / len(matrix)) or 1.0
        for index, mean in enumerate(means)
    ]
    return means, scales


def transform(matrix, means, scales):
    return [[(value - mean) / scale for value, mean, scale in zip(row, means, scales)] for row in matrix]


def sigmoid(value):
    if value >= 0:
        return 1 / (1 + math.exp(-value))
    exp_value = math.exp(value)
    return exp_value / (1 + exp_value)


def predict(matrix, weights, intercept):
    return [sigmoid(math.fsum(value * weight for value, weight in zip(row, weights)) + intercept) for row in matrix]


def fit_logistic(matrix, labels, epochs, learning_rate, l2):
    weights = [0.0] * len(FEATURES)
    intercept = 0.0
    for _ in range(epochs):
        errors = [estimate - label for estimate, label in zip(predict(matrix, weights, intercept), labels)]
        gradients = [math.fsum(error * row[index] for error, row in zip(errors, matrix)) / len(matrix) + l2 * weights[index] for index in range(len(weights))]
        weights = [weight - learning_rate * gradient for weight, gradient in zip(weights, gradients)]
        intercept -= learning_rate * math.fsum(errors) / len(matrix)
    return weights, intercept


def metrics(labels, estimates):
    clipped = [min(1 - 1e-15, max(1e-15, value)) for value in estimates]
    return {
        "log_loss": -math.fsum(label * math.log(value) + (1 - label) * math.log1p(-value) for label, value in zip(labels, clipped)) / len(labels),
        "brier_score": math.fsum((value - label) ** 2 for label, value in zip(labels, estimates)) / len(labels),
        "accuracy_at_0_5": sum((value >= 0.5) == bool(label) for label, value in zip(labels, estimates)) / len(labels),
    }


def partition_summary(rows):
    return {
        "sessions": len(rows),
        "participants": len({row["participant_id"] for row in rows}),
        "labels": {str(label): sum(row["requested_additional_rest"] == label for row in rows) for label in (0, 1)},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True, help="local labeled CSV")
    parser.add_argument("--allow-synthetic-demo", action="store_true", help="demo only: accept explicitly synthetic rows; never runtime-ready")
    parser.add_argument("--dry-run", action="store_true", help="validate and split only; write nothing")
    parser.add_argument("--output", type=Path, help="new directory for research artifacts; never overwritten")
    parser.add_argument("--seed", type=int, default=20261011)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--epochs", type=int, default=500)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--l2", type=float, default=0.01)
    args = parser.parse_args(argv)
    try:
        if not math.isfinite(args.validation_fraction) or not 0.1 <= args.validation_fraction <= 0.4:
            raise DatasetError("validation fraction must be between 0.1 and 0.4")
        if not 1 <= args.epochs <= 10000:
            raise DatasetError("epochs must be between 1 and 10000")
        if not math.isfinite(args.learning_rate) or not 0 < args.learning_rate <= 1:
            raise DatasetError("learning rate must be finite and in (0, 1]")
        if not math.isfinite(args.l2) or not 0 <= args.l2 <= 1:
            raise DatasetError("l2 must be finite and in [0, 1]")
        rows, digest = load_dataset(args.dataset, args.allow_synthetic_demo)
        train, validation = split_dataset(rows, args.seed, args.validation_fraction)
        report = {
            "schema_version": SCHEMA_VERSION,
            "model_version": MODEL_VERSION,
            "dataset_sha256": digest,
            "split": {
                "method": "participant SHA256 ranking; no shared participants",
                "seed": args.seed, "validation_fraction": args.validation_fraction,
                "train": partition_summary(train), "validation": partition_summary(validation),
            },
            "target": "self-reported request for additional rest",
            "dataset_kind": "synthetic_demo" if args.allow_synthetic_demo else "real_research",
            "experimental": True,
            "runtime_ready": False,
            "confidence": None,
            "uncertainty": "Uncalibrated; independent external evaluation is required.",
            "disclaimer": "Experimental research estimate — not medical advice or work clearance.",
            "python_version": sys.version.split()[0],
        }
        if args.dry_run:
            print(json.dumps({**report, "status": "validated_only", "artifacts_written": False}, indent=2, allow_nan=False))
            return 0
        if args.output is None:
            raise DatasetError("training requires --output pointing to a new artifact directory")
        if args.output.exists():
            raise DatasetError("output already exists; choose a new directory")
        means, scales = fit_scaler([feature_vector(row) for row in train])
        x_train = transform([feature_vector(row) for row in train], means, scales)
        x_validation = transform([feature_vector(row) for row in validation], means, scales)
        y_train = [row["requested_additional_rest"] for row in train]
        y_validation = [row["requested_additional_rest"] for row in validation]
        weights, intercept = fit_logistic(x_train, y_train, args.epochs, args.learning_rate, args.l2)
        prevalence = math.fsum(y_train) / len(y_train)
        report.update({
            "status": "trained_research_only",
            "training": {"epochs": args.epochs, "learning_rate": args.learning_rate, "l2": args.l2, "optimizer": "deterministic full-batch gradient descent"},
            "validation_metrics": metrics(y_validation, predict(x_validation, weights, intercept)),
            "constant_train_prevalence_baseline": metrics(y_validation, [prevalence] * len(y_validation)),
        })
        model = {**report, "feature_names": FEATURES, "normalization": {"means": means, "scales": scales}, "weights": weights, "intercept": intercept}
        # Serialize before creating anything; numerical failure cannot publish an artifact.
        model_json = json.dumps(model, indent=2, allow_nan=False) + "\n"
        report_json = json.dumps(report, indent=2, allow_nan=False) + "\n"
        args.output.mkdir(parents=True, exist_ok=False)
        try:
            (args.output / "model.json").write_text(model_json, encoding="utf-8")
            (args.output / "report.json").write_text(report_json, encoding="utf-8")
        except OSError:
            # This exclusively created directory contains only this attempt's files.
            for name in ("model.json", "report.json"):
                (args.output / name).unlink(missing_ok=True)
            args.output.rmdir()
            raise
        print(report_json, end="")
        return 0
    except (DatasetError, OSError, ValueError, OverflowError) as error:
        print(f"Research training refused: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
