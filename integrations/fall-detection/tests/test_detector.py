import json
import math
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fall_detection.detector import Detector, Observation, regions_overlap
from fall_detection.store import Store

FRAME = (640, 360)
UP = Observation('1', (200, 60, 260, 200))     # ratio 2.33, area ~3.6%
DOWN = Observation('1', (160, 150, 300, 200))  # ratio 0.36, area ~3.0%


def obs(track, box, confidence=1.0):
    return Observation(track, box, confidence)


class DetectorTests(unittest.TestCase):
    def frames(self, detector, observation, start=0, count=21):
        events = []
        for index in range(count):
            events.extend(detector.update([observation], start + index / 10, FRAME))
        return events

    def fall(self, detector, start=0, track='1', count=21):
        """Upright for 0.5 s then horizontal; returns events from the horizontal phase."""
        self.frames(detector, obs(track, UP.bbox), start, 5)
        return self.frames(detector, obs(track, DOWN.bbox), start + 0.5, count)

    def test_upright_never_alerts(self):
        self.assertEqual(self.frames(Detector(), UP), [])

    def test_early_timestamp_and_one_event_per_episode(self):
        events = self.fall(Detector())
        self.assertEqual(len(events), 1)
        self.assertAlmostEqual(events[0]['durationSeconds'], 1.5)
        self.assertNotIn('confidence', events[0])
        self.assertEqual(len(events[0]['evidence']['region']), 4)

    def test_short_bend(self):
        detector = Detector()
        self.assertEqual(self.fall(detector, count=7), [])
        self.assertEqual(detector.update([UP], 1.2, FRAME), [])

    def test_missing_and_long_gap_reset_duration(self):
        detector = Detector()
        self.fall(detector, count=11)
        detector.update([], 1.6, FRAME)
        self.assertEqual(self.frames(detector, DOWN, start=1.7, count=11), [])
        self.assertEqual(detector.update([DOWN], 5, FRAME), [])

    def test_repeat_episode_after_cooldown_in_new_region(self):
        detector = Detector(region_cooldown=0.5)
        self.assertEqual(len(self.fall(detector)), 1)
        detector.update([UP], 2.6, FRAME)
        self.assertEqual(self.fall(detector, start=2.7), [])  # per-track cooldown
        self.assertEqual(len(self.fall(detector, start=13)), 1)

    def test_invalid_and_low_confidence(self):
        for bad in ((0, 0, 0, 10), (0, 0, math.nan, 10)):
            detector = Detector()
            self.frames(detector, UP, count=3)
            self.assertEqual(self.frames(detector, obs('1', bad), start=0.3), [])
        detector = Detector()
        self.frames(detector, UP, count=3)
        self.assertEqual(self.frames(detector, obs('1', DOWN.bbox, 0.2), start=0.3), [])

    def test_backwards_clock_and_frame_size_required(self):
        detector = Detector()
        detector.update([DOWN], 10, FRAME)
        with self.assertRaises(ValueError):
            detector.update([DOWN], 9, FRAME)
        with self.assertRaises(ValueError):
            detector.update([DOWN], 11)

    def test_tracks_independent(self):
        detector = Detector()
        events = []
        for index in range(5):
            detector.update([obs('1', UP.bbox), obs('2', (400, 60, 460, 200))], index / 10, FRAME)
        for index in range(21):
            events.extend(detector.update([DOWN, obs('2', (400, 60, 460, 200))], 0.5 + index / 10, FRAME))
        self.assertEqual([event['trackId'] for event in events], ['1'])

    # --- HIGH 1: close-up / cut-off rules ---------------------------------
    def test_edge_touching_box_is_ignored(self):
        detector = Detector()
        self.frames(detector, obs('1', (200, 60, 260, 355)), count=5)  # upright, touches bottom
        self.assertEqual(self.frames(detector, obs('1', (100, 200, 400, 358)), start=0.5), [])
        self.assertEqual(detector.classify(obs('1', (0, 150, 140, 200)), FRAME), 'ignored')
        self.assertEqual(detector.classify(DOWN, FRAME), 'horizontal')
        self.assertEqual(Detector(edge_margin=0).classify(obs('1', (1, 150, 140, 200)), FRAME), 'horizontal')

    def test_zidane_like_close_up_never_alerts(self):
        # Box measured from ultralytics zidane.jpg (1280x720): ratio 0.515.
        detector, frame = Detector(), (1280, 720)
        events = []
        for index in range(50):
            events += detector.update([obs('1', (115, 197, 1114, 712), 0.84)], index / 10, frame)
        self.assertEqual(events, [])

    def test_area_bounds(self):
        detector = Detector(min_area_fraction=0.01, max_area_fraction=0.2)
        self.assertEqual(detector.classify(obs('1', (100, 100, 130, 110)), FRAME), 'ignored')   # 0.13%
        self.assertEqual(detector.classify(obs('1', (20, 60, 620, 300)), FRAME), 'ignored')     # 62%
        self.assertEqual(detector.classify(DOWN, FRAME), 'horizontal')
        large = Detector(max_area_fraction=0.2)
        self.frames(large, obs('1', (100, 20, 300, 340)), count=5)
        self.assertEqual(self.frames(large, obs('1', (20, 100, 620, 300)), start=0.5), [])
        with self.assertRaises(ValueError):
            Detector(min_area_fraction=0.5, max_area_fraction=0.4)

    def test_requires_same_track_upright_before_horizontal(self):
        detector = Detector()
        self.assertEqual(self.frames(detector, DOWN, count=40), [])  # no upright history
        other = Detector()
        self.frames(other, obs('2', UP.bbox), count=5)  # a DIFFERENT track was upright
        self.assertEqual(self.frames(other, DOWN, start=0.5), [])
        self.assertEqual(len(self.fall(Detector())), 1)

    def test_upright_must_be_recent(self):
        detector = Detector(upright_window=2.0)
        self.frames(detector, UP, count=3)
        detector.update([], 0.3, FRAME)
        self.assertEqual(self.frames(detector, DOWN, start=3.0), [])
        self.assertEqual(len(self.fall(Detector(upright_window=2.0), start=3.0)), 1)

    def test_intermediate_ratio_neither_upright_nor_horizontal(self):
        detector = Detector()
        self.assertEqual(detector.classify(obs('1', (200, 100, 300, 180)), FRAME), 'intermediate')
        self.frames(detector, obs('1', (200, 100, 300, 180)), count=5)
        self.assertEqual(self.frames(detector, DOWN, start=0.5), [])

    def test_horizontal_must_persist_for_dwell(self):
        detector = Detector(min_duration=3.0)
        self.assertEqual(self.fall(detector, count=21), [])
        self.assertEqual(len(self.frames(detector, DOWN, start=2.6, count=15)), 1)

    # --- MED 5: region-based repeat suppression ---------------------------
    def test_region_overlap(self):
        self.assertTrue(regions_overlap((0.1, 0.1, 0.3, 0.3), (0.12, 0.1, 0.32, 0.3)))
        self.assertTrue(regions_overlap((0.1, 0.1, 0.2, 0.2), (0.15, 0.22, 0.25, 0.25)))  # close centroids
        self.assertFalse(regions_overlap((0.1, 0.1, 0.2, 0.2), (0.6, 0.6, 0.8, 0.8)))

    def test_new_track_id_in_same_region_is_suppressed(self):
        detector = Detector()
        self.assertEqual(len(self.fall(detector, track='1')), 1)
        # Tracker flickers: same still person reappears as new IDs.
        self.assertEqual(self.fall(detector, start=3, track='7'), [])
        self.assertEqual(self.fall(detector, start=6, track='8'), [])
        self.assertEqual(detector.suppressed, 2)

    def test_region_suppression_expires_and_other_regions_alert(self):
        detector = Detector(region_cooldown=5)
        self.assertEqual(len(self.fall(detector, track='1')), 1)
        far_up, far_down = (500, 60, 560, 200), (440, 150, 580, 200)
        self.frames(detector, obs('2', far_up), 3, 5)
        self.assertEqual(len(self.frames(detector, obs('2', far_down), 3.5)), 1)
        self.assertEqual(len(self.fall(detector, start=20, track='9')), 1)


