"""Loopback-only demo server. No authentication or production deployment support."""
import argparse
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .detector import Detector, Observation
from .store import Store
from .delivery import from_environment

ROOT = Path(__file__).resolve().parents[1]


class Runtime:
    def __init__(self, store, source, camera_id, zone_id):
        self.store, self.source = store, source
        self.camera_id, self.zone_id = camera_id, zone_id
        self.run_id, self.sequence = str(uuid.uuid4()), 0
        self.detector = Detector()
        self.lock, self.stop = threading.RLock(), threading.Event()
        self.status, self.message, self.scenario = 'starting', None, 'upright'
        self.tracks, self.frame_size = [], [640, 360]
        self.scenario_revision = 0
        self.preview_jpeg = None
        self.delivery = from_environment(store)

    def frame(self, observations, timestamp, frame_size):
        with self.lock:
            observations = list(observations)
            events = self.detector.update(observations, timestamp)
            self.tracks = [{'trackId': item.track_id, 'bbox': item.bbox,
                            'horizontal': (item.bbox[3]-item.bbox[1]) / (item.bbox[2]-item.bbox[0]) < 2/3}
                           for item in observations if item.bbox[2] > item.bbox[0]]
            self.frame_size = frame_size
            for event in events:
                self.sequence += 1
                self.store.record(event, self.source, self.run_id, self.sequence,
                                  self.camera_id, self.zone_id)

    def state(self):
        with self.lock:
            return {'source': self.source, 'status': self.status, 'message': self.message,
                    'tracks': self.tracks, 'frameSize': self.frame_size,
                    'incidents': self.store.list('incidents'),
                    'delivery': {'configured': bool(self.delivery), 'pending': len(self.store.pending()), 'error': self.delivery.last_error if self.delivery else None}}

    def synthetic(self):
        self.status = 'running'
        try:
            while not self.stop.is_set():
                with self.lock:
                    scenario = self.scenario
                    bbox = (180, 80, 260, 300) if scenario == 'upright' else (150, 220, 390, 300)
                    observations = [] if scenario == 'missing' else [Observation('demo-person-1', bbox)]
                    self.frame(observations, time.monotonic(), [640, 360])
                self.stop.wait(0.1)
        except Exception as error:
            with self.lock:
                self.status, self.message, self.tracks = 'unavailable', str(error), []

    def forward(self):
        retry_seconds = 1
        while not self.stop.is_set():
            if self.delivery:
                okay = self.delivery.flush()
                retry_seconds = 1 if okay else min(30, retry_seconds * 2)
            self.stop.wait(retry_seconds)

    def camera(self, video):
        capture = None
        try:
            import cv2
            from ultralytics import YOLO
            self.message = 'Loading YOLOv8n; first run may download model weights.'
            model = YOLO(str(ROOT / '.data' / 'yolov8n.pt'))
            capture = cv2.VideoCapture(video)
            if not capture.isOpened():
                raise RuntimeError('Camera/video unavailable. Check permissions and input.')
            self.status, self.message = 'running', 'Local inference and loopback preview; no images/video stored.'
            start = time.monotonic()
            fps = capture.get(cv2.CAP_PROP_FPS)
            fps = fps if fps > 0 else 20
            frame_number = 0
            while not self.stop.is_set():
                ok, frame = capture.read()
                if not ok:
                    self.status, self.message, self.tracks = 'stopped', 'Input ended or capture interrupted; incidents stay open.', []
                    break
                results = model.track(frame, persist=True, classes=[0], conf=0.5,
                                      tracker='bytetrack.yaml', verbose=False)
                observations = []
                boxes = results[0].boxes
                if boxes is not None and boxes.id is not None:
                    for box, track, confidence in zip(boxes.xyxy.cpu().tolist(),
                                                     boxes.id.cpu().tolist(), boxes.conf.cpu().tolist()):
                        observations.append(Observation(str(int(track)), tuple(box), confidence))
                timestamp = time.monotonic() if self.source == 'camera' else start + frame_number / fps
                self.frame(observations, timestamp, [frame.shape[1], frame.shape[0]])
                preview = cv2.resize(frame, (640, int(frame.shape[0] * 640 / frame.shape[1])))
                encoded, jpeg = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 70])
                if encoded:
                    with self.lock:
                        self.preview_jpeg = jpeg.tobytes()
                frame_number += 1
                if self.source == 'recorded_fixture':
                    self.stop.wait(1 / fps)
        except Exception as error:
            self.status, self.message, self.tracks = 'unavailable', str(error), []
        finally:
            with self.lock:
                self.preview_jpeg = None
            if capture is not None:
                capture.release()


