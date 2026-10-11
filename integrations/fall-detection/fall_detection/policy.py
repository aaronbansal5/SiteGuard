"""Validated demo configuration; none of these values are medical thresholds."""
from dataclasses import dataclass, fields
from math import isfinite

@dataclass
class DetectionPolicy:
    min_duration: float = 1.5
    ratio_threshold: float = 2 / 3
    max_gap: float = 0.5
    cooldown: float = 10.0
    min_confidence: float = 0.5
    upright_threshold: float = 1.2
    upright_window: float = 5.0
    edge_margin: float = 0.02
    min_area_fraction: float = 0.002
    max_area_fraction: float = 0.35
    region_iou: float = 0.3
    region_centroid: float = 0.1
    region_cooldown: float = 60.0
    require_upright: bool = True
    duration_exclusive: bool = False

    def __post_init__(self):
        if not isinstance(self.require_upright, bool) or not isinstance(self.duration_exclusive, bool):
            raise ValueError("Temporal rule switches must be boolean")
        for field in fields(self):
            if field.name in ("require_upright", "duration_exclusive"):
                continue
            candidate = getattr(self, field.name)
            if not isinstance(candidate, (int, float)) or not isfinite(candidate) or candidate < 0:
                raise ValueError('Configuration must be finite and nonnegative')
        required_positive = (self.ratio_threshold, self.max_gap, self.upright_window)
        violations = (any(value == 0 for value in required_positive), self.min_confidence > 1,
                      self.upright_threshold <= self.ratio_threshold, self.edge_margin >= 0.5,
                      not self.min_area_fraction < self.max_area_fraction <= 1, self.region_iou > 1)
        if any(violations):
            raise ValueError('Invalid configuration')
