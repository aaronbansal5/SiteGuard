"""Compatibility facade composing geometry, temporal tracking and scene memory."""
from math import isfinite
from .geometry import Observation, Rectangle, normalized_region, posture, regions_overlap
from .policy import DetectionPolicy
from .regions import RegionRegistry
from .tracking import TrackRegistry

class Detector:
    def __init__(self, min_duration=1.5, ratio_threshold=2 / 3,
                 max_gap=0.5, cooldown=10.0, min_confidence=0.5,
                 upright_threshold=1.2, upright_window=5.0,
                 edge_margin=0.02, min_area_fraction=0.002, max_area_fraction=0.35,
                 region_iou=0.3, region_centroid=0.1, region_cooldown=60.0,
                 require_upright=True, duration_exclusive=False):
        settings = dict(locals())
        settings.pop('self')
        self._policy = DetectionPolicy(**settings)
        self._people = TrackRegistry()
        self._scene = RegionRegistry()
        self.suppressed = 0
        self.last_timestamp = None

    def __getattr__(self, name):
        if name in DetectionPolicy.__dataclass_fields__:
            return getattr(self._policy, name)
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if '_policy' in self.__dict__ and name in DetectionPolicy.__dataclass_fields__:
            setattr(self._policy, name, value)
        else:
            object.__setattr__(self, name, value)

    @property
    def states(self):
        return {identifier: history.snapshot() for identifier, history in self._people.entries.items()}

    @property
    def alert_regions(self):
        return self._scene.snapshot()

    def reset_tracks(self):
        self._people.entries.clear()

    def classify(self, observation, frame_size):
        return posture(observation, frame_size, self._policy)

    def _suppressed_by_region(self, region, timestamp):
        return self._scene.contains(region, timestamp, self._policy)

    def update(self, observations, timestamp, frame_size=None):
        self._validate_clock(timestamp, frame_size)
        self.last_timestamp = timestamp
        present = set()
        emitted = []
        for sample in observations:
            identifier = sample.track_id
            if not identifier or identifier in present:
                raise ValueError('Track IDs must be unique and nonempty')
            present.add(identifier)
            history = self._people.acquire(identifier)
            dwell = history.advance(self.classify(sample, frame_size), timestamp, self._policy)
            if dwell is None:
                continue
            rectangle = Rectangle(*sample.bbox)
            footprint = rectangle.project(frame_size)
            if self._scene.contains(footprint, timestamp, self._policy):
                self.suppressed += 1
                continue
            history.notified_at = timestamp
            self._scene.register(footprint, timestamp)
            emitted.append(dict(trackId=identifier, durationSeconds=dwell,
                                evidence=dict(heightWidthRatio=rectangle.aspect, region=list(footprint))))
        self._people.finish_frame(present, timestamp, max(60, self.cooldown))
        return emitted

    def _validate_clock(self, timestamp, frame_size):
        if not isfinite(timestamp) or timestamp < 0:
            raise ValueError('Invalid monotonic timestamp')
        if frame_size is None or len(frame_size) != 2 or not all(isfinite(size) and size > 0 for size in frame_size):
            raise ValueError('Frame size must be two positive numbers')
        if self.last_timestamp is not None and timestamp <= self.last_timestamp:
            raise ValueError('Timestamp must strictly increase')
