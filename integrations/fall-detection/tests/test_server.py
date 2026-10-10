import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from fall_detection.server import Runtime, handler
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

    def test_camera_never_substitutes_synthetic(self):
        self.runtime.source = 'camera'
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post('/api/demo', {'scenario': 'horizontal'})
        self.assertEqual(error.exception.code, 409)


if __name__ == '__main__':
    unittest.main()
