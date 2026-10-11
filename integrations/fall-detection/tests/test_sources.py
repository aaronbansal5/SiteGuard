"""Exercise the optional camera boundary without accessing a physical camera."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fall_detection.sources import CameraFeed, synthetic_observations


def tensor(values):
    return SimpleNamespace(cpu=lambda: SimpleNamespace(tolist=lambda: values))


class CameraSourceTests(unittest.TestCase):
    def exercise(self, source):
        pixels = SimpleNamespace(shape=(360, 640, 3))
        capture = Mock()
        capture.isOpened.return_value = True
        capture.get.return_value = 20
        capture.read.side_effect = [(True, pixels), (True, pixels), (False, None)]
        boxes = SimpleNamespace(xyxy=tensor([[20, 30, 70, 140], [100, 50, 250, 90]]),
                                id=tensor([7, 9]), conf=tensor([0.9, 0.8]))
        network = Mock()
        network.track.return_value = [SimpleNamespace(boxes=boxes)]
        cv = SimpleNamespace(VideoCapture=Mock(return_value=capture), CAP_PROP_FPS=5,
                             resize=Mock(return_value=pixels), IMWRITE_JPEG_QUALITY=1,
                             imencode=Mock(return_value=(True, SimpleNamespace(tobytes=lambda: b'preview'))))
        factory = Mock(return_value=network)
        with patch.dict('sys.modules', {'cv2': cv, 'ultralytics': SimpleNamespace(YOLO=factory)}), \
                patch('fall_detection.sources.time.monotonic', side_effect=[10, 11, 12]):
            feed = CameraFeed(0, source, 'weights.pt')
            feed.load()
            feed.connect()
            feed.begin_clock()
            first = feed.read()
            self.assertEqual([person.track_id for person in first.observations], ['7', '9'])
            self.assertEqual([person.confidence for person in first.observations], [0.9, 0.8])
            self.assertEqual(first.dimensions, [640, 360])
            self.assertEqual(feed.preview(first), b'preview')
            feed.advance()
            second = feed.read()
            self.assertIsNone(feed.read())
            feed.release()
        capture.release.assert_called_once()
        settings = network.track.call_args.kwargs
        self.assertEqual(settings, dict(persist=True, classes=[0], conf=0.5,
                                        tracker='bytetrack.yaml', verbose=False))
        cv.resize.assert_called_once_with(pixels, (640, 360))
        return first.timestamp, second.timestamp

    def test_live_input_uses_observed_time_and_keeps_multiple_people(self):
        self.assertEqual(self.exercise('camera'), (11, 12))

    def test_recorded_input_uses_frame_cadence(self):
        self.assertEqual(self.exercise('recorded_fixture'), (10, 10.05))

    def test_synthetic_scenarios_preserve_existing_boxes_and_identity(self):
        self.assertEqual(synthetic_observations('missing'), [])
        self.assertEqual(synthetic_observations('upright')[0].bbox, (180, 80, 260, 300))
        self.assertEqual(synthetic_observations('bend'), synthetic_observations('horizontal'))