class StoreTests(unittest.TestCase):
    EVENT = {'trackId': '1', 'durationSeconds': 1.5,
             'evidence': {'heightWidthRatio': .3, 'region': [0.25, 0.4, 0.47, 0.56]}}

    def test_persistence_acknowledgment_and_explicit_closure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.sqlite'
            store = Store(path)
            event = store.record(self.EVENT, 'synthetic', 'run', 1, 'cam', 'zone')
            incident_id = event['eventId']
            self.assertTrue(event['observedAt'].endswith('Z'))
            store.action(incident_id, 'acknowledge', '')
            restored = Store(path)
            self.assertEqual(restored.list('incidents')[0]['status'], 'acknowledged')
            with self.assertRaises(ValueError):
                restored.action(incident_id, 'resolve', '')
            closed = restored.action(incident_id, 'resolve', 'Scene checked in synthetic demo')
            self.assertTrue(closed['closedAt'].endswith('Z'))
            self.assertEqual(restored.list('incidents')[0]['status'], 'resolved')
            self.assertEqual(len(restored.list('actions')), 2)
            with self.assertRaises(ValueError):
                restored.action(incident_id, 'acknowledge', '')
            store.db.close()
            restored.db.close()

    def test_review_queue_keeps_older_unresolved_incidents_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / 'test.sqlite')
            ids = [store.record(dict(self.EVENT, trackId=str(n)), 'synthetic', 'run', n,
                                'cam', 'zone')['eventId'] for n in range(1, 6)]
            for incident_id in ids[1:]:
                store.action(incident_id, 'false_alarm', 'Synthetic test')
            queue = store.review_queue(limit=2)
            self.assertEqual([item['id'] for item in queue], [ids[4], ids[3], ids[0]])
            self.assertEqual(queue[-1]['status'], 'open')
            self.assertEqual(store.unresolved_regions('cam'), [self.EVENT['evidence']['region']])
            self.assertEqual(store.unresolved_regions('other-cam'), [])
            store.db.close()


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.directory.name) / 'r.sqlite')

    def tearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    def make(self, action=None, note='Checked'):
        event = self.store.record(StoreTests.EVENT, 'synthetic', 'run', 1, 'cam', 'zone')
        if action:
            self.store.action(event['eventId'], 'acknowledge', '')
            if action != 'acknowledge':
                self.store.action(event['eventId'], action, note)
        return event['eventId']

    def counts(self):
        return {table: self.store.db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                for table in ('incidents', 'events', 'actions')}

    def test_prunes_only_old_closed_incidents_with_their_events_and_actions(self):
        closed = self.make('resolve', 'Spoke to Alex, fine')
        self.make('false_alarm')
        still_open = self.make()
        acknowledged = self.make('acknowledge')
        now = datetime.now(timezone.utc)
        self.assertEqual(self.store.prune(30, now), {'incidents': 0, 'events': 0, 'actions': 0})
        result = self.store.prune(30, now + timedelta(days=31))
        self.assertEqual(result, {'incidents': 2, 'events': 2, 'actions': 4})
        remaining = {row['id'] for row in self.store.list('incidents')}
        self.assertEqual(remaining, {still_open, acknowledged})
        self.assertNotIn(closed, remaining)
        self.assertEqual(self.counts(), {'incidents': 2, 'events': 2, 'actions': 1})
        # Unresolved incidents are never pruned, however old.
        self.store.prune(1, now + timedelta(days=3650))
        self.assertEqual(self.counts()['incidents'], 2)

    def test_window_uses_closure_time_not_observation_time(self):
        incident_id = self.make()
        payload = json.loads(self.store.db.execute('SELECT payload FROM incidents').fetchone()[0])
        payload['observedAt'] = '2020-01-01T00:00:00.000Z'
        with self.store.db:
            self.store.db.execute('UPDATE incidents SET payload=? WHERE id=?', (json.dumps(payload), incident_id))
        self.store.action(incident_id, 'resolve', 'Checked late')
        self.assertEqual(self.store.prune(30)['incidents'], 0)

    def test_invalid_retention(self):
        for value in (0, -1, 1.5, '30'):
            with self.assertRaises(ValueError):
                self.store.prune(value)


if __name__ == '__main__':
    unittest.main()
