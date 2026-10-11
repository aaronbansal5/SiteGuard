"""Generate an explicitly synthetic, demo-only research CSV."""

import csv
from datetime import datetime, timedelta, timezone
from pathlib import Path

from train import FIELDS


def main():
    output = Path(".data/research/synthetic_demo.csv")
    output.parent.mkdir(parents=True, exist_ok=True)
    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = []
    for participant_number in range(1, 11):
        participant = f"demo-participant-{participant_number:02d}"
        for session_number in range(1, 3):
            session = f"{participant}-session-{session_number:02d}"
            index = (participant_number - 1) * 2 + session_number
            pulse_initial = 96 + participant_number + session_number
            breathing_initial = 18 + (participant_number % 4) + session_number / 10
            requested = int(index % 2 == 0)
            pulse_delta = -10 if requested else -15
            breathing_delta = -2 if requested else -4
            collected = started + timedelta(days=index)
            labeled = collected + timedelta(minutes=2)
            rows.append({
                "participant_id": participant,
                "session_id": session,
                "consent_record_id": f"demo-consent-{participant_number:02d}",
                "consent_granted": "false",
                "data_kind": "synthetic",
                "measurement_source": "mock",
                "label_source": "synthetic_demo",
                "collected_at": collected.isoformat().replace("+00:00", "Z"),
                "label_collected_at": labeled.isoformat().replace("+00:00", "Z"),
                "pulse_initial_bpm": f"{pulse_initial:.2f}",
                "pulse_final_bpm": f"{pulse_initial + pulse_delta:.2f}",
                "breathing_initial_brpm": f"{breathing_initial:.2f}",
                "breathing_final_brpm": f"{breathing_initial + breathing_delta:.2f}",
                "pulse_historical_delta_bpm": "-12.00",
                "breathing_historical_delta_brpm": "-3.00",
                "history_count": "3",
                "duration_seconds": "60",
                "requested_additional_rest": str(requested),
            })
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} explicitly synthetic demo rows to {output}")


if __name__ == "__main__":
    main()
