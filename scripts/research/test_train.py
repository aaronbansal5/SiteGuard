"""Isolated unit fixtures only: never exported as research data or app models."""

import contextlib
import csv
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import train


def unit_record():
    # Explicit parser fixture; this is not a consent or real-data attestation.
    return dict(zip(train.FIELDS, (
        "unit-participant", "unit-session", "unit-consent", "true", "real",
        "presage", "self_report", "2026-10-10T12:00:00Z",
        "2026-10-10T12:01:00Z", "90", "80", "18", "16", "-12", "-3",
        "3", "90", "1",
    )))


class DatasetTests(unittest.TestCase):
    def test_required_schema_and_feature_units(self):
        row = train.validate_row(unit_record(), 2)
        self.assertEqual(train.feature_vector(row), [90, -10, 18, -2, 2, 1, 3, 90])
        self.assertEqual(len(train.feature_vector(row)), len(train.FEATURES))

    def test_rejects_missing_and_invalid_fields(self):
        mutations = (
            ("consent_granted", "false"), ("consent_record_id", ""),
            ("data_kind", "synthetic"), ("measurement_source", "mock"),
            ("label_source", "gemini"), ("requested_additional_rest", ""),
            ("requested_additional_rest", "0.5"), ("participant_id", "name@example.com"),
            ("pulse_initial_bpm", "nan"), ("pulse_final_bpm", "inf"),
            ("pulse_final_bpm", "1e308"), ("breathing_final_brpm", "-1"),
            ("pulse_historical_delta_bpm", "not-a-number"), ("history_count", "2"),
            ("history_count", "3.5"), ("duration_seconds", "44"),
            ("collected_at", "2026-10-10T12:00:00"),
            ("label_collected_at", "2026-10-10T11:00:00Z"),
            ("label_collected_at", "invalid"),
        )
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                raw = unit_record()
                raw[field] = value
                with self.assertRaises(train.DatasetError):
                    train.validate_row(raw, 2)
        raw = unit_record()
        del raw["requested_additional_rest"]
        with self.assertRaises(train.DatasetError):
            train.validate_row(raw, 2)
        raw = unit_record()
        raw[None] = ["extra"]
        with self.assertRaises(train.DatasetError):
            train.validate_row(raw, 2)

    def test_no_dataset_fails_closed_without_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for extra in (["--dry-run"], ["--output", str(root / "artifacts")]):
                with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()) as stderr:
                    result = train.main(["--dataset", str(root / "missing.csv"), *extra])
                    self.assertEqual(result, 2)
                    self.assertIn("missing", stderr.getvalue())
                    self.assertFalse((root / "artifacts").exists())

    def test_invalid_csv_headers_and_empty_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.csv"
            for fields in ([], list(train.FIELDS[:-1]), [*train.FIELDS, "extra"], [*train.FIELDS[:-1], train.FIELDS[0]], list(train.FIELDS)):
                with self.subTest(fields=fields):
                    with path.open("w", newline="", encoding="utf-8") as handle:
                        csv.writer(handle).writerow(fields)
                    with self.assertRaises(train.DatasetError):
                        train.load_dataset(path)

    def test_short_labeled_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "parser-fixture.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=train.FIELDS)
                writer.writeheader()
                writer.writerow(unit_record())
            with self.assertRaisesRegex(train.DatasetError, "20"):
                train.load_dataset(path)

    def test_invalid_cli_parameters_fail_without_loading_data(self):
        for option, value in (
            ("--validation-fraction", "nan"), ("--validation-fraction", "0.9"),
            ("--epochs", "0"), ("--learning-rate", "inf"), ("--l2", "-1"),
        ):
            with self.subTest(option=option, value=value), patch.object(train, "load_dataset") as load, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(train.main(["--dataset", "missing.csv", "--dry-run", option, value]), 2)
                load.assert_not_called()

    def test_dry_run_never_fits_or_writes(self):
        row = train.validate_row(unit_record(), 2)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "not-created" / "artifacts"
            with patch.object(train, "load_dataset", return_value=([row], "unit-digest")), patch.object(train, "split_dataset", return_value=([row], [row])), patch.object(train, "fit_logistic") as fit, contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(train.main(["--dataset", "unit-only.csv", "--dry-run", "--output", str(output)]), 0)
                fit.assert_not_called()
                self.assertIn('"status": "validated_only"', stdout.getvalue())
                self.assertNotIn("unit-participant", stdout.getvalue())
                self.assertFalse(output.parent.exists())

    def test_existing_artifacts_are_preserved(self):
        row = train.validate_row(unit_record(), 2)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            existing = output / "model.json"
            existing.write_text("existing research artifact", encoding="utf-8")
            with patch.object(train, "load_dataset", return_value=([row], "unit-digest")), patch.object(train, "split_dataset", return_value=([row], [row])), patch.object(train, "fit_logistic") as fit, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(train.main(["--dataset", "unit-only.csv", "--output", str(output)]), 2)
                fit.assert_not_called()
            self.assertEqual(existing.read_text(encoding="utf-8"), "existing research artifact")

    def test_nonfinite_fit_is_rejected_before_creating_output(self):
        row = train.validate_row(unit_record(), 2)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "artifacts"
            with patch.object(train, "load_dataset", return_value=([row], "unit-digest")), patch.object(train, "split_dataset", return_value=([row], [row])), patch.object(train, "fit_logistic", return_value=([float("nan")] * len(train.FEATURES), 0.0)), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(train.main(["--dataset", "unit-only.csv", "--output", str(output)]), 2)
            self.assertFalse(output.exists())


