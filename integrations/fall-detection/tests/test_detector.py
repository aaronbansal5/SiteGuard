import math
import tempfile
import unittest
from pathlib import Path
from fall_detection.detector import Detector, Observation
from fall_detection.store import Store

UP = Observation('1', (0, 0, 50, 150))
DOWN = Observation('1', (0, 0, 150, 50))


class DetectorTests(unittest.TestCase):
    def frames(self, detector, observation, start=0, count=21):
        events = []
        for index in range(count):
            events.extend(detector.update([observation], start + index / 10))
        return events

    def test_upright_never_alerts(self):
        self.assertEqual(self.frames(Detector(), UP), [])

    def test_early_timestamp_and_one_event_per_episode(self):
        events = self.frames(Detector(), DOWN)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['durationSeconds'], 1.5)
        self.assertNotIn('confidence', events[0])

    def test_short_bend(self):
        detector = Detector()
        self.assertEqual(self.frames(detector, DOWN, count=7), [])
        self.assertEqual(detector.update([UP], 0.7), [])

    def test_missing_and_long_gap_reset_duration(self):
        detector = Detector()
        self.frames(detector, DOWN, count=11)
        detector.update([], 1.1)
        self.assertEqual(self.frames(detector, DOWN, start=1.2, count=11), [])
        self.assertEqual(detector.update([DOWN], 5), [])

    def test_repeat_episode_after_cooldown(self):
        detector = Detector()
        self.assertEqual(len(self.frames(detector, DOWN)), 1)
        detector.update([UP], 2.1)
        self.assertEqual(self.frames(detector, DOWN, start=2.2), [])
        detector.update([UP], 12)
        self.assertEqual(len(self.frames(detector, DOWN, start=12.1)), 1)

    def test_invalid_and_low_confidence(self):
        for obs in (Observation('1', (0, 0, 0, 10)),
                    Observation('1', (0, 0, math.nan, 10)),
                    Observation('1', (0, 0, 100, 10), 0.2)):
            self.assertEqual(self.frames(Detector(), obs), [])

    def test_backwards_clock(self):
        detector = Detector()
        detector.update([DOWN], 10)
        with self.assertRaises(ValueError):
            detector.update([DOWN], 9)

    def test_tracks_independent(self):
        detector = Detector()
        events = []
        for index in range(21):
            events.extend(detector.update([DOWN, Observation('2', UP.bbox)], index / 10))
        self.assertEqual([event['trackId'] for event in events], ['1'])


class StoreTests(unittest.TestCase):
    def test_persistence_acknowledgment_and_explicit_closure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.sqlite'
            store = Store(path)
            event = store.record({'trackId': '1', 'durationSeconds': 1.5,
                                  'evidence': {'heightWidthRatio': .3}}, 'synthetic', 'run', 1, 'cam', 'zone')
            incident_id = event['eventId']
            self.assertTrue(event['observedAt'].endswith('Z'))
            store.action(incident_id, 'acknowledge', '')
            restored = Store(path)
            self.assertEqual(restored.list('incidents')[0]['status'], 'acknowledged')
            with self.assertRaises(ValueError):
                restored.action(incident_id, 'resolve', '')
            restored.action(incident_id, 'resolve', 'Scene checked in synthetic demo')
            self.assertEqual(restored.list('incidents')[0]['status'], 'resolved')
            self.assertEqual(len(restored.list('actions')), 2)
            with self.assertRaises(ValueError):
                restored.action(incident_id, 'acknowledge', '')

    def test_review_queue_keeps_older_unresolved_incidents_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / 'test.sqlite')
            ids = [store.record({'trackId': str(n), 'durationSeconds': 1.5,
                                 'evidence': {'heightWidthRatio': .3}}, 'synthetic', 'run', n,
                                'cam', 'zone')['eventId'] for n in range(1, 6)]
            for incident_id in ids[1:]:
                store.action(incident_id, 'false_alarm', 'Synthetic test')
            queue = store.review_queue(limit=2)
            self.assertEqual([item['id'] for item in queue], [ids[4], ids[3], ids[0]])
            self.assertEqual(queue[-1]['status'], 'open')
            store.db.close()


if __name__ == '__main__':
    unittest.main()