def handler(runtime):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, body, content_type='application/json'):
            data = body if isinstance(body, bytes) else body.encode() if isinstance(body, str) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(data)

        def allowed(self):
            # Loopback binding plus Host/Origin checks protect local demo writes.
            expected = '127.0.0.1:' + str(self.server.server_port)
            host = self.headers.get('Host', '')
            origin = self.headers.get('Origin')
            return host == expected and (origin is None or origin == 'http://' + expected)

        def do_GET(self):
            if not self.allowed():
                return self.send(403, {'error': 'Use the 127.0.0.1 dashboard origin'})
            if self.path == '/':
                return self.send(200, (ROOT / 'web' / 'index.html').read_text(), 'text/html; charset=utf-8')
            if self.path.split('?')[0] == '/api/preview':
                with runtime.lock:
                    jpeg = runtime.preview_jpeg
                return self.send(200, jpeg, 'image/jpeg') if jpeg else self.send(503, {'error': 'No live frame'})
            if self.path == '/api/state':
                return self.send(200, runtime.state())
            if self.path == '/api/events':
                return self.send(200, {'events': runtime.store.list('events', 1000)})
            return self.send(404, {'error': 'Not found'})

        def do_POST(self):
            if not self.allowed():
                return self.send(403, {'error': 'Invalid origin'})
            try:
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Use application/json')
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096:
                    raise ValueError('Invalid body size')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Expected object')
                if self.path == '/api/demo':
                    if runtime.source != 'synthetic':
                        return self.send(409, {'error': 'Synthetic controls disabled in camera/video mode'})
                    if set(body) != {'scenario'} or body['scenario'] not in ('upright', 'horizontal', 'bend', 'missing'):
                        raise ValueError('Invalid scenario')
                    with runtime.lock:
                        runtime.scenario = body['scenario']
                        runtime.scenario_revision += 1
                        revision = runtime.scenario_revision
                    if body['scenario'] == 'bend':
                        def restore():
                            with runtime.lock:
                                if runtime.scenario == 'bend' and runtime.scenario_revision == revision:
                                    runtime.scenario = 'upright'
                        threading.Timer(0.6, restore).start()
                    return self.send(200, runtime.state())
                prefix = '/api/incidents/'
                if self.path.startswith(prefix):
                    if set(body) != {'action', 'note'}:
                        raise ValueError('Expected action and note')
                    incident = runtime.store.action(self.path[len(prefix):], body['action'], body['note'])
                    return self.send(200, {'incident': incident})
                return self.send(404, {'error': 'Not found'})
            except KeyError:
                self.send(404, {'error': 'Incident not found'})
            except (ValueError, TypeError) as error:
                self.send(400, {'error': str(error)})
    return Handler


def main():
    parser = argparse.ArgumentParser(description='Standalone possible-person-down demo')
    parser.add_argument('--port', type=int, default=4322)
    parser.add_argument('--source', choices=['synthetic', 'camera', 'recorded_fixture'], default='synthetic')
    parser.add_argument('--camera', type=int, default=0)
    parser.add_argument('--video', type=Path)
    parser.add_argument('--camera-id', default='camera-01')
    parser.add_argument('--zone-id', default='demo-zone-a')
    parser.add_argument('--database', type=Path, default=ROOT / '.data' / 'incidents.sqlite')
    args = parser.parse_args()
    if args.source == 'recorded_fixture' and (not args.video or not args.video.is_file()):
        parser.error('recorded_fixture requires --video with an existing local file')
    if args.source != 'recorded_fixture' and args.video:
        parser.error('--video is only accepted with recorded_fixture')
    args.database.parent.mkdir(parents=True, exist_ok=True)
    (ROOT / '.data').mkdir(exist_ok=True)
    runtime = Runtime(Store(args.database), args.source, args.camera_id, args.zone_id)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(runtime))
    target = runtime.synthetic if args.source == 'synthetic' else lambda: runtime.camera(str(args.video) if args.video else args.camera)
    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    delivery_thread = threading.Thread(target=runtime.forward, daemon=True)
    delivery_thread.start()
    print('Open http://127.0.0.1:%s — source=%s' % (server.server_port, args.source), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runtime.stop.set()
        server.server_close()
        thread.join(timeout=5)
        delivery_thread.join(timeout=5)


if __name__ == '__main__':
    main()
