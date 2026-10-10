"""Application-owned horizontal-person heuristic, independent of ML/capture."""
import math
from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple


@dataclass(frozen=True)
class Observation:
    track_id: str
    bbox: Tuple[float, float, float, float]
    confidence: float = 1.0  # Object detector confidence; never fall probability.


class Detector:
    def __init__(self, min_duration=1.5, ratio_threshold=2 / 3,
                 max_gap=0.5, cooldown=10.0, min_confidence=0.5):
        for value in (min_duration, ratio_threshold, max_gap, cooldown, min_confidence):
            if not math.isfinite(value) or value < 0:
                raise ValueError('Configuration must be finite and nonnegative')
        if min_duration == 0 or ratio_threshold == 0 or max_gap == 0 or min_confidence > 1:
            raise ValueError('Invalid configuration')
        self.min_duration, self.ratio_threshold = min_duration, ratio_threshold
        self.max_gap, self.cooldown = max_gap, cooldown
        self.min_confidence = min_confidence
        self.states: Dict[str, dict] = {}
        self.last_timestamp = None

    def update(self, observations: Iterable[Observation], timestamp: float) -> List[dict]:
        if not math.isfinite(timestamp) or timestamp < 0:
            raise ValueError('Invalid monotonic timestamp')
        if self.last_timestamp is not None and timestamp <= self.last_timestamp:
            raise ValueError('Timestamp must strictly increase')
        self.last_timestamp = timestamp
        seen, events = set(), []
        for observation in observations:
            track = observation.track_id
            if not track or track in seen:
                raise ValueError('Track IDs must be unique and nonempty')
            seen.add(track)
            state = self.states.setdefault(track, {'since': None, 'last': None,
                                                   'emitted': False, 'alert_at': None})
            box = observation.bbox
            valid = (len(box) == 4 and all(math.isfinite(v) for v in box)
                     and box[2] > box[0] and box[3] > box[1]
                     and math.isfinite(observation.confidence)
                     and self.min_confidence <= observation.confidence <= 1)
            horizontal = valid and (box[3] - box[1]) / (box[2] - box[0]) < self.ratio_threshold
            if not horizontal:
                state.update(since=None, last=timestamp, emitted=False)
                continue
            if state['last'] is None or timestamp - state['last'] > self.max_gap:
                state.update(since=None, emitted=False)
            if state['since'] is None:
                state['since'] = timestamp
            state['last'] = timestamp
            duration = timestamp - state['since']
            eligible = state['alert_at'] is None or timestamp - state['alert_at'] >= self.cooldown
            if duration >= self.min_duration and not state['emitted'] and eligible:
                state.update(emitted=True, alert_at=timestamp)
                events.append({'trackId': track, 'durationSeconds': duration,
                               'evidence': {'heightWidthRatio': (box[3] - box[1]) / (box[2] - box[0])}})
        for track in list(self.states):
            state = self.states[track]
            if track not in seen:
                state.update(since=None, emitted=False)
                if state['last'] is not None and timestamp - state['last'] > max(60, self.cooldown):
                    del self.states[track]
        return events
