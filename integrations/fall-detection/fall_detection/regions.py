"""Scene memory suppresses repeated observations after tracker ID changes."""
from dataclasses import dataclass
from .geometry import regions_overlap

@dataclass
class RegionNotice:
    bounds: tuple
    touched_at: float

class RegionRegistry:
    def __init__(self):
        self.notices = []

    def contains(self, bounds, instant, policy):
        self.notices = [notice for notice in self.notices
                        if instant - notice.touched_at < policy.region_cooldown]
        for notice in self.notices:
            if regions_overlap(bounds, notice.bounds, policy.region_iou, policy.region_centroid):
                notice.touched_at = instant
                return True
        return False

    def register(self, bounds, instant):
        self.notices.append(RegionNotice(bounds, instant))

    def snapshot(self):
        return [dict(region=notice.bounds, last=notice.touched_at) for notice in self.notices]
