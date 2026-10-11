"""Golden results produced by SiteGuard's pre-refactor engine, not SiteOps."""
import json
import unittest
from pathlib import Path
from fall_detection.detector import Detector, Observation
from replay_cases import evaluate

class EquivalenceTests(unittest.TestCase):
    def test_existing_behavior_over_multi_person_tapes(self):
        fixtures = json.loads((Path(__file__).parent / 'fixtures' / 'engine-baseline.json').read_text())
        for case in fixtures['cases']:
            with self.subTest(seed=case['seed']):
                detector = Detector(**case['settings'])
                self.assertEqual(evaluate(detector, Observation, case), case['expected'])
