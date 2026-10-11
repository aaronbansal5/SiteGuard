"""Per-person temporal transitions, separate from spatial repeat suppression."""
from dataclasses import dataclass
from typing import Optional

@dataclass
class TrackHistory:
    phase_start: Optional[float] = None
    observed_at: Optional[float] = None
    attempted: bool = False
    notified_at: Optional[float] = None
    standing_at: Optional[float] = None

    def abandon_phase(self):
        self.phase_start = None
        self.attempted = False

    def advance(self, pose, instant, policy):
        if pose != 'horizontal':
            if pose == 'upright':
                self.standing_at = instant
            self.abandon_phase()
            self.observed_at = instant
            return None
        if self.observed_at is None or instant - self.observed_at > policy.max_gap:
            self.abandon_phase()
        if self.phase_start is None:
            recent_standing = self.standing_at is not None and instant - self.standing_at <= policy.upright_window
            if policy.require_upright and not recent_standing:
                self.observed_at = instant
                return None
            self.phase_start = instant
        self.observed_at = instant
        elapsed = instant - self.phase_start
        cooldown_finished = self.notified_at is None or instant - self.notified_at >= policy.cooldown
        waiting = elapsed <= policy.min_duration if policy.duration_exclusive else elapsed < policy.min_duration
        if self.attempted or not cooldown_finished or waiting:
            return None
        self.attempted = True
        return elapsed

    def snapshot(self):
        return dict(since=self.phase_start, last=self.observed_at, emitted=self.attempted,
                    alert_at=self.notified_at, upright_at=self.standing_at)

class TrackRegistry:
    def __init__(self):
        self.entries = {}

    def acquire(self, identifier):
        if identifier not in self.entries:
            self.entries[identifier] = TrackHistory()
        return self.entries[identifier]

    def finish_frame(self, present, instant, expiry):
        expired = []
        for identifier, history in self.entries.items():
            if identifier in present:
                continue
            history.abandon_phase()
            if history.observed_at is not None and instant - history.observed_at > expiry:
                expired.append(identifier)
        for identifier in expired:
            self.entries.pop(identifier)
