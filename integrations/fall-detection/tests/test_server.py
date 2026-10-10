import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from fall_detection.detector import Observation
from fall_detection.server import Runtime, handler, retention_loop
from fall_detection.store import Store


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.runtime = Runtime(Store(Path(self.directory.name) / 'db.sqlite'), 'synthetic', 'cam', 'zone')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.runtime))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.runtime.store.db.close()
        self.directory.cleanup()

    def post(self, path, body, origin=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        request = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), headers=headers)
        return urllib.request.urlopen(request)

    def test_api_and_event_metadata(self):
        self.runtime.frame([], 0, [640, 360])
        response = urllib.request.urlopen(self.url + '/api/state')
        self.assertEqual(json.load(response)['source'], 'synthetic')
        self.post('/api/demo', {'scenario': 'horizontal'}).close()
        self.assertEqual(self.runtime.scenario, 'horizontal')
        self.assertEqual(json.load(urllib.request.urlopen(self.url + '/api/events')), {'events': []})

    def test_rejects_cross_origin_and_invalid_scenario(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post('/api/demo', {'scenario': 'horizontal'}, 'https://evil.example')
        self.assertEqual(error.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post('/api/demo', {'scenario': 'fake'})
        self.assertEqual(error.exception.code, 400)

    def test_rejects_cross_site_preview_and_state_reads(self):
        for path in ('/api/preview', '/api/state', '/'):
            request = urllib.request.Request(self.url + path, headers={'Sec-Fetch-Site': 'cross-site'})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 403)
        request = urllib.request.Request(self.url + '/api/state', headers={'Sec-Fetch-Site': 'same-origin'})
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.headers['Cross-Origin-Resource-Policy'], 'same-origin')

    def test_rejects_non_loopback_host_header(self):
        request = urllib.request.Request(self.url + '/api/state', headers={'Host': 'attacker.example:4322'})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 403)

    def test_track_overlay_uses_detector_threshold(self):
        self.runtime.detector.ratio_threshold = 0.5
        self.runtime.frame([Observation('1', (100, 100, 200, 160))], 1, [640, 360])
        self.assertFalse(self.runtime.state()['tracks'][0]['horizontal'])
        self.runtime.frame([Observation('1', (0, 100, 200, 160))], 2, [640, 360])
        self.assertEqual(self.runtime.state()['tracks'][0]['state'], 'ignored')

    def fall(self, track, start):
        for index in range(5):
            self.runtime.frame([Observation(track, (200, 60, 260, 200))], start + index / 10, [640, 360])
        for index in range(21):
            self.runtime.frame([Observation(track, (160, 150, 300, 200))], start + 0.5 + index / 10, [640, 360])

    def test_unresolved_incident_suppresses_repeats_in_same_region(self):
        self.runtime.detector.region_cooldown = 0.1  # Isolate the store-backed check.
        self.fall('1', 0)
        self.fall('2', 10)
        incidents = self.runtime.store.list('incidents')
        self.assertEqual(len(incidents), 1)
        self.assertEqual(self.runtime.state()['suppressedRepeats'], 1)
        self.runtime.store.action(incidents[0]['id'], 'false_alarm', 'Person resting on bench')
        self.fall('3', 20)
        self.assertEqual(len(self.runtime.store.list('incidents')), 2)

    def test_camera_never_substitutes_synthetic(self):
        self.runtime.source = 'camera'
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post('/api/demo', {'scenario': 'horizontal'})
        self.assertEqual(error.exception.code, 409)


class RetentionLoopTests(unittest.TestCase):
    def test_prunes_at_startup_then_stops(self):
        calls, stop = [], threading.Event()

        class FakeStore:
            def prune(self, days):
                calls.append(days)
                stop.set()
                return {'incidents': 0, 'events': 0, 'actions': 0}

        thread = threading.Thread(target=retention_loop, args=(FakeStore(), 30, stop, 0.01))
        thread.start()
        thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(calls, [30])


class CameraConsentTests(unittest.TestCase):
    """Camera/inference only starts after explicit dashboard consent."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.runtime = Runtime(Store(Path(self.directory.name) / 'db.sqlite'), 'camera', 'cam', 'zone')
        self.calls = []

        def fake_camera(video, stop_event):  # Stands in for OpenCV/YOLO capture.
            self.calls.append(video)
            with self.runtime.lock:
                self.runtime.status = 'running'
                self.runtime.preview_jpeg = b'jpeg'
            stop_event.wait(5)
            with self.runtime.lock:
                self.runtime.preview_jpeg = None
                self.runtime.camera_active = False

        self.runtime.camera = fake_camera
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.runtime))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def tearDown(self):
        self.runtime.stop_camera(timeout=5)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.runtime.store.db.close()
        self.directory.cleanup()

    def post(self, path, body, origin=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        request = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    def state(self):
        with urllib.request.urlopen(self.url + '/api/state') as response:
            return json.load(response)

    def assert_status(self, code, path, body, origin=None):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post(path, body, origin)
        self.assertEqual(error.exception.code, code)

    def test_camera_does_not_start_at_launch(self):
        state = self.state()
        self.assertEqual(state['status'], 'awaiting_consent')
        self.assertFalse(state['cameraActive'])
        self.assertTrue(state['consentText'])
        self.assertEqual(self.calls, [])
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.url + '/api/preview')
        self.assertEqual(error.exception.code, 503)

    def test_start_requires_explicit_consent(self):
        for body in ({}, {'consent': False}, {'consent': 'yes'}, {'consent': 1}, {'consent': True, 'x': 1}):
            self.assert_status(400, '/api/camera/start', body)
        self.assert_status(403, '/api/camera/start', {'consent': True}, 'https://evil.example')
        self.assertEqual(self.calls, [])
        self.assertFalse(self.state()['cameraActive'])

    def test_start_and_stop_on_demand(self):
        state = self.post('/api/camera/start', {'consent': True})
        self.assertTrue(state['cameraActive'])
        self.assertTrue(state['consentAt'].endswith('Z'))
        self.assertEqual(self.calls, [0])
        self.post('/api/camera/start', {'consent': True})  # Idempotent while running.
        self.assertEqual(self.calls, [0])
        stopped = self.post('/api/camera/stop', {})
        self.assertFalse(stopped['cameraActive'])
        self.assertEqual(stopped['status'], 'stopped')
        self.assertIsNone(self.runtime.preview_jpeg)
        self.assertFalse(self.runtime.camera_thread)
        self.post('/api/camera/start', {'consent': True})  # Restart needs consent again.
        self.assertEqual(self.calls, [0, 0])

    def test_synthetic_mode_has_no_camera_endpoints(self):
        self.runtime.source = 'synthetic'
        self.assert_status(409, '/api/camera/start', {'consent': True})
        self.assert_status(409, '/api/camera/stop', {})
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
