"""Geometry rules without camera, transport or temporal state dependencies."""
from dataclasses import dataclass
from math import hypot, isfinite
from typing import Tuple

@dataclass(frozen=True)
class Observation:
    track_id: str
    bbox: Tuple[float, float, float, float]
    confidence: float = 1.0

@dataclass(frozen=True)
class Rectangle:
    left: float
    top: float
    right: float
    bottom: float

    @property
    def extent(self):
        return self.right - self.left, self.bottom - self.top

    @property
    def area(self):
        horizontal, vertical = self.extent
        return horizontal * vertical

    @property
    def center(self):
        return (self.left + self.right) / 2, (self.top + self.bottom) / 2

    @property
    def aspect(self):
        horizontal, vertical = self.extent
        return vertical / horizontal

    def project(self, dimensions):
        horizontal, vertical = dimensions
        corners = (self.left, self.top, self.right, self.bottom)
        return tuple(round(min(1.0, max(0.0, coordinate / scale)), 4)
                     for coordinate, scale in zip(corners, (horizontal, vertical, horizontal, vertical)))

def normalized_region(bbox, frame_size):
    return Rectangle(*bbox).project(frame_size)

def regions_overlap(a, b, iou_threshold=0.3, centroid_distance=0.1):
    first, second = Rectangle(*a), Rectangle(*b)
    overlap_width = max(0.0, min(first.right, second.right) - max(first.left, second.left))
    overlap_height = max(0.0, min(first.bottom, second.bottom) - max(first.top, second.top))
    shared_area = overlap_width * overlap_height
    total_area = first.area + second.area - shared_area
    if total_area > 0 and shared_area / total_area >= iou_threshold:
        return True
    first_center, second_center = first.center, second.center
    return hypot(first_center[0] - second_center[0], first_center[1] - second_center[1]) <= centroid_distance

def posture(observation, dimensions, policy):
    coordinates = observation.bbox
    if len(coordinates) != 4 or not all(isfinite(value) for value in coordinates):
        return 'ignored'
    rectangle = Rectangle(*coordinates)
    if min(rectangle.extent) <= 0:
        return 'ignored'
    certainty = observation.confidence
    if not isfinite(certainty) or not policy.min_confidence <= certainty <= 1:
        return 'ignored'
    image_width, image_height = dimensions
    horizontal_margin, vertical_margin = image_width * policy.edge_margin, image_height * policy.edge_margin
    clipped = (rectangle.left <= horizontal_margin or rectangle.top <= vertical_margin
               or rectangle.right >= image_width - horizontal_margin
               or rectangle.bottom >= image_height - vertical_margin)
    if (policy.edge_margin > 0 and clipped) or not policy.min_area_fraction <= rectangle.area / (image_width * image_height) <= policy.max_area_fraction:
        return 'ignored'
    if rectangle.aspect >= policy.upright_threshold:
        return 'upright'
    return 'horizontal' if rectangle.aspect < policy.ratio_threshold else 'intermediate'