class AlgorithmTests(unittest.TestCase):
    def test_participant_split_is_disjoint_and_order_independent(self):
        # Minimal in-memory split fixtures with explicit class pairs. No CSV export.
        rows = [
            {"participant_id": participant, "session_id": participant + suffix, "requested_additional_rest": label}
            for participant in ("a", "b", "c", "d", "e", "f", "g", "h", "i", "j")
            for suffix, label in (("-yes", 1), ("-no", 0))
        ]
        training, validation = train.split_dataset(rows, 20261011, 0.2)
        self.assertEqual((training, validation), train.split_dataset(list(reversed(rows)), 20261011, 0.2))
        train_ids = {row["participant_id"] for row in training}
        validation_ids = {row["participant_id"] for row in validation}
        self.assertFalse(train_ids & validation_ids)
        self.assertEqual(len(validation_ids), 2)
        self.assertEqual(len(training) + len(validation), len(rows))

    def test_single_class_split_is_rejected(self):
        rows = [{"participant_id": "a", "session_id": "a", "requested_additional_rest": 1}]
        with self.assertRaises(train.DatasetError):
            train.split_dataset(rows, 20261011, 0.2)

    def test_normalization_is_fit_on_training_only(self):
        means, scales = train.fit_scaler([[0.0, 2.0], [2.0, 2.0]])
        self.assertEqual(means, [1.0, 2.0])
        self.assertEqual(scales, [1.0, 1.0])
        self.assertEqual(train.transform([[100.0, 2.0]], means, scales), [[99.0, 0.0]])

    def test_baseline_optimizer_is_deterministic(self):
        matrix = [[-1.0] * len(train.FEATURES), [1.0] * len(train.FEATURES)]
        arguments = (matrix, [0, 1], 50, 0.05, 0.01)
        first = train.fit_logistic(*arguments)
        self.assertEqual(first, train.fit_logistic(*arguments))
        estimates = train.predict(matrix, *first)
        self.assertLess(estimates[0], 0.5)
        self.assertGreater(estimates[1], 0.5)

    def test_metrics_and_sigmoid_are_finite_at_extremes(self):
        self.assertEqual(train.sigmoid(-1000), 0)
        self.assertEqual(train.sigmoid(1000), 1)
        report = train.metrics([0, 1], [0, 1])
        self.assertEqual(report["brier_score"], 0)
        self.assertEqual(report["accuracy_at_0_5"], 1)
        self.assertGreaterEqual(report["log_loss"], 0)


if __name__ == "__main__":
    unittest.main()
