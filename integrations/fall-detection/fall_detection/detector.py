"""Application-owned horizontal-person heuristic, independent of ML/capture.

A track only produces a candidate when, in order:

1. Its box is valid, confident, clear of the frame edge and inside the
   configured area-fraction bounds (close-ups and cut-off people are ignored).
2. The SAME track was observed upright (height/width >= upright threshold)
   within ``upright_window`` seconds before the horizontal phase began.
3. The box stays horizontal (height/width < ratio threshold) for
   ``min_duration`` seconds without gaps above ``max_gap``.

A candidate whose region overlaps a recent alert region (IoU or centroid
distance) is suppressed for ``region_cooldown`` seconds, so tracker ID changes
on one still person do not create a stream of repeat incidents.
"""
import math
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class Observation:
    track_id: str
    bbox: Tuple[float, float, float, float]
    confidence: float = 1.0  # Object detector confidence; never fall probability.


def normalized_region(bbox, frame_size) -> Tuple[float, float, float, float]:
    width, height = frame_size
    return tuple(round(min(1.0, max(0.0, value / size)), 4)
                 for value, size in zip(bbox, (width, height, width, height)))


def regions_overlap(a: Sequence[float], b: Sequence[float],
                    iou_threshold: float = 0.3, centroid_distance: float = 0.1) -> bool:
    """True when two normalized [x1, y1, x2, y2] regions describe the same spot."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    if union > 0 and inter / union >= iou_threshold:
        return True
    ca = ((a[0] + a[2]) / 2, (a[1] + a[3]) / 2)
    cb = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    return math.hypot(ca[0] - cb[0], ca[1] - cb[1]) <= centroid_distance


class Detector:
    def __init__(self, min_duration=1.5, ratio_threshold=2 / 3,
                 max_gap=0.5, cooldown=10.0, min_confidence=0.5,
                 upright_threshold=1.2, upright_window=5.0,
                 edge_margin=0.02, min_area_fraction=0.002, max_area_fraction=0.35,
                 region_iou=0.3, region_centroid=0.1, region_cooldown=60.0):
        values = (min_duration, ratio_threshold, max_gap, cooldown, min_confidence,
                  upright_threshold, upright_window, edge_margin, min_area_fraction,
                  max_area_fraction, region_iou, region_centroid, region_cooldown)
        for value in values:
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError('Configuration must be finite and nonnegative')
        if (min_duration == 0 or ratio_threshold == 0 or max_gap == 0 or min_confidence > 1
                or upright_threshold <= ratio_threshold or upright_window == 0
                or edge_margin >= 0.5 or not min_area_fraction < max_area_fraction <= 1
                or region_iou > 1):
            raise ValueError('Invalid configuration')
        self.min_duration, self.ratio_threshold = min_duration, ratio_threshold
        self.max_gap, self.cooldown = max_gap, cooldown
        self.min_confidence = min_confidence
        self.upright_threshold, self.upright_window = upright_threshold, upright_window
        self.edge_margin = edge_margin
        self.min_area_fraction, self.max_area_fraction = min_area_fraction, max_area_fraction
        self.region_iou, self.region_centroid = region_iou, region_centroid
        self.region_cooldown = region_cooldown
        self.states: Dict[str, dict] = {}
        # Recent alert regions: {'region': (x1,y1,x2,y2), 'last': timestamp}.
        self.alert_regions: List[dict] = []
        self.suppressed = 0
        self.last_timestamp = None

    def reset_tracks(self):
        """Forget per-track history (e.g. camera restarted; IDs not continuous)."""
        self.states.clear()

    def classify(self, observation: Observation, frame_size) -> str:
        """Return 'ignored', 'upright', 'horizontal' or 'intermediate'."""
        box = observation.bbox
        width, height = frame_size
        if not (len(box) == 4 and all(math.isfinite(v) for v in box)
                and box[2] > box[0] and box[3] > box[1]
                and math.isfinite(observation.confidence)
                and self.min_confidence <= observation.confidence <= 1):
            return 'ignored'
        mx, my = self.edge_margin * width, self.edge_margin * height
        if box[0] <= mx or box[1] <= my or box[2] >= width - mx or box[3] >= height - my:
            return 'ignored'  # Touches the frame edge: person may be cut off.
        area = (box[2] - box[0]) * (box[3] - box[1]) / (width * height)
        if not self.min_area_fraction <= area <= self.max_area_fraction:
            return 'ignored'  # Too small to judge, or a close-up.
        ratio = (box[3] - box[1]) / (box[2] - box[0])
        if ratio >= self.upright_threshold:
            return 'upright'
        if ratio < self.ratio_threshold:
            return 'horizontal'
        return 'intermediate'

    def _suppressed_by_region(self, region, timestamp) -> bool:
        self.alert_regions = [item for item in self.alert_regions
                              if timestamp - item['last'] < self.region_cooldown]
        for item in self.alert_regions:
            if regions_overlap(region, item['region'], self.region_iou, self.region_centroid):
                item['last'] = timestamp  # Still there: keep suppressing.
                return True
        return False

    def update(self, observations: Iterable[Observation], timestamp: float,
               frame_size: Optional[Sequence[float]] = None) -> List[dict]:
        if not math.isfinite(timestamp) or timestamp < 0:
            raise ValueError('Invalid monotonic timestamp')
        if (frame_size is None or len(frame_size) != 2
                or not all(math.isfinite(v) and v > 0 for v in frame_size)):
            raise ValueError('Frame size must be two positive numbers')
        if self.last_timestamp is not None and timestamp <= self.last_timestamp:
            raise ValueError('Timestamp must strictly increase')
        self.last_timestamp = timestamp
        seen, events = set(), []
        for observation in observations:
            track = observation.track_id
            if not track or track in seen:
                raise ValueError('Track IDs must be unique and nonempty')
            seen.add(track)
            state = self.states.setdefault(track, {'since': None, 'last': None, 'emitted': False,
                                                   'alert_at': None, 'upright_at': None})
            kind = self.classify(observation, frame_size)
            if kind != 'horizontal':
                if kind == 'upright':
                    state['upright_at'] = timestamp
                state.update(since=None, last=timestamp, emitted=False)
                continue
            if state['last'] is None or timestamp - state['last'] > self.max_gap:
                state.update(since=None, emitted=False)
            if state['since'] is None:
                # A horizontal phase only counts as a transition from upright.
                upright_at = state['upright_at']
                if upright_at is None or timestamp - upright_at > self.upright_window:
                    state['last'] = timestamp
                    continue
                state['since'] = timestamp
            state['last'] = timestamp
            duration = timestamp - state['since']
            eligible = state['alert_at'] is None or timestamp - state['alert_at'] >= self.cooldown
            if duration >= self.min_duration and not state['emitted'] and eligible:
                state['emitted'] = True
                box = observation.bbox
                region = normalized_region(box, frame_size)
                if self._suppressed_by_region(region, timestamp):
                    self.suppressed += 1
                    continue
                state['alert_at'] = timestamp
                self.alert_regions.append({'region': region, 'last': timestamp})
                events.append({'trackId': track, 'durationSeconds': duration,
                               'evidence': {'heightWidthRatio': (box[3] - box[1]) / (box[2] - box[0]),
                                            'region': list(region)}})
        for track in list(self.states):
            state = self.states[track]
            if track not in seen:
                state.update(since=None, emitted=False)
                if state['last'] is not None and timestamp - state['last'] > max(60, self.cooldown):
                    del self.states[track]
        return events
